import { useEffect, useRef, memo, useMemo, useCallback } from "react";
import { useMessageById, useIsStreaming, useChat } from "@/stores/chat";
import { useAutoScrollToBottom } from "@/hooks/auto-scroll";
import { isToolCall, isActionButton } from "@/types/chat";
import type { AnyMessage, DiffMeta, ChatMessage } from "@/types/chat";
import { isGroupableTool, getGroupKey } from "./toolClassification";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { PixelLogo } from "@/components/PixelLogo";
import { ToolCallCard, ToolCallGroup } from "./ToolCallCard";
import { ActionButton } from "./ActionButton";
import { DiffSummaryCard } from "./DiffSummaryCard";
import { streamManager } from "@/services/stream-manager";
import { RotateCcw } from "lucide-react";

const MSG_ITEM_STYLE: React.CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 120px",
};

// ═══════════════════════════════════════════════════════════════════════
// 消息分组逻辑
// ═══════════════════════════════════════════════════════════════════════

/** 渲染单元：单条消息 / 一组连续同类型工具调用 / diff 摘要卡片 / AI回复开始标记 */
type RenderUnit =
  | { type: "single"; id: string }
  | { type: "group"; toolName: string; ids: string[]; key: string }
  | {
      type: "diff_summary";
      messageId: string;
      baseHash: string;
      finalHash: string;
      workspace: string;
      key: string;
    }
  | { type: "ai_turn_start"; key: string };

/**
 * 将消息列表分组：连续相同名称的可分组工具调用合并为一个 RenderUnit。
 * 只有连续 2+ 个相同工具名的才合并，单个的保持原样。
 */
function groupMessages(messages: AnyMessage[]): RenderUnit[] {
  const units: RenderUnit[] = [];
  let i = 0;
  // 追踪上一条 user 消息的 diff 信息，在本轮结束时（下一个 user 之前或列表末尾）插入
  let pendingDiff: {
    messageId: string;
    baseHash: string;
    finalHash: string;
    workspace: string;
  } | null = null;
  let pendingDiffKey = "";
  // 追踪本轮是否需要插入 AI turn start 标记
  let needAiTurnStart = false;
  let lastUserId = "";

  while (i < messages.length) {
    const msg = messages[i];

    // 遇到新的 user 消息 → 先把上一轮的 diff 信息插入（如果有），并标记需要插入 AI turn start
    if ("role" in msg && msg.role === "user") {
      if (pendingDiff) {
        units.push({
          type: "diff_summary",
          ...pendingDiff,
          key: pendingDiffKey,
        });
        pendingDiff = null;
      }
      // 记录这条 user 消息的 diff 信息（如果有），等本轮结束时插入
      const chatMsg = msg as import("@/types/chat").ChatMessage;
      if (chatMsg.diffMeta) {
        pendingDiff = {
          messageId: msg.id,
          baseHash: chatMsg.diffMeta.base_hash,
          finalHash: chatMsg.diffMeta.final_hash,
          workspace: chatMsg.diffMeta.workspace,
        };
        pendingDiffKey = `diff-${msg.id}`;
      }
      needAiTurnStart = true;
      lastUserId = msg.id;
    }

    // user 消息之后、AI 开始回复前，插入 AI turn start 标记
    if (needAiTurnStart && "role" in msg && msg.role !== "user") {
      units.push({ type: "ai_turn_start", key: `ai-start-${lastUserId}` });
      needAiTurnStart = false;
    }
    if (needAiTurnStart && isToolCall(msg)) {
      units.push({ type: "ai_turn_start", key: `ai-start-${lastUserId}` });
      needAiTurnStart = false;
    }

    // 检查是否是可分组的工具调用（read/glob/grep 统一归入 explore 组）
    if (isToolCall(msg) && isGroupableTool(msg.name)) {
      const groupKey = getGroupKey(msg.name);
      const groupIds: string[] = [msg.id];
      let j = i + 1;

      while (j < messages.length) {
        const next = messages[j];
        if (
          isToolCall(next) &&
          isGroupableTool(next.name) &&
          getGroupKey(next.name) === groupKey
        ) {
          groupIds.push(next.id);
          j++;
        } else {
          break;
        }
      }

      if (groupIds.length >= 2) {
        units.push({
          type: "group",
          toolName: groupKey,
          ids: groupIds,
          key: `group-${groupIds[0]}`,
        });
      } else {
        units.push({ type: "single", id: msg.id });
      }
      i = j;
    } else {
      units.push({ type: "single", id: msg.id });
      i++;
    }
  }

  // 列表结束，最后一轮的 diff 信息
  if (pendingDiff) {
    units.push({ type: "diff_summary", ...pendingDiff, key: pendingDiffKey });
  }

  return units;
}

// ═══════════════════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════════════════

