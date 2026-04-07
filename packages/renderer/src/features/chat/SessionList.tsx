import { useEffect, useState } from "react";
import { Trash2, Plus, ChevronLeft } from "lucide-react";
import { useSession } from "@/stores/session";
import { useChat } from "@/stores/chat";
import { useWorkspace } from "@/stores/workspace";

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

export function SessionList({ onClose }: { onClose: () => void }) {
  const sessions = useSession((s) => s.sessions);
  const loading = useSession((s) => s.loading);
  const loadSessions = useSession((s) => s.loadSessions);
  const switchSession = useSession((s) => s.switchSession);
  const deleteSession = useSession((s) => s.deleteSession);
  const newSession = useSession((s) => s.newSession);
  const currentSessionId = useChat((s) => s.sessionId);
  const workspace = useWorkspace((s) => s.rootPath);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadSessions(workspace);
  }, [workspace, loadSessions]);

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setDeletingId(sessionId);
    await deleteSession(sessionId);
    setDeletingId(null);
  };

  const handleNew = () => {
    newSession();
    onClose();
  };

  const handleSwitch = async (sessionId: string) => {
    await switchSession(sessionId);
    onClose();
  };

  return (
    <div className="h-full flex flex-col bg-surface">
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border">
        <button onClick={onClose} className="text-t-dim hover:text-neon transition-colors duration-150 p-1.5 hover:bg-neon-ghost rounded-md">
          <ChevronLeft size={15} />
        </button>
        <span className="text-[13px] text-t-secondary flex-1">会话历史</span>
        <span className="text-[11px] text-t-ghost">{sessions.length}</span>
        <button onClick={handleNew} className="text-t-dim hover:text-neon transition-colors duration-150 p-1.5 hover:bg-neon-ghost rounded-md" title="新建会话">
          <Plus size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="text-[13px] text-t-ghost px-3.5 py-4 text-center">加载中...</div>}
        {!loading && sessions.length === 0 && <div className="text-[13px] text-t-ghost px-3.5 py-6 text-center">暂无会话，点击右上角 + 新建</div>}
        {sessions.map((s) => (
          <div
            key={s.session_id}
            onClick={() => handleSwitch(s.session_id)}
            className={`group flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer text-[13px] border-b border-border/40 transition-colors duration-150 ${
              s.session_id === currentSessionId
                ? "bg-neon/5 border-l-2 border-l-neon"
                : "hover:bg-white/[0.03] border-l-2 border-l-transparent"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                s.session_id === currentSessionId ? "bg-neon" : "bg-border-subtle"
              }`}
            />
            <div className="flex-1 min-w-0 text-t-secondary truncate">{s.title}</div>
            <div className="text-[11px] text-t-ghost shrink-0">{timeAgo(s.updated_at)}</div>
            <button
              onClick={(e) => handleDelete(e, s.session_id)}
              disabled={deletingId === s.session_id}
              className="opacity-0 group-hover:opacity-100 text-t-dim hover:text-red-400 transition-all p-1.5 hover:bg-red-400/10 rounded-md"
              title="删除会话"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
