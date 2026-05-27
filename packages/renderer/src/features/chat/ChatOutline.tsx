/**
 * ChatOutline — 会话右侧"轮次目录"
 *
 * 列出当前会话所有 user 消息，点击 instant 跳转到对应锚点。
 * 锚点：UserMessage 渲染时挂的 id="msg-<message.id>"。
 *
 * 性能：
 * - scroll listener 通过 ref 模式只装一次（不会随 userMessages 引用变化反复重装）
 * - compute() 用 100ms 节流而不是 rAF 每帧 —— 流式期间每秒触发几十次没意义
 * - summarize 结果按 message.id 缓存，避免每个 chunk 都重算 N 条 user 消息
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/stores/chat";

interface ChatOutlineProps {
  messages: ChatMessage[];
  /** 消息列表的滚动容器；用来响应 scroll + 实施跳转 */
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  /** 跳转早期消息前先扩容 visibleCount，保证锚点已渲染 */
  ensureVisible?: (count: number) => void;
  className?: string;
}

/** 把 user 消息平铺成一行简短文字，给目录显示用 */
function summarize(message: ChatMessage): string {
  if (message.parts && message.parts.length > 0) {
    const text = message.parts
      .map((p: any) => {
        if (p.type === "text") return p.data ?? "";
        if (p.type === "code_ref") return `[${p.data?.name ?? "code"}]`;
        if (p.type === "archive_ref") return `[归档]`;
        if (p.type === "skill_ref") return `[Skill]`;
        if (p.type === "email") return `[Email]`;
        return "";
      })
      .join("")
      .trim();
    if (text) return text;
  }
  return (message.content ?? "").trim();
}

interface OutlineItem {
  id: string;
  text: string;
  /** 该 user 消息在完整 messages 数组里的下标 */
  index: number;
}

export const ChatOutline = memo(function ChatOutline({
  messages,
  scrollContainerRef,
  ensureVisible,
  className = "",
}: ChatOutlineProps) {
  // 预计算 outline 渲染数据：只在 messages 引用变化时重算
  const items: OutlineItem[] = useMemo(() => {
    const out: OutlineItem[] = [];
    const cache = summarizeCacheRef.current;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== "user") continue;
      // 同 id 的消息 user 输入定型后内容不再变，缓存 summarize 结果
      let text = cache.get(m.id);
      if (text == null) {
        text = summarize(m);
        cache.set(m.id, text);
      }
      out.push({ id: m.id, text, index: i });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // ─── scroll listener：通过 ref 读 items，只装一次 ────────────────
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const compute = () => {
      pendingTimer = null;
      const currentItems = itemsRef.current;
      if (currentItems.length === 0) return;
      const containerTop = container.getBoundingClientRect().top;
      let bestId: string | null = null;
      let bestDistance = -Infinity;
      for (const it of currentItems) {
        const el = document.getElementById(`msg-${it.id}`);
        if (!el) continue;
        const distance = el.getBoundingClientRect().top - containerTop;
        // 锚点已上滚到视口顶以上或刚好在顶部 → 候选
        if (distance <= 16 && distance > bestDistance) {
          bestDistance = distance;
          bestId = it.id;
        }
      }
      setActiveId((prev) => bestId ?? currentItems[0]?.id ?? prev);
    };

    compute();
    const onScroll = () => {
      // 100ms 节流：流式期间每秒触发几十次 scroll，没必要每次都跑 layout 查询
      if (pendingTimer != null) return;
      pendingTimer = setTimeout(compute, 100);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (pendingTimer != null) clearTimeout(pendingTimer);
    };
  }, [scrollContainerRef]);

  // active 变化时把 outline 里那条滚到可见
  useEffect(() => {
    if (!activeId) return;
    const el = itemRefs.current.get(activeId);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [activeId]);

  const handleClick = (item: OutlineItem) => {
    const tryScroll = () => {
      const el = document.getElementById(`msg-${item.id}`);
      if (!el) return false;
      el.scrollIntoView({ behavior: "instant", block: "start" });
      return true;
    };

    if (tryScroll()) return;

    // 锚点不在 DOM —— 该消息还在分页未渲染区。先让 ChatMessageList 扩容到
    // "末尾保留这条以及它之后的全部"，下一帧再滚。
    if (!ensureVisible) return;
    const needed = messages.length - item.index;
    ensureVisible(needed);
    requestAnimationFrame(() => {
      requestAnimationFrame(tryScroll);
    });
  };

  if (items.length === 0) return null;

  return (
    <aside
      className={`shrink-0 w-[180px] overflow-y-auto overflow-x-hidden py-2 px-2 scrollbar-thin ${className}`}
      style={{ maxHeight: "25vh" }}
      aria-label="会话目录"
    >
      <ol className="space-y-px">
        {items.map((it) => {
          const isActive = it.id === activeId;
          return (
            <li key={it.id}>
              <button
                ref={(el) => {
                  if (el) itemRefs.current.set(it.id, el);
                  else itemRefs.current.delete(it.id);
                }}
                onClick={() => handleClick(it)}
                title={it.text}
                className={`w-full flex items-center px-2 h-6 rounded text-left text-[12px] truncate transition-colors
                  ${isActive
                    ? "text-t-primary font-medium"
                    : "text-t-ghost hover:text-t-primary"
                  }`}
              >
                <span className="truncate">{it.text || "(空消息)"}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
});

/** 模块级 summarize 缓存（按 message id 复用） */
const summarizeCacheRef = { current: new Map<string, string>() };
