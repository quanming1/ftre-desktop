import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { MoreHorizontal, Pencil, PanelRight, Loader2 } from "lucide-react";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { useLayout } from "@/stores/layout";
import { useNotification } from "@/stores/notification";
import { updateSession } from "@/services/api";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { Tooltip } from "@ftre/ui";
import { RunContextButton } from "./RunContextPopover";

interface ChatHeaderProps {
  runContextOpen: boolean;
  onToggleRunContext: () => void;
}

function formatRecentSessionAge(timestamp?: number): string {
  if (!timestamp) return "";
  const diff = Math.max(0, Date.now() / 1000 - timestamp);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时`;
  return `${Math.floor(diff / 86400)} 天`;
}

export function ChatHeader({ runContextOpen, onToggleRunContext }: ChatHeaderProps) {
  const sessionId = useChat((s) => s.sessionId);
  const sessions = useSession((s) => s.sessions);
  const allSessions = useSession((s) => s.allSessions);
  const loadAllSessions = useSession((s) => s.loadAllSessions);
  const deleteSession = useSession((s) => s.deleteSession);
  const inspectorVisible = useLayout((s) => s.panelVisible.inspector);
  const togglePanelVisible = useLayout((s) => s.togglePanelVisible);

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    items: ContextMenuItem[];
  } | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recentPopoverRef = useRef<HTMLDivElement>(null);
  const switchSession = useSession((s) => s.switchSession);

  const currentSession = sessions.find((s) => s.session_id === sessionId)
    ?? allSessions.find((s) => s.session_id === sessionId);

  const title = currentSession?.title || "新会话";
  const recentWsSessions = useMemo(() => {
    const sessions = allSessions
      .filter((session) => session.channel === "ws")
      .sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
    return sessions.slice(0, 8);
  }, [allSessions]);

  const handleRename = useCallback(async () => {
    if (!sessionId || !renameValue.trim()) {
      setIsRenaming(false);
      return;
    }
    // 没有变化则不更新
    if (renameValue.trim() === title) {
      setIsRenaming(false);
      return;
    }
    const result = await updateSession(sessionId, { title: renameValue.trim() });
    if (result && "status" in result && result.status === "updated") {
      loadAllSessions();
      useNotification.getState().addNotification({
        level: "info",
        message: "会话已重命名",
      });
    } else {
      useNotification.getState().addNotification({
        level: "error",
        message: "重命名失败",
      });
    }
    setIsRenaming(false);
  }, [sessionId, renameValue, title, loadAllSessions]);

  const handleStartRename = useCallback(() => {
    setRenameValue(title);
    setIsRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [title]);

  const handleDelete = useCallback(async () => {
    if (!sessionId) return;
    await deleteSession(sessionId);
  }, [sessionId, deleteSession]);

  const showContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!sessionId) return;
      setContextMenu({
        position: { x: e.clientX, y: e.clientY },
        items: [
          {
            id: "rename",
            label: "重命名",
            icon: Pencil,
            action: handleStartRename,
          },
          { id: "sep", label: "", separator: true, action: () => {} },
          {
            id: "delete",
            label: "删除会话",
            action: handleDelete,
          },
        ],
      });
    },
    [sessionId, handleStartRename, handleDelete],
  );

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (!recentOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!recentPopoverRef.current?.contains(event.target as Node)) {
        setRecentOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [recentOpen]);

  const handleRecentSessionClick = useCallback((targetSessionId: string) => {
    setRecentOpen(false);
    if (targetSessionId !== sessionId) void switchSession(targetSessionId);
  }, [sessionId, switchSession]);

  return (
    <div className="relative grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center bg-surface px-4 py-2.5">
      <div ref={recentPopoverRef} className="relative col-start-2 min-w-0 max-w-[60vw] justify-self-center">
        {isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") setIsRenaming(false);
            }}
            className="w-full min-w-0 bg-transparent border-b border-accent text-center text-base font-semibold text-t-primary outline-none"
          />
        ) : (
          <button
            type="button"
            aria-label={`切换会话：${title}`}
            aria-expanded={recentOpen}
            aria-haspopup="listbox"
            onClick={() => setRecentOpen((open) => !open)}
            className="block max-w-full truncate bg-transparent text-center text-base font-semibold text-t-primary outline-none transition-colors hover:text-accent"
          >
            {title}
          </button>
        )}

        {recentOpen && (
          <div
            role="listbox"
            aria-label="最近的 WebSocket 会话"
            className="absolute left-1/2 top-[calc(100%+8px)] z-50 w-[320px] -translate-x-1/2 rounded-xl bg-surface p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.14),0_2px_8px_rgba(15,23,42,0.06)] ring-1 ring-black/[0.05]"
          >
            <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1 text-[11px] text-t-ghost">
              <span>最近会话</span>
            </div>
            <div className="max-h-[min(60vh,360px)] space-y-0.5 overflow-y-auto">
              {recentWsSessions.length === 0 ? (
                <div className="px-2.5 py-4 text-center text-[12px] text-t-ghost">暂无 WebSocket 会话</div>
              ) : (
                recentWsSessions.map((session) => {
                  const isActive = session.session_id === sessionId;
                  const isRunning = Boolean(session.running);
                  const age = formatRecentSessionAge(session.updated_at);
                  return (
                    <button
                      key={session.session_id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => handleRecentSessionClick(session.session_id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${isActive
                        ? "bg-hover text-t-primary"
                        : "text-t-secondary hover:bg-hover/70 hover:text-t-primary"
                        }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{session.title || "新会话"}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-t-ghost">
                          {isRunning ? "运行中" : session.last_user_text?.trim() || session.workspace || "空闲"}
                        </span>
                      </span>
                      <span className={`shrink-0 text-[11px] tabular-nums ${isRunning ? "text-neon" : "text-t-ghost"}`}>
                        {isRunning ? <Loader2 size={12} className="animate-spin" /> : age}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      <div className="col-start-3 flex items-center justify-self-end gap-1">
        <RunContextButton open={runContextOpen} onToggle={onToggleRunContext} />
        <Tooltip content={inspectorVisible ? "隐藏侧面板" : "显示侧面板"} side="bottom">
          <button
            type="button"
            aria-label={inspectorVisible ? "隐藏侧面板" : "显示侧面板"}
            aria-pressed={inspectorVisible}
            onClick={() => togglePanelVisible("inspector")}
            className={`relative flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ${
              inspectorVisible
                ? "bg-black/[0.06] text-t-primary"
                : "text-t-muted hover:bg-black/[0.04] hover:text-t-primary"
            }`}
          >
            <PanelRight size={15} strokeWidth={1.6} />
          </button>
        </Tooltip>
        {sessionId && (
          <Tooltip content="更多操作" side="bottom">
            <button
              onClick={showContextMenu}
              className="p-1 rounded hover:bg-hover text-t-secondary hover:text-t-primary"
            >
              <MoreHorizontal size={16} />
            </button>
          </Tooltip>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          position={contextMenu.position}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