const StreamingIndicator = memo(function StreamingIndicator() {
  const isStreaming = useIsStreaming();
  const lastMessageRole = useChat((s) => {
    const msgs = s.messages;
    return msgs.length > 0 ? msgs[msgs.length - 1].role : null;
  });

  if (!isStreaming || !lastMessageRole || lastMessageRole !== "user") {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-neon/60 font-mono">ftre</span>
      <div className="flex gap-[3px]">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-[4px] h-[4px] bg-neon"
            style={{
              animation: "thinking 1.2s ease-in-out infinite",
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
});

/**
 * 结构指纹：只在消息数量或 ID 组合变化时才重新分组。
 * 流式期间只有最后一条消息的 content 在变，结构不变 → 不重新分组 → 不重排子组件。
 */
function useStructuralFingerprint(): string {
  return useChat((s) => {
    const msgs = s.messages;
    if (msgs.length === 0) return "";
    // 检查最后一条 user 消息是否有 diffMeta（避免 O(N) filter）
    let hasDiff = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if ("role" in msgs[i] && (msgs[i] as any).role === "user") {
        hasDiff = (msgs[i] as any).diffMeta ? 1 : 0;
        break;
      }
    }
    return `${msgs.length}:${msgs[0].id}:${msgs[msgs.length - 1].id}:d${hasDiff}`;
  });
}

export function MessageList() {
  const fingerprint = useStructuralFingerprint();
  const sessionId = useChat((s) => s.sessionId);
  const isStreaming = useIsStreaming();

  // 只在结构变化时重新分组 — 通过 getState() 读取避免订阅 messages 引用变化
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const renderUnits = useMemo(
    () => groupMessages(useChat.getState().messages),
    [fingerprint],
  );

  // ① 核心 hook：deps=[sessionId] 切换会话时重置锁
  const { ref, scrollToBottom, resetLock } = useAutoScrollToBottom([sessionId]);

  // 统一滚动调度：同一帧内只执行一次，避免切换会话时多观察器重复触发导致抖动
  const scrollRafRef = useRef<number | null>(null);
  const scheduleScrollToBottom = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      scrollToBottom();
    });
  }, [scrollToBottom]);

  // ② 新一轮流开始时重置锁（用户可能在上方浏览历史后发送消息）
  const prevStreaming = useRef(false);
  useEffect(() => {
    if (isStreaming && !prevStreaming.current) {
      resetLock();
    }
    prevStreaming.current = isStreaming;
  }, [isStreaming, resetLock]);

  // ③ MutationObserver：DOM 变化时 scrollToBottom（rAF 合并）
  const containerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new MutationObserver(() => {
      scheduleScrollToBottom();
    });
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
    };
  }, [scheduleScrollToBottom]);

  // ④ ResizeObserver：容器尺寸变化时保持底部
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => scheduleScrollToBottom());
    ro.observe(el);
    return () => ro.disconnect();
  }, [scheduleScrollToBottom]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  // ⑤ 合并 ref（hook 的 ref 负责事件绑定，containerRef 供 observer 使用）
  const mergedRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      ref(el);
    },
    [ref],
  );

  return (
    <div
      ref={mergedRef}
      className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-5 py-4"
      style={{ willChange: "transform", contain: "layout style" }}
    >
      <div className="mx-auto w-full max-w-[960px] space-y-2 break-words">
        {renderUnits.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-t-dim text-[14px] font-mono pt-20">
            描述你想要构建的内容
          </div>
        )}
        {renderUnits.map((unit) => (
          <div
            key={unit.type === "single" ? unit.id : unit.key}
            style={MSG_ITEM_STYLE}
          >
            {unit.type === "ai_turn_start" ? (
              <div className="mt-4 mb-1 flex items-center h-[20px]">
                <PixelLogo size={2} />
              </div>
            ) : unit.type === "group" ? (
              <GroupedToolCalls
                toolName={unit.toolName}
                messageIds={unit.ids}
              />
            ) : unit.type === "diff_summary" ? (
              <DiffSummaryCard
                messageId={unit.messageId}
                baseHash={unit.baseHash}
                finalHash={unit.finalHash}
                workspace={unit.workspace}
              />
            ) : (
              <MessageItem
                messageId={unit.id}
                isLast={unit === renderUnits[renderUnits.length - 1]}
              />
            )}
          </div>
        ))}
        <StreamingIndicator />
      </div>
    </div>
  );
}

/** 渲染一组合并的工具调用 — 直接传 messageIds 给 ToolCallGroup，每个 chip 独立订阅 */
const GroupedToolCalls = memo(function GroupedToolCalls({
  toolName,
  messageIds,
}: {
  toolName: string;
  messageIds: string[];
}) {
  return <ToolCallGroup toolName={toolName} messageIds={messageIds} />;
});

const MessageItem = memo(function MessageItem({
  messageId,
  isLast = false,
}: {
  messageId: string;
  isLast?: boolean;
}) {
  const message = useMessageById(messageId);
  const isStreaming = useIsStreaming();

  if (!message) return null;

  if (isToolCall(message)) {
    return <ToolCallCard message={message} />;
  }
  if (isActionButton(message)) {
    return <ActionButton message={message} />;
  }
  if (message.role === "user") {
    return <UserMessage message={message as ChatMessage} />;
  }
  if (message.role === "assistant") {
    return <AssistantMessage message={message as ChatMessage} />;
  }
  if (message.role === "system") {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-[13px] text-danger p-3 bg-danger/[0.08] rounded-lg font-mono">
          {message.content}
        </div>
        {isLast && !isStreaming && (
          <button
            onClick={() => streamManager.retryLastMessage()}
            className="inline-flex items-center gap-1.5 self-start px-3 py-1.5 text-xs text-t-secondary bg-white/[0.06] hover:bg-white/[0.10] rounded-lg transition-colors"
          >
            <RotateCcw size={12} />
            重试
          </button>
        )}
      </div>
    );
  }
  return null;
});
