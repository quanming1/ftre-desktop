import { useCallback } from 'react';
import { Hash, Loader2 } from 'lucide-react';
import { useAgentChat } from '@/stores/agent-chat';

export function ChatRoomList() {
  const rooms = useAgentChat((s) => s.rooms);
  const activeRoomId = useAgentChat((s) => s.activeRoomId);
  const setActiveRoom = useAgentChat((s) => s.setActiveRoom);
  const loading = useAgentChat((s) => s.loading);

  const formatTime = useCallback((ts?: number) => {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  }, []);

  return (
    <div className="h-full flex flex-col bg-surface border-r border-border">
      <div className="shrink-0 h-[42px] flex items-center px-3 border-b border-border">
        <span className="text-[12px] font-mono font-medium text-t-secondary">邮件线程</span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
        {loading && rooms.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin text-t-ghost" />
          </div>
        )}
        {!loading && rooms.length === 0 && (
          <div className="px-3 py-6 text-[11px] text-t-ghost font-mono text-center">
            暂无邮件线程<br />Agent 通过 send_email 协作时自动创建
          </div>
        )}
        {rooms.map((room) => {
          const isActive = room.room_id === activeRoomId;
          return (
            <button
              key={room.room_id}
              onClick={() => setActiveRoom(room.room_id)}
              className={`
                w-full flex items-start gap-2.5 px-3 py-2.5
                text-left transition-colors duration-100
                ${isActive
                  ? 'bg-neon-ghost border-l-2 border-l-neon'
                  : 'hover:bg-white/[0.04] border-l-2 border-l-transparent'
                }
              `}
            >
              <div className={`
                w-8 h-8 rounded-lg shrink-0 flex items-center justify-center mt-0.5
                ${isActive ? 'bg-neon/15 text-neon' : 'bg-elevated text-t-ghost'}
              `}>
                <Hash size={14} strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`text-[12px] font-mono truncate ${isActive ? 'text-t-primary font-medium' : 'text-t-secondary'}`}>
                    {room.name}
                  </span>
                  <span className="text-[10px] text-t-ghost font-mono shrink-0 ml-1">
                    {formatTime(room.updated_at)}
                  </span>
                </div>
                <div className="text-[10px] text-t-dim font-mono mt-0.5 truncate">
                  {room.members.map((m) => m.agent_name).join(', ')}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
