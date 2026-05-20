/**
 * ChatMessageList �?Standalone message list component.
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

        {visibleMessages.map((msg) => (
          <MessageItem key={msg.id} message={msg} />
        ))}

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

const MessageItem = memo(function MessageItem({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return <UserMessage message={message} />;
  }
  if (message.role === "assistant") {
    return <AssistantMessage message={message} />;
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
