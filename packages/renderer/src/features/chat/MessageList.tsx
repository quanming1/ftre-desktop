import {
  useEffect,
  useLayoutEffect,
  useRef,
  memo,
  useMemo,
  useCallback,
  useState,
} from "react";
import { useMessageById, useIsBusy, useChat, useProgress } from "@/stores/chat";
import { useAutoScrollToBottom } from "@/hooks/auto-scroll";
import type { ChatMessage } from "@/stores/chat";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { PixelLogo } from "@/components/PixelLogo";
import { RotateCcw, ChevronUp } from "lucide-react";

// ══════════════════════════════════════════════════════════════════════�?// 分页常量
// ══════════════════════════════════════════════════════════════════════�?
/** 初始显示的对话轮�?*/
const INITIAL_VISIBLE_ROUNDS = 10;
/** 每次加载更多的轮�?*/
const LOAD_MORE_ROUNDS = 20;

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

// ══════════════════════════════════════════════════════════════════════�?// 消息分组逻辑（简化版：只区分 user / assistant turn�?// ══════════════════════════════════════════════════════════════════════�?
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

/**
 * 获取最�?N 轮对话的消息
 * 一�?= 一�?user 消息 + 后续�?assistant/system 消息
 */
function getLastNRounds(
  messages: ChatMessage[],
  rounds: number,
): ChatMessage[] {
  if (messages.length === 0 || rounds <= 0) return [];

  // 从后往前找到第 N �?user 消息的位�?  let userCount = 0;
  let startIndex = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userCount++;
      if (userCount >= rounds) {
        startIndex = i;
        break;
      }
    }
  }

  return messages.slice(startIndex);
}

/**
 * 统计消息中的对话轮数（user 消息数量�? */
function countRounds(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "user").length;
}

// ══════════════════════════════════════════════════════════════════════�?// 组件
// ══════════════════════════════════════════════════════════════════════�?
/** Progress indicator shown when agent is processing */
const ProgressIndicator = memo(function ProgressIndicator() {
  const progress = useProgress();
  const isBusy = useIsBusy();

  if (!isBusy) return null;

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[12px] text-neon/60 font-mono">ftre</span>
      {progress ? (
        <span className="text-[12px] text-t-secondary italic">
          {progress.text}
        </span>
      ) : (
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
      )}
    </div>
  );
});

// NOTE: ToolCallsSection removed - tool calls are now rendered inline within AssistantMessage
// via message.toolCalls. The legacy session.toolCalls array is kept for backward compatibility
// but is no longer rendered separately.

/** 加载更多历史消息按钮 */
const LoadMoreButton = memo(function LoadMoreButton({
  hiddenRounds,
  onClick,
}: {
  hiddenRounds: number;
  onClick: () => void;
}) {
  return (
    <div className="flex justify-center py-3">
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs text-t-secondary bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
      >
        <ChevronUp size={14} />
        <span>
          加载更早�?{Math.min(hiddenRounds, LOAD_MORE_ROUNDS)} 轮对�?        </span>
        <span className="text-t-dim">（还�?{hiddenRounds} 轮）</span>
      </button>
    </div>
  );
});

/**
 * 结构指纹：只在消息数量或 ID 组合变化时才重新分组�? */
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
  const isBusy = useIsBusy();

  // ══�?分页状�?══�?  const [visibleRounds, setVisibleRounds] = useState(INITIAL_VISIBLE_ROUNDS);

  // 会话切换时重置可见轮�?  useEffect(() => {
    setVisibleRounds(INITIAL_VISIBLE_ROUNDS);
  }, [activeChatId]);

  // 计算可见消息和隐藏轮�?  const { visibleMessages, totalRounds, hiddenRounds } = useMemo(() => {
    const allMessages = useChat.getState().messages;
    const total = countRounds(allMessages);
    const visible = getLastNRounds(allMessages, visibleRounds);
    const visibleCount = countRounds(visible);
    return {
      visibleMessages: visible,
      totalRounds: total,
      hiddenRounds: Math.max(0, total - visibleCount),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, visibleRounds]);

  // 只在结构变化时重新分组（使用可见消息�?  // eslint-disable-next-line react-hooks/exhaustive-deps
  const renderUnits = useMemo(
    () => groupMessages(visibleMessages),
    [fingerprint, visibleRounds],
  );

  // 加载更多历史消息
  const containerRef = useRef<HTMLElement | null>(null);
  const handleLoadMore = useCallback(() => {
    const el = containerRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;

    setVisibleRounds((r) => r + LOAD_MORE_ROUNDS);

    // 保持滚动位置：加载后恢复到原来的相对位置
    requestAnimationFrame(() => {
      if (el) {
        const newScrollHeight = el.scrollHeight;
        const heightDiff = newScrollHeight - prevScrollHeight;
        el.scrollTop += heightDiff;
      }
    });
  }, []);

  // �?核心 hook：deps=[activeChatId] 切换会话时重置锁
  const { ref, scrollToBottom, resetLock } = useAutoScrollToBottom([
    activeChatId,
  ]);

  // 统一滚动调度
  const scrollRafRef = useRef<number | null>(null);
  const scheduleScrollToBottom = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      scrollToBottom();
    });
  }, [scrollToBottom]);

  // �?新一轮流开始时重置�?  const prevBusy = useRef(false);
  useEffect(() => {
    if (isBusy && !prevBusy.current) {
      resetLock();
    }
    prevBusy.current = isBusy;
  }, [isBusy, resetLock]);

  // �?MutationObserver
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

  // �?ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => scheduleScrollToBottom());
    ro.observe(el);
    return () => ro.disconnect();
  }, [scheduleScrollToBottom]);

  // �?初始滚动
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
        {/* 加载更多历史消息按钮 */}
        {hiddenRounds > 0 && (
          <LoadMoreButton
            hiddenRounds={hiddenRounds}
            onClick={handleLoadMore}
          />
        )}
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
              style={getItemStyle(isLast && isBusy)}
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
        {/* Tool calls are now rendered inline within AssistantMessage */}
        {/* Progress indicator */}
        <ProgressIndicator />
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
  console.log("message===>", message);
  const isBusy = useIsBusy();

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
        <div className="text-[13px] text-danger p-3 bg-danger/8 rounded-lg font-mono">
          {message.content}
        </div>
        {isLast && !isBusy && (
          <button
            onClick={() => console.warn("retryLastMessage not yet implemented")}
            className="inline-flex items-center gap-1.5 self-start px-3 py-1.5 text-xs text-t-secondary bg-white/6 hover:bg-white/10 rounded-lg transition-colors"
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
