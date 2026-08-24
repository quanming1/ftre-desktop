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
import type { CSSProperties, ReactNode } from "react";
import { Loader2, Archive, AlertCircle, ChevronRight, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/stores/chat";
import { useAutoScrollToBottom } from "@/hooks/auto-scroll";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { ChatOutline } from "./ChatOutline";
import {
  collectTurnFileChanges,
  shouldShowThinkingPlaceholder,
  type TurnFileChange,
} from "./turnFileChangeUtils";
import { ContextMenu, type ContextMenuItem } from "@ftre/ui";
import { remarkPlugins, rehypePlugins } from "@/lib/markdown-plugins";
import { shouldShowTurnActions } from "./turnActions";

// ─── Types ──────────────────────────────────────────────────────────

export interface ChatMessageListProps {
  messages: ChatMessage[];
  /** Whether the agent is currently processing (shows typing indicator) */
  isBusy?: boolean;
  /** Number of locally queued messages before the first user echo arrives. */
  pendingMessagesCount?: number;
  /** Auto-scroll to bottom on new messages */
  autoScroll?: boolean;
  /** Max height CSS value (default: none, fills parent) */
  maxHeight?: string;
  /** Class name for the outer container */
  className?: string;
  /** Three-column grid used to align the left rail, message body, and right rail. */
  layoutClassName?: string;
  /** Optional content rendered in the right layout rail. */
  rightRail?: ReactNode;
  /** Inline styles for scroll-area safety insets owned by the parent layout. */
  style?: CSSProperties;
}

// ─── Component ──────────────────────────────────────────────────────

export const ChatMessageList = memo(function ChatMessageList({
  messages,
  isBusy = false,
  pendingMessagesCount = 0,
  autoScroll = true,
  maxHeight,
  className = "",
  layoutClassName = "grid-cols-[minmax(0,1fr)_minmax(0,848px)_minmax(0,1fr)]",
  rightRail,
  style,
}: ChatMessageListProps) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const containerRef = useRef<HTMLDivElement>(null);

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
  // deps: sessionId 变化 → 切 session 时重置锁
  // 不用 lastMsgId：ReAct 循环每轮新增消息会让 lastMsgId 变化，
  // 触发锁重置 → 把用户滚上去的位置强制拉回底部。
  const sessionId = useChat((s) => s.sessionId);
  const { ref: autoScrollRef, scrollToBottom, resetLock } = useAutoScrollToBottom(
    [sessionId],
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
  const lastMsg = safeMessages[safeMessages.length - 1];
  const tailFingerprint =
    !lastMsg
      ? ""
      : `${lastMsg.id}:${(lastMsg.content ?? "").length}:${
          lastMsg.blocks
            ?.map((b) =>
              b.type === "toolCall"
                ? `t${b.id}`
                : b.type === "thinking"
                  ? `r${b.thinking.length}`
                  : b.type === "data"
                    ? `d${b.data.length}`
                    : `x${b.text.length}`,
            )
            .join("|") ?? ""
        }:${
          lastMsg.toolResults
            ? Object.entries(lastMsg.toolResults)
                .map(([id, r]) => `${id}${r.status}${(r.result ?? "").length}`)
                .join("|")
            : ""
        }`;

  useEffect(() => {
    if (!autoScroll) return;
    scrollToBottom();
  }, [tailFingerprint, autoScroll, scrollToBottom]);

  // ─── 加载更多（后端分页）──────────────────────────────────────────

  const hasMoreHistory = useChat((s) =>
    sessionId ? s.hasMoreHistory(sessionId) : false,
  );
  const loadEarlier = useSession((s) => s.loadEarlierMessages);

  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadMore = useCallback(async () => {
    if (!hasMoreHistory || !sessionId || loadingHistory) return;
    const el = containerRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setLoadingHistory(true);
    try {
      await loadEarlier(sessionId);
      requestAnimationFrame(() => {
        if (!el) return;
        el.scrollTop += el.scrollHeight - prevHeight;
      });
    } finally {
      setLoadingHistory(false);
    }
  }, [hasMoreHistory, sessionId, loadingHistory, loadEarlier]);

  return (
    <div
      ref={mergedRef}
      data-chat-scroll-container=""
      onContextMenu={handleContextMenu}
      className={`overflow-y-auto overflow-x-hidden ${className}`}
      style={{
        maxHeight,
        ...style,
      }}
    >
      <div className={`grid min-h-full ${layoutClassName}`}>
        <ChatOutline messages={safeMessages} />

        <div className="col-start-2 min-w-0 px-6 pb-0 pt-3">
          <div className="mx-auto w-full max-w-[800px] space-y-4 break-words">
        {/* Load more */}
        {hasMoreHistory && (
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
              ) : (
                <>从服务器加载更早的消息</>
              )}
            </button>
          </div>
        )}

        {safeMessages.length === 0 && !isBusy && (
          <div className="text-center text-t-dim text-sm py-12">
            No messages
          </div>
        )}

        {safeMessages.map((msg, i) => {
          const next = safeMessages[i + 1];
          const isTurnEnd =
            msg.role === "assistant" &&
            !msg.streaming &&
            (!next || next.role !== "assistant");
          const showTurnActions = shouldShowTurnActions(safeMessages, i, isBusy);

          // 本轮所有 assistant 消息的文本列表（从上一个 user 消息之后到本条）
          let turnTexts: string[] | undefined;
          let turnFileChanges: TurnFileChange[] | undefined;
          if (isTurnEnd) {
            let turnStart = 0;
            for (let j = i - 1; j >= 0; j--) {
              if (safeMessages[j].role === "user") {
                turnStart = j + 1;
                break;
              }
            }
            turnTexts = [];
            for (let j = turnStart; j <= i; j++) {
              const m = safeMessages[j];
              if (m.role !== "assistant") continue;
              const text = m.content ?? "";
              if (text) turnTexts.push(text);
            }
            const changes = collectTurnFileChanges(safeMessages, i);
            turnFileChanges = changes.length > 0 ? changes : undefined;
          }

          return (
            <MessageItem
              key={msg.id}
              message={msg}
              showActions={showTurnActions}
              turnTexts={turnTexts}
              turnFileChanges={turnFileChanges}
              turnId={msg.id}
              turnDurationSec={msg.durationSec}
              turnModel={msg.model}
            />
          );
        })}

        {shouldShowThinkingPlaceholder(safeMessages, isBusy, pendingMessagesCount) && (
          <div
            data-testid="thinking-placeholder"
            className="py-3"
          >
            <span className="animate-process-breath text-[14px] text-t-dim">处理中</span>
          </div>
        )}

          </div>
        </div>

        {rightRail && (
          <aside className="sticky top-0 col-start-3 row-start-1 min-h-0 self-start px-4 pb-4 pt-2">
            {rightRail}
          </aside>
        )}
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
  turnTexts,
  turnFileChanges,
  turnId,
  turnDurationSec,
  turnModel,
}: {
  message: ChatMessage;
  showActions?: boolean;
  /** 本轮所有 assistant 消息的纯文本列表（isLastOfTurn 时传入） */
  turnTexts?: string[];
  /** 本轮所有 edit/write 文件变更列表（isLastOfTurn 时传入） */
  turnFileChanges?: TurnFileChange[];
  /** 代表本轮结束的 assistant 消息 ID。 */
  turnId?: string;
  /** 本轮耗时（秒） */
  turnDurationSec?: number;
  /** 本轮使用的模型 ID */
  turnModel?: string;
}) {
  if (message.role === "user") {
    return <UserMessage message={message} />;
  }
  if (message.role === "assistant") {
    return (
      <AssistantMessage
        message={message}
        showActions={showActions}
        turnTexts={turnTexts}
        turnFileChanges={turnFileChanges}
        turnId={turnId}
        turnDurationSec={turnDurationSec}
        turnModel={turnModel}
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
  const { status, mode, tokensBefore, tokensAfter, summaryPreview, eventsCleared, toolResults, reason } = compact;
  const [open, setOpen] = useState(false);

  if (status === "running") {
    return (
      <div className="flex items-center justify-start py-2">
        <span className="inline-flex items-center gap-1.5 text-[14px] text-t-dim">
          <Loader2 size={12} className="animate-spin" />
          {mode === "fast" ? "快速压缩中…" : "压缩上下文中…"}
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

  // status === "done"
  const isFast = mode === "fast";
  const label = isFast ? "工具输出已裁剪" : "历史已压缩";
  const tokensStr = typeof tokensBefore === "number" && typeof tokensAfter === "number"
    ? `${formatTokens(tokensBefore)} → ${formatTokens(tokensAfter)} tokens`
    : typeof tokensBefore === "number"
      ? `${formatTokens(tokensBefore)} tokens`
      : "";
  const eventsCount = eventsCleared ?? toolResults;
  const eventsStr = typeof eventsCount === "number" ? `${eventsCount} 条工具输出` : "";
  const detailParts = [tokensStr, eventsStr].filter(Boolean);
  const detailStr = detailParts.length > 0 ? ` · ${detailParts.join(" · ")}` : "";

  return (
    <div className="py-2">
      <button
        onClick={() => summaryPreview && setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 text-[14px] text-t-dim ${summaryPreview ? "cursor-pointer hover:text-t-ghost transition-colors" : "cursor-default"}`}
      >
        <Archive size={12} />
        {label}{detailStr}
        {summaryPreview ? (
          <ChevronRight
            size={11}
            className={`transition-transform ${open ? "rotate-90" : ""}`}
          />
        ) : null}
      </button>
      {open && summaryPreview ? (
        <div className="markdown-body mt-2 max-w-[680px] text-[12px] opacity-80">
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
