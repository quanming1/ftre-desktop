/**
 * ChatMessageList — Standalone message list component.
 *
 * Pure presentational: renders ChatMessage[] without any store dependency.
 * Can be used in:
 * - Main app (fed by zustand store)
 * - Storybook (fed by mock data or live WebSocket)
 * - Embedded panels (preview, debug)
 */
import { memo, useRef, useEffect, useState, useCallback } from "react";
import { ChevronUp, Loader2 } from "lucide-react";
import type { ChatMessage } from "@/stores/chat";
import { useAutoScrollToBottom } from "@/hooks/auto-scroll";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { TypingDots } from "./TypingDots";

// ─── Types ──────────────────────────────────────────────────────────

export interface ChatMessageListHandle {
  /** 把 visibleCount 拉到至少 n（确保前 totalCount-n 之前的消息也渲染出来） */
  ensureVisible: (count: number) => void;
}

export interface ChatMessageListProps {
  messages: ChatMessage[];
  /** Whether the agent is currently processing (shows typing indicator) */
  isBusy?: boolean;
  /** Auto-scroll to bottom on new messages */
  autoScroll?: boolean;
  /** Max height CSS value (default: none, fills parent) */
  maxHeight?: string;
  /** Class name for the outer container */
  className?: string;
  /** 暴露内部滚动容器 DOM；让外部组件（如 ChatOutline）能读 scroll 状态 / 跳转 */
  onContainerReady?: (el: HTMLDivElement | null) => void;
  /** 暴露分页控制句柄；ChatOutline 跳转到早期消息前会用 ensureVisible 强制加载 */
  onHandleReady?: (handle: ChatMessageListHandle | null) => void;
}

// ─── Component ──────────────────────────────────────────────────────

const PAGE_SIZE = 10;

