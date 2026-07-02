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
import { ChevronUp, Loader2, Archive, AlertCircle, ChevronRight, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/stores/chat";
import { useAutoScrollToBottom } from "@/hooks/auto-scroll";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { remarkPlugins, rehypePlugins } from "@/lib/markdown-plugins";

// ─── Types ──────────────────────────────────────────────────────────

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
}

// ─── Component ──────────────────────────────────────────────────────

const PAGE_SIZE = 10;

export const ChatMessageList = memo(function ChatMessageList({
  messages,
  isBusy = false,
  autoScroll = true,
  maxHeight,
  className = "",
}: ChatMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // ─── 右键菜单（选中文本后复制）────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState("");

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || "";
    if (text) {
      e.preventDefault();
      setSelectedText(text);
      setContextMenu({ x: e.clientX, y: e.clientY });
    }
    // 没有选中文本时，让浏览器默认右键菜单显示
  }, []);

  const handleCopySelection = useCallback(async () => {
    if (selectedText) {
      await navigator.clipboard.writeText(selectedText);
    }
    setContextMenu(null);
  }, [selectedText]);

  const contextMenuItems: ContextMenuItem[] = [
    {
      id: "copy",
      label: "复制",
      icon: Copy,
      action: handleCopySelection,
    },
  ];

  // ─── Auto-scroll hook ───────────────────────────────────────────
  // deps: 最后一条消息 id 变化 → 切 session 时重置锁
  const lastMsgId = messages[messages.length - 1]?.id;
  const { ref: autoScrollRef, scrollToBottom, resetLock } = useAutoScrollToBottom(
    [lastMsgId],
    { autoScrollLockDefault: true },
  );
  const mergedRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      autoScrollRef(el);
    },
    [autoScrollRef],
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
                : `${p.type[0]}${String(p.type === "text" ? p.text ?? p.data ?? "" : "").length}`,
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
      data-chat-scroll-container=""
      onContextMenu={handleContextMenu}
      className={`overflow-y-auto overflow-x-hidden px-6 pt-3 pb-20 ${className}`}
      style={{
        maxHeight,
      }}
    >
      <div className="mx-auto w-full max-w-[900px] space-y-12 break-words">
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

          // 本轮所有 assistant 消息的文本列表（从上一个 user 消息之后到本条）
          let turnTexts: string[] | undefined;
          if (isLastOfTurn) {
            // 找本轮起始：上一个 user 消息
            let turnStart = 0;
            for (let j = i - 1; j >= 0; j--) {
              if (visibleMessages[j].role === "user") {
                turnStart = j + 1;
                break;
              }
            }
            turnTexts = [];
            for (let j = turnStart; j <= i; j++) {
              const m = visibleMessages[j];
              if (m.role !== "assistant") continue;
              const parts = m.parts?.filter((p): p is { type: "text"; text: string } => p.type === "text" && Boolean(p.text));
              const text = parts?.length ? parts.map((p) => p.text).join("\n") : m.content ?? "";
              if (text) turnTexts.push(text);
            }
          }

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
              turnTexts={turnTexts}
            />
          );
        })}

      </div>

      {/* 选中文本右键菜单 */}
      {contextMenu && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
});

// ─── Message Item ───────────────────────────────────────────────────

const MessageItem = memo(function MessageItem({
  message,
  showActions = false,
  turnUsage,
  turnTexts,
}: {
  message: ChatMessage;
  showActions?: boolean;
  turnUsage?: ChatMessage["usage"];
  /** 本轮所有 assistant 消息的纯文本列表（isLastOfTurn 时传入） */
  turnTexts?: string[];
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
        turnTexts={turnTexts}
      />
    );
  }
  if (message.role === "system") {
    // 上下文压缩状态消息
    if (message.compact) {
      return <CompactBubble compact={message.compact} />;
    }
    // 其他系统消息（错误等）
    return (
      <div className="text-[13px] text-danger p-3 bg-danger/8 rounded-lg font-mono">
        {message.content}
      </div>
    );
  }
  return null;
});

// ─── Context Compact Bubble ─────────────────────────────────────────

const CompactBubble = memo(function CompactBubble({
  compact,
}: {
  compact: NonNullable<ChatMessage["compact"]>;
}) {
  const { status, tokensBefore, summaryPreview, reason } = compact;
  const [open, setOpen] = useState(false);

  if (status === "running") {
    return (
      <div className="flex items-center justify-center py-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-t-ghost">
          <Loader2 size={12} className="animate-spin" />
          压缩上下文中…
        </span>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex items-center justify-center py-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-warning/80">
          <AlertCircle size={12} />
          上下文压缩失败{reason ? `：${reason}` : ""}
        </span>
      </div>
    );
  }

  // status === "done"：一条克制的分隔线 + 可展开摘要
  return (
    <div className="py-1.5">
      <button
        onClick={() => summaryPreview && setOpen((v) => !v)}
        className={`group flex items-center gap-2 w-full ${summaryPreview ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className="flex-1 h-px bg-border/60" />
        <span className="inline-flex items-center gap-1 text-[10.5px] text-t-faint group-hover:text-t-ghost transition-colors whitespace-nowrap">
          <Archive size={11} />
          历史已压缩
          {typeof tokensBefore === "number" ? ` · ${formatTokens(tokensBefore)} tokens` : ""}
          {summaryPreview ? (
            <ChevronRight
              size={11}
              className={`transition-transform ${open ? "rotate-90" : ""}`}
            />
          ) : null}
        </span>
        <span className="flex-1 h-px bg-border/60" />
      </button>
      {open && summaryPreview ? (
        <div className="markdown-body mt-2 mx-auto max-w-[680px] text-[12px] opacity-80">
          <ReactMarkdown remarkPlugins={[...remarkPlugins]} rehypePlugins={[...rehypePlugins]}>{summaryPreview}</ReactMarkdown>
        </div>
      ) : null}
    </div>
  );
});

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
