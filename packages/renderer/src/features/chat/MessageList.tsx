import { useEffect, useLayoutEffect, useRef, memo, useMemo, useCallback } from "react";
import { useMessageById, useIsStreaming, useChat } from "@/stores/chat";
import { useAutoScrollToBottom } from "@/hooks/auto-scroll";
import type { ChatMessage } from "@/services/ws-stream-manager";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { PixelLogo } from "@/components/PixelLogo";
import { RotateCcw } from "lucide-react";

/** 获取消息项样式，流式消息禁用 contentVisibility 以确保准确的高度计算 */
function getItemStyle(isLastAndStreaming: boolean): React.CSSProperties {
  if (isLastAndStreaming) {
    return { containIntrinsicSize: "auto 120px" };
  }
  return {
    contentVisibility: "auto",
    containIntrinsicSize: "auto 120px",
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 消息分组逻辑（简化版：只区分 user / assistant turn）
// ═══════════════════════════════════════════════════════════════════════

type RenderUnit =
  | { type: "single"; id: string }
  | { type: "ai_turn_start"; key: string };

function groupMessages(messages: ChatMessage[]): RenderUnit[] {
  const units: RenderUnit[] = [];
  let needAiTurnStart = false;
  let lastUserId = "";

  for (const msg of messages) {
    if (msg.role === "user") {
      needAiTurnStart = true;
      lastUserId = msg.id;
    }

    // Insert AI turn start marker before first non-user message after a user message
    if (needAiTurnStart && msg.role !== "user") {
      units.push({ type: "ai_turn_start", key: `ai-start-${lastUserId}` });
      needAiTurnStart = false;
    }

    units.push({ type: "single", id: msg.id });
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
 */
function useStructuralFingerprint(): string {
  return useChat((s) => {
    const msgs = s.messages;
    if (msgs.length === 0) return "";
    return `${msgs.length}:${msgs[0].id}:${msgs[msgs.length - 1].id}`;
  });
}

export function MessageList() {
  const fingerprint = useStructuralFingerprint();
  const activeChatId = useChat((s) => s.activeChatId);
  const isStreaming = useIsStreaming();

  // 只在结构变化时重新分组
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const renderUnits = useMemo(
    () => groupMessages(useChat.getState().messages),
    [fingerprint],
  );

  // ① 核心 hook：deps=[activeChatId] 切换会话时重置锁
  const { ref, scrollToBottom, resetLock } = useAutoScrollToBottom([activeChatId]);

  // 统一滚动调度
  const scrollRafRef = useRef<number | null>(null);
  const scheduleScrollToBottom = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      scrollToBottom();
    });
  }, [scrollToBottom]);

  // ② 新一轮流开始时重置锁
  const prevStreaming = useRef(false);
  useEffect(() => {
    if (isStreaming && !prevStreaming.current) {
      resetLock();
    }
    prevStreaming.current = isStreaming;
  }, [isStreaming, resetLock]);

  // ③ MutationObserver
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

  // ④ ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => scheduleScrollToBottom());
    ro.observe(el);
    return () => ro.disconnect();
  }, [scheduleScrollToBottom]);

  // ⑤ 初始滚动
  useLayoutEffect(() => {
    const timer = setTimeout(() => {
      scrollToBottom();
    }, 50);
    return () => clearTimeout(timer);
  }, [activeChatId, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  // 合并 ref
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
        {renderUnits.map((unit, index) => {
          const isLast = index === renderUnits.length - 1;
          return (
            <div
              key={unit.type === "single" ? unit.id : unit.key}
              style={getItemStyle(isLast && isStreaming)}
            >
              {unit.type === "ai_turn_start" ? (
                <div className="mt-4 mb-1 flex items-center h-[20px]">
                  <PixelLogo size={2} />
                </div>
              ) : (
                <MessageItem messageId={unit.id} isLast={isLast} />
              )}
            </div>
          );
        })}
        <StreamingIndicator />
      </div>
    </div>
  );
}

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

  if (message.role === "user") {
    return <UserMessage message={message} />;
  }
  if (message.role === "assistant") {
    return <AssistantMessage message={message} />;
  }
  if (message.role === "system") {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-[13px] text-danger p-3 bg-danger/[0.08] rounded-lg font-mono">
          {message.content}
        </div>
        {isLast && !isStreaming && (
          <button
            onClick={() => console.warn("retryLastMessage not yet implemented")}
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
