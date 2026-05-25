import {
  useEffect,
  useLayoutEffect,
  useRef,
  memo,
  useMemo,
  useCallback,
  useState,
} from "react";
import { useShallow } from "zustand/shallow";
import { useMessageById, useIsBusy, useChat } from "@/stores/chat";
import { useAutoScrollToBottom } from "@/hooks/auto-scroll";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { PixelLogo } from "@/components/PixelLogo";
import { RotateCcw, ChevronUp } from "lucide-react";

const INITIAL_VISIBLE_ROUNDS = 10;
const LOAD_MORE_ROUNDS = 20;

/** 流式中的最后一条不应用 contentVisibility，确保高度计算准确 */
const itemStyle = (live: boolean): React.CSSProperties =>
  live
    ? { containIntrinsicSize: "auto 400px" }
    : { contentVisibility: "auto", containIntrinsicSize: "auto 400px" };

// ─── Skeleton + grouping (id/role only — streaming 内容变化不触发重组) ───

interface Skel { id: string; role: string }
type Unit = { type: "single"; id: string } | { type: "ai_turn_start"; key: string };

function groupBySkeleton(skel: Skel[]): Unit[] {
  const out: Unit[] = [];
  let pending = false;
  let lastUserId = "";
  for (const m of skel) {
    if (m.role === "user") { pending = true; lastUserId = m.id; }
    if (pending && m.role !== "user") {
      out.push({ type: "ai_turn_start", key: `ai-start-${lastUserId}` });
      pending = false;
    }
    out.push({ type: "single", id: m.id });
  }
  return out;
}

/** 从尾部往前找 N 个 user 的起始 index（一轮 = 一个 user + 后续 assistant/system） */
function lastNRoundsStart(skel: Skel[], rounds: number): number {
  if (rounds <= 0) return 0;
  let cnt = 0;
  for (let i = skel.length - 1; i >= 0; i--) {
    if (skel[i].role === "user" && ++cnt >= rounds) return i;
  }
  return 0;
}

const useSkeleton = () =>
  useChat(useShallow((s) => s.messages.map((m) => ({ id: m.id, role: m.role }))));

// ─── Sub components ─────────────────────────────────────────────────

const ProgressIndicator = memo(function ProgressIndicator() {
  const isBusy = useIsBusy();
  if (!isBusy) return null;
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[12px] text-neon/60 font-mono">ftre</span>
      <span className="text-[12px] text-t-secondary italic">思考中...</span>
      <div className="flex gap-[3px]">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-[4px] h-[4px] bg-neon"
            style={{ animation: "thinking 1.2s ease-in-out infinite", animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
    </div>
  );
});

const LoadMoreButton = memo(function LoadMoreButton({
  hiddenRounds,
  onClick,
}: { hiddenRounds: number; onClick: () => void }) {
  return (
    <div className="flex justify-center py-3">
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs text-t-secondary bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
      >
        <ChevronUp size={14} />
        <span>加载更早的 {Math.min(hiddenRounds, LOAD_MORE_ROUNDS)} 轮对话</span>
        <span className="text-t-dim">（还有 {hiddenRounds} 轮）</span>
      </button>
    </div>
  );
});

const MessageItem = memo(function MessageItem({
  messageId,
  isLast = false,
}: { messageId: string; isLast?: boolean }) {
  const message = useMessageById(messageId);
  const isBusy = useIsBusy();
  if (!message) return null;
  if (message.role === "user") return <UserMessage message={message} />;
  if (message.role === "assistant") return <AssistantMessage message={message} />;
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
            <RotateCcw size={12} />重试
          </button>
        )}
      </div>
    );
  }
  return null;
});

// ─── Main ───────────────────────────────────────────────────────────

export function MessageList() {
  const skeleton = useSkeleton();
  const sessionId = useChat((s) => s.sessionId);
  const isBusy = useIsBusy();

  const [visibleRounds, setVisibleRounds] = useState(INITIAL_VISIBLE_ROUNDS);
  useEffect(() => setVisibleRounds(INITIAL_VISIBLE_ROUNDS), [sessionId]);

  const { renderUnits, hiddenRounds } = useMemo(() => {
    const totalRounds = skeleton.reduce((acc, m) => acc + (m.role === "user" ? 1 : 0), 0);
    const startIdx = lastNRoundsStart(skeleton, visibleRounds);
    const slice = skeleton.slice(startIdx);
    const visibleRoundsCount = slice.reduce((acc, m) => acc + (m.role === "user" ? 1 : 0), 0);
    return {
      renderUnits: groupBySkeleton(slice),
      hiddenRounds: Math.max(0, totalRounds - visibleRoundsCount),
    };
  }, [skeleton, visibleRounds]);

  // ─── Scroll plumbing ─────────────────────────────────────────────

  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const { ref, scrollToBottom, resetLock } = useAutoScrollToBottom([sessionId]);

  // 合并多次同帧滚动请求
  const rafRef = useRef<number | null>(null);
  const schedule = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      scrollToBottom();
    });
  }, [scrollToBottom]);

  // 新一轮流开始 → 重新跟随
  const prevBusy = useRef(false);
  useEffect(() => {
    if (isBusy && !prevBusy.current) resetLock();
    prevBusy.current = isBusy;
  }, [isBusy, resetLock]);

  // 跟随尾部消息内容变化（指纹：id+content长度+parts数+tools数）
  const tailFingerprint = useChat((s) => {
    const last = s.messages[s.messages.length - 1];
    if (!last) return "";
    return `${last.id}:${(last.content ?? "").length}:${last.parts?.length ?? 0}:${last.toolCalls?.length ?? 0}`;
  });
  useEffect(() => { schedule(); }, [tailFingerprint, schedule]);

  // 内容尺寸变化（throttle 兑现 / 异步组件）→ ResizeObserver
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => schedule());
    ro.observe(el);
    return () => ro.disconnect();
  }, [schedule]);

  // 切 session 后初始滚动
  useLayoutEffect(() => {
    const t = setTimeout(scrollToBottom, 50);
    return () => clearTimeout(t);
  }, [sessionId, scrollToBottom]);

  useEffect(() => () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const handleLoadMore = useCallback(() => {
    const el = containerRef.current;
    const prev = el?.scrollHeight ?? 0;
    setVisibleRounds((r) => r + LOAD_MORE_ROUNDS);
    requestAnimationFrame(() => {
      if (!el) return;
      el.scrollTop += el.scrollHeight - prev;
    });
  }, []);

  const mergedRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    ref(el);
  }, [ref]);

  return (
    <div
      ref={mergedRef}
      className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-5 py-4"
      style={{ willChange: "transform", contain: "layout style" }}
    >
      <div ref={contentRef} className="mx-auto w-full max-w-[960px] space-y-2 break-words">
        {hiddenRounds > 0 && <LoadMoreButton hiddenRounds={hiddenRounds} onClick={handleLoadMore} />}
        {renderUnits.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-t-dim text-[14px] font-mono pt-20">
            描述你想要构建的内容
          </div>
        )}
        {renderUnits.map((u, i) => {
          const isLast = i === renderUnits.length - 1;
          return (
            <div
              key={u.type === "single" ? u.id : u.key}
              style={itemStyle(isLast && isBusy)}
            >
              {u.type === "ai_turn_start" ? (
                <div className="mt-4 mb-1 flex items-center h-[20px]"><PixelLogo size={2} /></div>
              ) : (
                <MessageItem messageId={u.id} isLast={isLast} />
              )}
            </div>
          );
        })}
        <ProgressIndicator />
      </div>
    </div>
  );
}