export const ChatMessageList = memo(function ChatMessageList({
  messages,
  isBusy = false,
  autoScroll = true,
  maxHeight,
  className = "",
  onContainerReady,
  onHandleReady,
}: ChatMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // 暴露 ensureVisible 给 ChatOutline：跳早期消息前先强制加载
  useEffect(() => {
    if (!onHandleReady) return;
    const handle: ChatMessageListHandle = {
      ensureVisible: (n: number) => {
        setVisibleCount((cur) => Math.max(cur, n));
      },
    };
    onHandleReady(handle);
    return () => onHandleReady(null);
  }, [onHandleReady]);

  // ─── Auto-scroll hook ───────────────────────────────────────────
  // deps: 最后一条消息 id 变化 → 切 session 时重置锁
  const lastMsgId = messages[messages.length - 1]?.id;
  const { ref: autoScrollRef, scrollToBottom, resetLock } = useAutoScrollToBottom(
    lastMsgId ? [lastMsgId] : undefined,
    { autoScrollLockDefault: true },
  );
  const mergedRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      autoScrollRef(el);
      onContainerReady?.(el);
    },
    [autoScrollRef, onContainerReady],
  );

  // 新一轮流开始 → 强制重新跟随
  const prevBusy = useRef(false);
  useEffect(() => {
    if (isBusy && !prevBusy.current) resetLock();
    prevBusy.current = isBusy;
  }, [isBusy, resetLock]);

  // ─── 尾部消息指纹 —— 覆盖流式期间所有增量来源 ─────────────────
  // 流式期间 messages.length 不变，但最后一条的 content/parts/toolCalls 在涨。
  // 指纹变化 → scrollToBottom，锁由 hook 内部管理。
  const lastMsg = messages[messages.length - 1];
  const tailFingerprint =
    !lastMsg
      ? ""
      : `${lastMsg.id}:${(lastMsg.content ?? "").length}:${(lastMsg.reasoning ?? "").length}:${
          lastMsg.parts
            ?.map((p) =>
              p.type === "tool_call"
                ? `t${p.toolCallId}`
                : `${p.type[0]}${p.text.length}`,
            )
            .join("|") ?? ""
        }:${
          lastMsg.toolCalls
            ?.map(
              (t) =>
                `${t.id}${t.status}${t.arguments?.length ?? 0}${(t.result ?? "").length}`,
            )
            .join("|") ?? ""
        }`;

  useEffect(() => {
    if (!autoScroll) return;
    scrollToBottom();
  }, [tailFingerprint, autoScroll, scrollToBottom]);

  // ─── 加载更多 ──────────────────────────────────────────────────

  // Reset visible count when switching sessions
  const prevLenRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length < prevLenRef.current || messages.length === 0) {
      setVisibleCount(PAGE_SIZE);
    }
    prevLenRef.current = messages.length;
  }, [messages.length]);

  const totalCount = messages.length;
  const startIndex = Math.max(0, totalCount - visibleCount);
  const visibleMessages = messages.slice(startIndex);
  // 本地 hidden（前端已加载但被 visibleCount 截掉的）
  const localHidden = startIndex;
  // 后端是否还有更早的页可拉
  const sessionId = useChat((s) => s.sessionId);
  const hasMoreHistory = useChat((s) =>
    sessionId ? s.hasMoreHistory(sessionId) : false,
  );
  const loadEarlier = useSession((s) => s.loadEarlierMessages);

  const hasMore = localHidden > 0 || hasMoreHistory;

  // 后端拉历史时的 loading 标记（避免重复点）
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadMore = useCallback(async () => {
    const el = containerRef.current;
    const prevHeight = el?.scrollHeight ?? 0;

    // 优先扩 visibleCount，覆盖前端已加载但被截掉的部分
    if (localHidden > 0) {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, totalCount));
      requestAnimationFrame(() => {
        if (!el) return;
        el.scrollTop += el.scrollHeight - prevHeight;
      });
      return;
    }

    // visibleCount 已撑满当前 messages —— 去后端拉更早一页
    if (!hasMoreHistory || !sessionId || loadingHistory) return;
    setLoadingHistory(true);
    try {
      const got = await loadEarlier(sessionId);
      if (got) {
        // prepend 后 messages.length 涨了，把 visibleCount 也跟涨：
        // 老规则下"加载完一页只显示 PAGE_SIZE"会让用户感觉点了没用，
        // 把 visibleCount 跟着扩到能至少展示新拉到的那一档。
        setVisibleCount((prev) => prev + PAGE_SIZE);
        requestAnimationFrame(() => {
          if (!el) return;
          el.scrollTop += el.scrollHeight - prevHeight;
        });
      }
    } finally {
      setLoadingHistory(false);
    }
  }, [localHidden, totalCount, hasMoreHistory, sessionId, loadingHistory, loadEarlier]);

  return (
    <div
      ref={mergedRef}
      className={`overflow-y-auto overflow-x-hidden px-4 py-3 ${className}`}
      style={{
        maxHeight,
        scrollbarGutter: "stable",
      }}
    >
      <div className="mx-auto w-full max-w-[960px] space-y-12 break-words">
        {/* Load more */}
        {hasMore && (
          <div className="text-center py-2">
            <button
              onClick={loadMore}
              disabled={loadingHistory}
              className="inline-flex items-center gap-1.5 text-[12px] text-t-ghost hover:text-t-muted transition-colors disabled:opacity-50"
            >
              {loadingHistory ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  加载中...
                </>
              ) : localHidden > 0 ? (
                <>
                  <ChevronUp size={14} />
                  加载更早的消息（还有 {localHidden} 条）
                </>
              ) : (
                <>
                  <ChevronUp size={14} />
                  从服务器加载更早的消息
                </>
              )}
            </button>
          </div>
        )}

        {messages.length === 0 && !isBusy && (
          <div className="text-center text-t-dim text-sm py-12">
            No messages
          </div>
        )}

        {visibleMessages.map((msg, i) => {
          const next = visibleMessages[i + 1];
          const isLastOfTurn =
            msg.role === "assistant" &&
            !msg.streaming &&
            (!next || next.role !== "assistant");

          let turnUsage: ChatMessage["usage"] | undefined;
          if (msg.role === "assistant" && msg.usage) {
            let prevTotal = 0;
            for (let j = i - 1; j >= 0; j--) {
              const prev = visibleMessages[j];
              if (prev.role === "assistant" && prev.usage?.total_tokens != null) {
                prevTotal = prev.usage.total_tokens;
                break;
              }
            }
            const cur = msg.usage;
            turnUsage = {
              prompt_tokens: cur.prompt_tokens,
              completion_tokens: cur.completion_tokens,
              total_tokens:
                cur.total_tokens != null ? cur.total_tokens - prevTotal : undefined,
            };
          }

          return (
            <MessageItem
              key={msg.id}
              message={msg}
              showActions={isLastOfTurn}
              turnUsage={turnUsage}
            />
          );
        })}

        {/* Typing indicator */}
        {isBusy && !messages.some((m) => m.streaming) && (
          <TypingDots className="py-2" />
        )}
      </div>
    </div>
  );
});

// ─── Message Item ───────────────────────────────────────────────────

const MessageItem = memo(function MessageItem({
  message,
  showActions = false,
  turnUsage,
}: {
  message: ChatMessage;
  showActions?: boolean;
  turnUsage?: ChatMessage["usage"];
}) {
  if (message.role === "user") {
    return <UserMessage message={message} />;
  }
  if (message.role === "assistant") {
    return (
      <AssistantMessage
        message={message}
        showActions={showActions}
        turnUsage={turnUsage}
      />
    );
  }
  if (message.role === "system") {
    return (
      <div className="text-[13px] text-danger p-3 bg-danger/8 rounded-lg font-mono">
        {message.content}
      </div>
    );
  }
  return null;
});
