import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, X, ChevronLeft, ChevronRight, List } from "lucide-react";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { SessionList } from "./SessionList";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { useWorkspace } from "@/stores/workspace";
import { streamManager } from "@/services/stream-manager";

function truncate(str: string, max: number) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

export function ChatPanel() {
  const sessionId = useChat((s) => s.sessionId);
  const clearMessages = useChat((s) => s.clearMessages);
  const workspace = useWorkspace((s) => s.rootPath);
  const sessions = useSession((s) => s.sessions);
  const openTabs = useSession((s) => s.openTabs);
  const loadSessions = useSession((s) => s.loadSessions);
  const restoreLatest = useSession((s) => s.restoreLatest);
  const switchSession = useSession((s) => s.switchSession);
  const closeTab = useSession((s) => s.closeTab);
  const newSession = useSession((s) => s.newSession);

  const [showSessions, setShowSessions] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // workspace 变化时恢复该工作区最新会话（含首次进入和切换工作区）
  useEffect(() => {
    if (workspace) {
      restoreLatest(workspace).then(() => setInitialized(true));
    }
  }, [workspace, restoreLatest]);

  // 检测 tab 滚动状态
  const checkScroll = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = tabsRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll);
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      ro.disconnect();
    };
  }, [checkScroll, sessions]);

  const scroll = (dir: "left" | "right") => {
    tabsRef.current?.scrollBy({ left: dir === "left" ? -120 : 120, behavior: "instant" });
  };

  const handleNew = () => {
    newSession();
  };

  const handleClose = (e: React.MouseEvent, sid: string) => {
    e.stopPropagation();
    closeTab(sid);
  };

  if (showSessions) {
    return <SessionList onClose={() => setShowSessions(false)} />;
  }

  // 根据 openTabs 顺序展示 tab，从 sessions 中查找标题等信息
  const sessionsMap = new Map(sessions.map((s) => [s.session_id, s]));
  const visibleSessions = openTabs
    .map((id) => sessionsMap.get(id))
    .filter(Boolean) as typeof sessions;

  return (
    <div className="h-full flex flex-col bg-surface overflow-hidden">
      {/* Session Tab Bar */}
      <div className="flex items-end h-[38px] bg-base shrink-0 select-none">
        {/* 滚动左箭头 */}
        {canScrollLeft && (
          <button
            onClick={() => scroll("left")}
            className="shrink-0 w-6 h-full flex items-center justify-center text-t-muted hover:text-t-primary hover:bg-white/[0.06] transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
        )}

        {/* Tabs 滚动区 */}
        <div ref={tabsRef} className="flex-1 flex items-end overflow-x-auto h-full scrollbar-none" style={{ scrollbarWidth: "none" }}>
          {visibleSessions.map((s) => {
            const isActive = s.session_id === sessionId;
            const isBgStreaming = !isActive && streamManager.isSessionStreaming(s.session_id);
            return (
              <button
                key={s.session_id}
                onClick={() => switchSession(s.session_id)}
                className={`group relative flex items-center gap-2 h-full px-3.5 text-[13px] font-mono whitespace-nowrap shrink-0 border-r border-border transition-colors duration-150 ${
                  isActive ? "bg-surface text-t-primary" : "bg-base text-t-muted hover:bg-elevated hover:text-t-secondary"
                }`}
              >
                {isActive && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-neon" />}
                {/* 后台流式指示：非活跃 tab 有流在跑时显示闪烁圆点 */}
                {isBgStreaming && (
                  <span className="w-1.5 h-1.5 rounded-full bg-neon/70 shrink-0" style={{ animation: "blink 1.2s ease-in-out infinite" }} />
                )}
                <span className="max-w-[120px] truncate">{truncate(s.title || "新会话", 18)}</span>
                <span
                  onClick={(e) => handleClose(e, s.session_id)}
                  className={`ml-0.5 p-0.5 rounded transition-all cursor-pointer ${
                    isActive
                      ? "text-t-muted hover:text-t-primary hover:bg-white/[0.1] opacity-100"
                      : "opacity-0 group-hover:opacity-100 text-t-ghost hover:text-t-primary hover:bg-white/[0.1]"
                  }`}
                >
                  <X size={12} />
                </span>
              </button>
            );
          })}
        </div>

        {/* 滚动右箭头 */}
        {canScrollRight && (
          <button
            onClick={() => scroll("right")}
            className="shrink-0 w-6 h-full flex items-center justify-center text-t-muted hover:text-t-primary hover:bg-white/[0.06] transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        )}

        {/* 操作按钮 */}
        <div className="shrink-0 flex items-center gap-0.5 px-1.5 h-full border-l border-border">
          <button
            onClick={handleNew}
            className="h-8 w-8 flex items-center justify-center rounded-md text-t-muted hover:text-neon hover:bg-neon-ghost transition-colors duration-150"
            title="新建会话"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => setShowSessions(true)}
            className="h-8 w-8 flex items-center justify-center rounded-md text-t-muted hover:text-neon hover:bg-neon-ghost transition-colors duration-150"
            title="全部会话"
          >
            <List size={16} />
          </button>
        </div>
      </div>

      <MessageList />

      <ChatInput />
    </div>
  );
}
