/**
 * ChatOutline — 会话目录浮层（hover ChatHeader 上的目录按钮触发）
 *
 * 列出当前会话所有 user 消息，点击 instant 跳转到对应锚点。
 * 锚点：UserMessage 渲染时挂的 id="msg-<message.id>"。
 *
 * 滚动容器通过 [data-chat-scroll-container] querySelector 拿，避免在 ChatHeader →
 * ChatView → ChatMessageList 这条链上做 ref 透传。
 *
 * 性能：
 * - summarize 结果按 message.id 缓存
 * - 不订阅滚动事件、不算 active 项；触发显示后是个静态目录（用户点完就收起）
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import type { ChatMessage } from "@/stores/chat";

interface ChatOutlineProps {
  /** 浮层是否显示 */
  open: boolean;
  /** 点击外部 / 选中条目后关闭 */
  onClose: () => void;
  /** 触发按钮 DOM ref（用于点击外部判定时排除自己） */
  triggerRef?: React.RefObject<HTMLElement | null>;
}

/** 把 user 消息平铺成一行简短文字，给目录显示用 */
function summarize(message: ChatMessage): string {
  return (message.content ?? "").trim();
}

export const ChatOutline = memo(function ChatOutline({
  open,
  onClose,
  triggerRef,
}: ChatOutlineProps) {
  const messages = useChat((s) => s.messages);
  const sessionId = useChat((s) => s.sessionId);
  const hasMoreHistory = useChat((s) =>
    sessionId ? s.hasMoreHistory(sessionId) : false,
  );
  const loadEarlier = useSession((s) => s.loadEarlierMessages);

  const items = useMemo(() => {
    const out: { id: string; text: string; index: number }[] = [];
    const cache = summarizeCache;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== "user") continue;
      let text = cache.get(m.id);
      if (text == null) {
        text = summarize(m);
        cache.set(m.id, text);
      }
      out.push({ id: m.id, text, index: i });
    }
    return out;
  }, [messages]);

  const popoverRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // 浮窗打开瞬间快照一次：找滚动容器视口顶部最近的 user 消息作为 active
  useEffect(() => {
    if (!open) return;
    const container = document.querySelector<HTMLElement>(
      "[data-chat-scroll-container]",
    );
    if (!container || items.length === 0) {
      setActiveId(null);
      return;
    }
    const containerTop = container.getBoundingClientRect().top;
    let bestId: string | null = null;
    let bestDistance = -Infinity;
    for (const it of items) {
      const el = document.getElementById(`msg-${it.id}`);
      if (!el) continue;
      const distance = el.getBoundingClientRect().top - containerTop;
      // 锚点在视口顶部以上或刚好顶部 → 候选；选最靠近 0 的
      if (distance <= 16 && distance > bestDistance) {
        bestDistance = distance;
        bestId = it.id;
      }
    }
    setActiveId(bestId ?? items[items.length - 1].id);
  }, [open, items]);

  // active 项打开时自动滚到目录可见位置
  useEffect(() => {
    if (!open || !activeId) return;
    const el = popoverRef.current?.querySelector<HTMLElement>(
      `[data-outline-item="${activeId}"]`,
    );
    el?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [open, activeId]);

  // 点击浮层外（且不是触发按钮自身）→ 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef?.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose, triggerRef]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleClick = async (item: { id: string; index: number }) => {
    const tryScroll = () => {
      const el = document.getElementById(`msg-${item.id}`);
      if (!el) return false;
      el.scrollIntoView({ behavior: "instant", block: "start" });
      return true;
    };

    if (tryScroll()) {
      onClose();
      return;
    }

    // 锚点不在 DOM —— 该消息还在分页未渲染区。
    // 先反复 loadEarlier 直到桶里包含这条目标，再滚。
    if (!sessionId) return;
    let guard = 8; // 防失控（每页 200 events，扩到 1600 已经过头了）
    while (guard-- > 0) {
      const got = await loadEarlier(sessionId);
      if (!got) break;
      if (tryScroll()) {
        onClose();
        return;
      }
    }
    // 还是定位不到，至少把目录关掉避免假死
    onClose();
  };

  if (!open) return null;
  if (items.length === 0) {
    return (
      <div
        ref={popoverRef}
        className="absolute right-2 top-full mt-1 z-30 w-[260px] py-3 px-3 bg-surface rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.12)] text-[12px] text-t-ghost"
      >
        当前会话还没有消息。
      </div>
    );
  }

  return (
    <div
      ref={popoverRef}
      className="absolute right-2 top-full mt-1 z-30 w-[260px] max-h-[60vh] overflow-y-auto bg-surface rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.12)] py-1.5 px-1.5 scrollbar-thin"
    >
      <ol className="space-y-px">
        {items.map((it) => {
          const isActive = it.id === activeId;
          return (
            <li key={it.id}>
              <button
                data-outline-item={it.id}
                onClick={() => handleClick(it)}
                title={it.text}
                className={`w-full flex items-center px-2 h-7 rounded text-left text-[12px] truncate transition-colors ${
                  isActive
                    ? "bg-active text-t-primary font-medium"
                    : "text-t-secondary hover:text-t-primary hover:bg-hover"
                }`}
              >
                <span className="truncate">{it.text || "(空消息)"}</span>
              </button>
            </li>
          );
        })}
        {hasMoreHistory && (
          <li className="px-2 py-1 text-[11px] text-t-ghost italic">
            还有更早的消息，点击具体条目时会自动加载。
          </li>
        )}
      </ol>
    </div>
  );
});

/** 模块级 summarize 缓存（按 message id 复用） */
const summarizeCache = new Map<string, string>();
