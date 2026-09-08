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
import { collapsedAssistantBlocks } from "./assistantMessageDisplay";
import { ContextMenu, type ContextMenuItem } from "@ftre/ui";
import { remarkPlugins, rehypePlugins, urlTransform } from "@/lib/markdown-plugins";
import { FtreExtensionImage } from "@/lib/ftre-extensions";
import { HttpLink, parseHttpUrl } from "@/components/HttpLink";
import { shouldShowTurnActions } from "./turnActions";

const compactMarkdownComponents = {
  img: FtreExtensionImage,
  a({ href, children }: { href?: string; children?: ReactNode }) {
    return href && parseHttpUrl(href) ? <HttpLink href={href}>{children}</HttpLink> : <a href={href}>{children}</a>;
  },
};

// ─── Types ──────────────────────────────────────────────────────────

export interface ChatMessageListProps {
  messages: ChatMessage[];
  /** Agent 正在执行当前 Turn；队列 pending 或压缩不属于普通处理中占位。 */
  hasActiveTurn?: boolean;
  /** Number of locally queued messages before the first user echo arrives. */
  pendingMessagesCount?: number;
  /** Compaction has its own status bubble; do not render the generic thinking placeholder. */
  isCompacting?: boolean;
  /** Max height CSS value (default: none, fills parent) */
  maxHeight?: string;
  /** Class name for the outer container */
  className?: string;
  /** Three-column grid used to align the left rail, message body, and right rail. */
  layoutClassName?: string;
  /** Optional content rendered in the right layout rail. */
  rightRail?: ReactNode;
  /** Ctrl+F 搜索关键词（空串表示搜索未开启，消息不做高亮）。 */
  searchQuery?: string;
  /** 当前定位的匹配消息 ID（该消息容器会高亮提示）。 */
  activeMatchMsgId?: string;
  /** Inline styles for scroll-area safety insets owned by the parent layout. */
  style?: CSSProperties;
}

// ─── Component ──────────────────────────────────────────────────────

