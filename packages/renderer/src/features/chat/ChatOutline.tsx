/**
 * ChatOutline — 消息列表左侧的会话历史定位导航。
 *
 * 所有已加载的 user 消息都会成为一个纵向标记。仅鼠标悬停会激活标记：
 * 当前标记展开，周围标记按距离递减，预览卡与当前标记中心对齐。
 */
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChatMessage } from "@/stores/chat";

interface ChatOutlineProps {
  messages: ChatMessage[];
}

interface HistoryItem {
  id: string;
  text: string;
  responseText: string;
  index: number;
}

const MARKER_MIN_WIDTH = 6;
const MARKER_MAX_WIDTH = 27;
const MARKER_WIDTH_STEP = 3.25;

/** 把 user 消息平铺成一行简短文字，给预览卡显示用。
 *  结果按消息对象引用缓存（WeakMap）：流式期间 getHistoryItems 每批重算，
 *  未变化消息的全文 replace 不再重复执行。 */
const summarizeCache = new WeakMap<ChatMessage, string>();

function summarize(message: ChatMessage): string {
  const cached = summarizeCache.get(message);
  if (cached !== undefined) return cached;
  const summarized = (message.content ?? "").replace(/\s+/g, " ").trim();
  summarizeCache.set(message, summarized);
  return summarized;
}

function getHistoryItems(messages: ChatMessage[]): HistoryItem[] {
  // WebSocket 重连/HMR 期间旧状态可能短暂不是数组；导航轨道应退化为空，不能阻断整个会话面板。
  if (!Array.isArray(messages)) return [];
  const items: HistoryItem[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      items.push({
        id: message.id,
        text: summarize(message),
        responseText: "",
        index: items.length,
      });
      continue;
    }
    // 一轮中可能有多条 assistant 事件，取最后一条有正文的回复作为摘要。
    if (message.role === "assistant" && items.length > 0) {
      const responseText = summarize(message);
      if (responseText) items[items.length - 1].responseText = responseText;
    }
  }
  return items;
}

function getPreviewText(text: string): string {
  const limit = 180;
  return text.length > limit ? `${text.slice(0, limit)}…` : text || "(空消息)";
}

/** 悬停条为最长，距它越远，横线越短；无悬停时全为短线。 */
function getMarkerWidth(index: number, hoveredIndex: number): number {
  if (hoveredIndex < 0) return MARKER_MIN_WIDTH;
  return Math.max(
    MARKER_MIN_WIDTH,
    Math.round(MARKER_MAX_WIDTH - Math.abs(index - hoveredIndex) * MARKER_WIDTH_STEP),
  );
}

function getMarkerOpacity(index: number, hoveredIndex: number): number {
  if (hoveredIndex < 0) return 0.72;
  return Math.max(0.5, 1 - Math.abs(index - hoveredIndex) * 0.08);
}

/** 导航作为消息布局左栏的 sticky 项，不再使用 portal/fixed 计算坐标。 */
export const ChatOutline = memo(function ChatOutline({
  messages,
}: ChatOutlineProps) {
  const items = useMemo(() => getHistoryItems(messages), [messages]);
  const railRef = useRef<HTMLOListElement>(null);
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [previewTop, setPreviewTop] = useState<number | null>(null);

  const scrollToItem = useCallback((item: HistoryItem) => {
    const element = document.getElementById(`msg-${item.id}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "auto", block: "start" });
  }, []);

  const updatePreviewTop = useCallback((id: string) => {
    const rail = railRef.current;
    const marker = markerRefs.current.get(id);
    if (!rail || !marker) return;
    setPreviewTop(marker.offsetTop - rail.scrollTop + marker.offsetHeight / 2);
  }, []);

  const handleMarkerHover = useCallback((id: string) => {
    setHoveredId(id);
    updatePreviewTop(id);
  }, [updatePreviewTop]);

  const clearHover = useCallback(() => {
    setHoveredId(null);
    setPreviewTop(null);
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent, item: HistoryItem) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    scrollToItem(item);
  }, [scrollToItem]);

  if (items.length === 0) return null;

  const hoveredIndex = items.findIndex((item) => item.id === hoveredId);
  const preview = hoveredIndex >= 0 ? items[hoveredIndex] : null;
  return (
    <aside
      aria-label="会话消息历史"
      className="sticky top-1/2 z-20 col-start-1 row-start-1 ml-3 w-7 -translate-y-1/2 self-start"
      onMouseLeave={clearHover}
    >
      <ol
        ref={railRef}
        className="flex max-h-[42vh] w-7 flex-col items-center overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="用户消息定位标记"
        onScroll={() => hoveredId && updatePreviewTop(hoveredId)}
      >
        {items.map((item, index) => {
          const isHovered = index === hoveredIndex;
          return (
            <li key={item.id} className="flex h-[10px] w-full shrink-0 justify-start">
              <button
                ref={(node) => {
                  if (node) markerRefs.current.set(item.id, node);
                  else markerRefs.current.delete(item.id);
                }}
                type="button"
                data-history-item={item.id}
                onClick={() => scrollToItem(item)}
                onKeyDown={(event) => handleKeyDown(event, item)}
                onMouseEnter={() => handleMarkerHover(item.id)}
                aria-label={`定位到第 ${item.index + 1} 条用户消息：${getPreviewText(item.text)}`}
                className={`flex h-full items-center rounded-full after:block after:h-[2px] after:w-full after:rounded-full after:bg-t-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isHovered ? "after:bg-t-primary" : "hover:after:bg-t-secondary"
                }`}
                style={{
                  width: getMarkerWidth(index, hoveredIndex),
                  opacity: getMarkerOpacity(index, hoveredIndex),
                }}
              />
            </li>
          );
        })}
      </ol>

      {preview && (
        <div
          className="absolute left-9 w-[324px] -translate-y-1/2 rounded-lg border border-border-subtle bg-surface px-3 py-2.5 shadow-[0_3px_10px_rgba(15,23,42,0.08)]"
          style={{ top: previewTop ?? 0 }}
        >
          <p className="line-clamp-1 whitespace-pre-wrap break-words text-[13px] font-medium leading-5 text-t-primary">
            {getPreviewText(preview.text)}
          </p>
          {preview.responseText ? (
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-[12px] leading-[18px] text-t-ghost">
              {getPreviewText(preview.responseText)}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-t-ghost">用户消息 {preview.index + 1}</p>
          )}
        </div>
      )}
    </aside>
  );
});

export { getHistoryItems, getMarkerWidth, getPreviewText };
