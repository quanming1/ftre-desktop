import { useState, useCallback, useRef, useEffect } from "react";
import { MoreHorizontal, Pencil, Archive } from "lucide-react";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { useNotification } from "@/stores/notification";
import { updateSession, triggerCompaction } from "@/services/api";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { Tooltip } from "@ftre/ui";

export function ChatHeader() {
  const sessionId = useChat((s) => s.sessionId);
  const sessions = useSession((s) => s.sessions);
  const allSessions = useSession((s) => s.allSessions);
  const loadAllSessions = useSession((s) => s.loadAllSessions);
  const deleteSession = useSession((s) => s.deleteSession);

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    items: ContextMenuItem[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentSession = sessions.find((s) => s.session_id === sessionId)
    ?? allSessions.find((s) => s.session_id === sessionId);

  const title = currentSession?.title || "新会话";

  const handleCompaction = useCallback(async () => {
    if (!sessionId) return;
    const result = await triggerCompaction(sessionId);
    if (result) {
      useNotification.getState().addNotification({
        level: "info",
        message: "归档任务已触发",
      });
    } else {
      useNotification.getState().addNotification({
        level: "error",
        message: "归档任务触发失败",
      });
    }
  }, [sessionId]);

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
          {
            id: "compact",
            label: "归档会话",
            icon: Archive,
            action: handleCompaction,
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
    [sessionId, handleStartRename, handleCompaction, handleDelete],
  );

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
    }
  }, [isRenaming]);

  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-surface shrink-0">
      <div className="flex items-center min-w-0 flex-1">
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
            className="flex-1 min-w-0 bg-transparent border-b border-accent text-t-primary text-base outline-none"
          />
        ) : (
          <span
            className="text-base text-t-primary truncate cursor-pointer hover:text-accent"
            onClick={handleStartRename}
            title={title}
          >
            {title}
          </span>
        )}
      </div>

      {sessionId && (
        <div className="flex items-center gap-1">
          <Tooltip content="更多操作" side="bottom">
            <button
              onClick={showContextMenu}
              className="p-1 rounded hover:bg-hover text-t-secondary hover:text-t-primary"
            >
              <MoreHorizontal size={16} />
            </button>
          </Tooltip>
        </div>
      )}

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