export const ChatMessageList = memo(function ChatMessageList({
  messages,
  hasActiveTurn = false,
  pendingMessagesCount = 0,
  isCompacting = false,
  searchQuery = "",
  activeMatchMsgId,
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
  const { ref: autoScrollRef } = useAutoScrollToBottom(
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

  // ─── 滚底单一事实源：useAutoScrollToBottom 内部 ResizeObserver ───
  // 观察滚动容器与内容层：任何内容高度变化（新消息、流式增长、占位符）
  // 都在绘制前完成 scrollToBottom。
  // 跟随与否完全由用户行为决定（wheel 向上解锁、滚回底部附近重新锁定）；
  // 不在 TURN_START/占位符出现时强制 resetLock——那会把滚上去看历史的
  // 用户强行拉回底部。

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
        // 滚动条槽位固定：避免首次溢出时滚动条出现引发宽度重排抖动。
        scrollbarGutter: "stable",
        ...style,
      }}
    >
      <div className={`grid min-h-full ${layoutClassName}`}>
        <ChatOutline messages={safeMessages} />

        <div className="col-start-2 min-w-0 px-6 pb-0 pt-3">
          {/* 消息间距统一走 padding（见 global.css [data-msg-role]/[data-assistant-message] 规则），
              不用 space-y-*：margin 系间距在子元素增删时依赖 last-child 判定，易产生一帧错位。 */}
          <div className="mx-auto flex w-full max-w-[800px] flex-col break-words">
        {/* Load more */}
        {hasMoreHistory && (
          <div className="shrink-0 text-center py-2">
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

        {safeMessages.length === 0 && !hasActiveTurn && (
          <div className="text-center text-t-dim text-sm py-12">
            No messages
          </div>
        )}
        {renderMessageItems(safeMessages, {
          hasActiveTurn,
          searchQuery,
          activeMatchMsgId,
        })}

        {!isCompacting && shouldShowThinkingPlaceholder(safeMessages, hasActiveTurn, pendingMessagesCount) && (
          <div
            data-testid="thinking-placeholder"
            className="shrink-0 pt-4 pb-1"
          >
            <span className="animate-process-breath text-[14px] text-t-dim">处理中</span>
          </div>
        )}

        {/* 底部固定预留：输入框上方浮层（队列横幅/变更摘要）覆盖在此空白区，
            高度恒定（72px）——横幅出现/消失不改变消息列表布局，从根上消除
            发送消息时的布局跳动。 */}
        <div className="shrink-0" aria-hidden="true" style={{ height: 72 }} />

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

/**
 * turn 文件变更缓存：key 为 turn-end 消息对象。
 * turn 区间由消息列表的不可变前缀决定，同一 turn-end 消息对象的变更集合恒定，
 * 缓存返回稳定数组引用，避免流式期间反复扫描 + memo 失效。
 */
const turnFileChangesCache = new WeakMap<ChatMessage, TurnFileChange[]>();

function getTurnFileChanges(
  turnEnd: ChatMessage,
  messages: ChatMessage[],
  index: number,
): TurnFileChange[] {
  const cached = turnFileChangesCache.get(turnEnd);
  if (cached) return cached;
  const changes = collectTurnFileChanges(messages, index);
  turnFileChangesCache.set(turnEnd, changes);
  return changes;
}

function hasAssistantProcess(message: ChatMessage): boolean {
  if (message.role !== "assistant") return false;
  const blocks = message.blocks ?? [];
  return blocks.length > collapsedAssistantBlocks(blocks, message.toolResults).length;
}

interface MessageRenderOptions {
  hasActiveTurn: boolean;
  searchQuery: string;
  activeMatchMsgId?: string;
}

function renderMessageItems(
  messages: ChatMessage[],
  options: MessageRenderOptions,
): ReactNode[] {
  const rendered: ReactNode[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    if (message.role !== "assistant") {
      rendered.push(renderMessageItem(message, index, messages, options));
      index += 1;
      continue;
    }

    const startIndex = index;
    while (index < messages.length && messages[index].role === "assistant") {
      index += 1;
    }
    rendered.push(
      <AssistantTurnGroup
        key={`assistant-turn-${messages[startIndex].id}`}
        messages={messages.slice(startIndex, index)}
        startIndex={startIndex}
        allMessages={messages}
        {...options}
      />,
    );
  }

  return rendered;
}

function renderMessageItem(
  message: ChatMessage,
  index: number,
  messages: ChatMessage[],
  options: MessageRenderOptions,
  processExpandedOverride?: boolean,
  hideProcessHeader = false,
): ReactNode {
  const next = messages[index + 1];
  const isTurnEnd =
    message.role === "assistant" &&
    !message.streaming &&
    (!next || next.role !== "assistant");
  const showTurnActions = shouldShowTurnActions(messages, index, options.hasActiveTurn);

  // 本轮 edit/write 文件变更列表（isTurnEnd 时传入）。
  // 用 WeakMap 按 turn-end 消息对象缓存：同一消息对象对应的 turn 区间
  // 不可变（历史消息不会被原地修改），缓存命中即返回稳定引用——
  // 避免每次渲染重建数组、破坏 AssistantMessage 的 memo。
  let turnFileChanges: TurnFileChange[] | undefined;
  if (isTurnEnd) {
    const changes = getTurnFileChanges(message, messages, index);
    turnFileChanges = changes.length > 0 ? changes : undefined;
  }

  return (
    <MessageItem
      key={message.id}
      message={message}
      showActions={showTurnActions}
      turnFileChanges={turnFileChanges}
      turnId={message.id}
      turnDurationSec={message.durationSec}
      turnModel={message.model}
      turnFinishedAt={message.finishedAt}
      hideProcessHeader={hideProcessHeader}
      processExpandedOverride={processExpandedOverride}
      searchQuery={options.searchQuery}
      isActiveMatch={options.activeMatchMsgId === message.id}
    />
  );
}

function AssistantTurnGroup({
  messages,
  startIndex,
  allMessages,
  hasActiveTurn,
  searchQuery,
  activeMatchMsgId,
}: {
  messages: ChatMessage[];
  startIndex: number;
  allMessages: ChatMessage[];
} & MessageRenderOptions) {
  const hasProcess = messages.some(hasAssistantProcess);
  const isStreaming = messages.some((message) => message.streaming);
  const durationSec = [...messages]
    .reverse()
    .find((message) => typeof message.durationSec === "number")
    ?.durationSec;
  const [processExpanded, setProcessExpanded] = useState(isStreaming);

  useEffect(() => {
    setProcessExpanded(isStreaming);
  }, [isStreaming]);

  const renderChild = (message: ChatMessage, offset: number): ReactNode =>
    renderMessageItem(
      message,
      startIndex + offset,
      allMessages,
      { hasActiveTurn, searchQuery, activeMatchMsgId },
      hasProcess ? processExpanded : undefined,
      hasProcess,
    );

  if (!hasProcess) {
    return <>{messages.map(renderChild)}</>;
  }

  return (
    <>
      <button
        type="button"
        data-assistant-process-header="true"
        aria-expanded={processExpanded}
        onClick={() => setProcessExpanded((expanded) => !expanded)}
        className="group mb-2 block w-full py-1.5 text-left text-[14px] text-t-dim transition-colors hover:text-t-secondary"
      >
        <span className="flex items-center gap-1.5">
          <span className="shrink-0">
            {isStreaming
              ? "处理中"
              : `已处理${typeof durationSec === "number" ? ` ${formatTurnDuration(durationSec)}` : ""}`}
          </span>
          <ChevronRight
            size={12}
            className={`shrink-0 transition-transform duration-200 ${processExpanded ? "rotate-90" : ""}`}
          />
        </span>
        <span className="mt-1.5 block h-px w-full bg-border/60" />
      </button>
      {messages.map(renderChild)}
    </>
  );
}

function formatTurnDuration(sec: number): string {
  if (sec < 60) return `${sec}秒`;
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分钟`;
}

const MessageItem = memo(function MessageItem({
  message,
  showActions = false,
  turnFileChanges,
  turnId,
  turnDurationSec,
  turnModel,
  turnFinishedAt,
  hideProcessHeader = false,
  processExpandedOverride,
  searchQuery = "",
  isActiveMatch = false,
}: {
  message: ChatMessage;
  showActions?: boolean;
  /** 本轮所有 edit/write 文件变更列表（isLastOfTurn 时传入，引用稳定） */
  turnFileChanges?: TurnFileChange[];
  /** 代表本轮结束的 assistant 消息 ID。 */
  turnId?: string;
  /** 本轮耗时（秒） */
  turnDurationSec?: number;
  /** 本轮使用的模型 ID */
  turnModel?: string;
  turnFinishedAt?: number;
  /** 连续 Assistant 消息由外层 Turn 统一展示过程栏时隐藏本地栏。 */
  hideProcessHeader?: boolean;
  /** 外层 Turn 共享的过程展开状态。 */
  processExpandedOverride?: boolean;
  /** Ctrl+F 搜索关键词（用于文本高亮） */
  searchQuery?: string;
  /** 当前定位的匹配消息（容器高亮提示） */
  isActiveMatch?: boolean;
}) {
  if (message.role === "user") {
    return (
      <UserMessage
        message={message}
        searchQuery={searchQuery}
        isActiveMatch={isActiveMatch}
      />
    );
  }
  if (message.role === "assistant") {
    return (
      <AssistantMessage
        message={message}
        showActions={showActions}
        turnFileChanges={turnFileChanges}
        turnId={turnId}
        turnDurationSec={turnDurationSec}
        turnModel={turnModel}
        turnFinishedAt={turnFinishedAt}
        hideProcessHeader={hideProcessHeader}
        processExpandedOverride={processExpandedOverride}
        isActiveMatch={isActiveMatch}
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
      <div data-msg-role="system" className="text-[13px] text-danger p-3 bg-danger/8 rounded-lg font-mono">
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
      <div data-compact-bubble="true" className="flex items-center justify-start py-2">
        <span className="inline-flex items-center gap-1.5 text-[14px] text-t-dim">
          <Loader2 size={12} className="animate-spin" />
          {mode === "fast" ? "快速压缩中…" : "压缩上下文中…"}
        </span>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div data-compact-bubble="true" className="flex items-center justify-center py-2">
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
    <div data-compact-bubble="true" className="py-2">
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
          <ReactMarkdown
            remarkPlugins={[...remarkPlugins]}
            rehypePlugins={[...rehypePlugins]}
            components={compactMarkdownComponents}
            urlTransform={urlTransform}
          >
            {summaryPreview}
          </ReactMarkdown>
        </div>
      ) : null}
    </div>
  );
});

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
