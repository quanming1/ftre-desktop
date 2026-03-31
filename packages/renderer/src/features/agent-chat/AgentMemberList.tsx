import { Users } from 'lucide-react';
import { useAgentChat, type RoomMember } from '@/stores/agent-chat';

function MemberItem({ member }: { member: RoomMember }) {
  const initial = member.agent_name.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.03] transition-colors rounded-md mx-1">
      <div
        className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-[12px] font-mono font-bold text-white"
        style={{ background: member.color }}
      >
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[12px] font-mono font-medium text-t-primary truncate block">
          {member.agent_name}
        </span>
        <span className="text-[10px] font-mono text-t-dim truncate block mt-0.5">
          {member.description || member.workspace}
        </span>
      </div>
    </div>
  );
}

export function AgentMemberList() {
  const members = useAgentChat((s) => s.getActiveRoomMembers)();

  return (
    <div className="h-full flex flex-col bg-surface border-l border-border">
      <div className="shrink-0 h-[42px] flex items-center gap-2 px-3 border-b border-border">
        <Users size={13} strokeWidth={1.5} className="text-t-ghost" />
        <span className="text-[12px] font-mono font-medium text-t-secondary">
          成员
        </span>
        <span className="text-[11px] font-mono text-t-ghost">({members.length})</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
        {members.length === 0 && (
          <div className="px-3 py-6 text-[10px] text-t-ghost font-mono text-center">
            暂无成员
          </div>
        )}
        {members.map((m) => (
          <MemberItem key={m.agent_id} member={m} />
        ))}
      </div>
    </div>
  );
}
