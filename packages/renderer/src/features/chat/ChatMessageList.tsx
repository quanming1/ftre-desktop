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
import { ChevronUp } from "lucide-react";
import type { ChatMessage } from "@/stores/chat";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset visible count when switching sessions (message list changes entirely)
  const prevLenRef = useRef(messages.length);
  useEffect(() => {
    // If messages shrunk (session switch) or went to 0, reset
    if (messages.length < prevLenRef.current || messages.length === 0) {
      setVisibleCount(PAGE_SIZE);
    }
    prevLenRef.current = messages.length;
  }, [messages.length]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, [messages.length, autoScroll]);

  const totalCount = messages.length;
  const startIndex = Math.max(0, totalCount - visibleCount);
  const visibleMessages = messages.slice(startIndex);
  const hasMore = startIndex > 0;

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, totalCount));
  }, [totalCount]);

  return (
    <div
      ref={containerRef}
      className={`overflow-y-auto overflow-x-hidden px-4 py-3 ${className}`}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <div className="mx-auto w-full max-w-[960px] space-y-12 break-words">
        {/* Load more */}
        {hasMore && (
          <div className="text-center py-2">
            <button
              onClick={loadMore}
              className="inline-flex items-center gap-1.5 text-[12px] text-t-ghost hover:text-t-muted transition-colors"
            >
              <ChevronUp size={14} />
              加载更早的消息（还有 {startIndex} 条）
            </button>
          </div>
        )}

        {messages.length === 0 && !isBusy && (
          <div className="text-center text-t-dim text-sm py-12">
            No messages
          </div>
        )}

        {visibleMessages.map((msg, i) => {
          // 判断 assistant 消息是否为"本轮最后一条"：
          // - 是 assistant 角色
          // - 不在流式中
          // - 后面紧跟的不是 assistant（下一条是 user / system / 没有下一条）
          const next = visibleMessages[i + 1];
          const isLastOfTurn =
            msg.role === "assistant" &&
            !msg.streaming &&
            (!next || next.role !== "assistant");

          // 计算"本轮新增 token"：当前 assistant 的 total_tokens
          // 减去最近一条更早的有 usage 的 assistant 的 total_tokens
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
          <div className="flex items-center gap-2 py-2">
            <span className="text-[12px] text-neon/60 font-mono">ftre</span>
            <div className="flex gap-[3px]">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-[4px] h-[4px] bg-neon rounded-full"
                  style={{
                    animation: "pulse 1.2s ease-in-out infinite",
                    animationDelay: `${i * 0.2}s`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
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
