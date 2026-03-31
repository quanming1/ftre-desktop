import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Slate, Editable } from 'slate-react';
import { Send, Hash, Loader2 } from 'lucide-react';
import { Range } from 'slate';
import { useAgentChat, type AgentMessage, type RoomMember } from '@/stores/agent-chat';
import { AgentChatInputEditor, renderElement } from './slate';
import type { MentionRef } from './slate';

// ─── 消息内容渲染（@Name 高亮）──────────────────────────────────

function renderMessageContent(content: string, members: RoomMember[]) {
  const parts = content.split(/(@\S+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const name = part.slice(1);
      const member = members.find((m) => m.agent_name === name);
      if (member) {
        return <span key={i} className="font-medium" style={{ color: member.color }}>{part}</span>;
      }
    }
    return <span key={i}>{part}</span>;
  });
}

// ─── 消息气泡 ──────────────────────────────────────────────────────

function MessageBubble({ msg, members }: { msg: AgentMessage; members: RoomMember[] }) {
  const time = new Date(msg.timestamp * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const isUser = msg.senderId === 'user';

  if (msg.type === 'system') {
    return (
      <div className="flex justify-center py-2">
        <span className="text-[11px] text-t-ghost font-mono bg-elevated px-3 py-1 rounded-full">{msg.content}</span>
      </div>
    );
  }

  const initial = msg.senderName.charAt(0).toUpperCase();

  if (isUser) {
    return (
      <div className="flex justify-end gap-2 px-4 py-1">
        <div className="flex flex-col items-end max-w-[70%]">
          <span className="text-[10px] text-t-ghost font-mono mb-1">{time}</span>
          <div className="bg-neon/15 border border-neon/20 rounded-xl rounded-tr-sm px-3 py-2">
            <p className="text-[13px] text-t-primary font-mono leading-relaxed whitespace-pre-wrap break-words">
              {renderMessageContent(msg.content, members)}
            </p>
          </div>
        </div>
        <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-[12px] font-mono font-bold text-white mt-5 bg-neon/30">U</div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 px-4 py-1">
      <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-[12px] font-mono font-bold text-white mt-5" style={{ background: msg.color }}>
        {initial}
      </div>
      <div className="flex flex-col max-w-[70%]">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-mono font-medium" style={{ color: msg.color }}>{msg.senderName}</span>
          <span className="text-[10px] text-t-ghost font-mono">{time}</span>
        </div>
        <div className="bg-elevated border border-border-subtle rounded-xl rounded-tl-sm px-3 py-2">
          <p className="text-[13px] text-t-primary font-mono leading-relaxed whitespace-pre-wrap break-words">
            {renderMessageContent(msg.content, members)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── @ 提及候选列表 ────────────────────────────────────────────────

function MentionDropdown({ candidates, selectedIndex, onSelect }: {
  candidates: RoomMember[]; selectedIndex: number; onSelect: (m: RoomMember) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div ref={listRef} className="absolute bottom-full left-0 mb-1 w-[240px] max-h-[200px] overflow-y-auto bg-elevated border border-border-subtle rounded-lg shadow-2xl py-1 z-50">
      {candidates.map((m, i) => (
        <button key={m.agent_id} onMouseDown={(e) => { e.preventDefault(); onSelect(m); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${i === selectedIndex ? 'bg-neon-ghost' : 'hover:bg-white/[0.04]'}`}>
          <div className="w-6 h-6 rounded-md shrink-0 flex items-center justify-center text-[10px] font-mono font-bold text-white" style={{ background: m.color }}>
            {m.agent_name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[12px] font-mono font-medium text-t-primary truncate">{m.agent_name}</span>
            <span className="text-[10px] font-mono text-t-dim ml-1.5">{m.description}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────

export function AgentChatArea() {
  const activeRoomId = useAgentChat((s) => s.activeRoomId);
  const rooms = useAgentChat((s) => s.rooms);
  const messages = useAgentChat((s) => s.messages);
  const sending = useAgentChat((s) => s.sending);
  const storeSendMessage = useAgentChat((s) => s.sendMessage);
  const roomMembers = useAgentChat((s) => s.getActiveRoomMembers)();
  const activeRoom = useMemo(() => rooms.find((r) => r.room_id === activeRoomId), [rooms, activeRoomId]);

  const inputEditor = useMemo(() => new AgentChatInputEditor(), []);
  const [mentionSearch, setMentionSearch] = useState<{ search: string; range: Range } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const mentionCandidates = useMemo(() => {
    if (!mentionSearch) return [];
    const q = mentionSearch.search.toLowerCase();
    return roomMembers.filter((m) => m.agent_name.toLowerCase().includes(q));
  }, [mentionSearch, roomMembers]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);
  useEffect(() => { setMentionIndex(0); }, [mentionCandidates.length]);

  // 记录已插入的 mentions
  const mentionedAgentsRef = useRef<Set<string>>(new Set());

  const handleInsertMention = useCallback((member: RoomMember) => {
    if (!mentionSearch) return;
    const ref: MentionRef = { memberId: member.agent_id, memberName: member.agent_name, color: member.color };
    inputEditor.insertMention(ref, mentionSearch.range);
    mentionedAgentsRef.current.add(member.agent_id);
    setMentionSearch(null);
    setMentionIndex(0);
  }, [inputEditor, mentionSearch]);

  const handleSend = useCallback(() => {
    if (sending) return;
    const { text, mentions } = inputEditor.serialize();
    if (!text.trim()) return;

    // 从 mentions 中提取 target_agent_ids
    const targetIds = mentions.map((m) => m.memberId);
    // 合并 mentionedAgentsRef（可能有手动输入的 @）
    mentionedAgentsRef.current.forEach((id) => {
      if (!targetIds.includes(id)) targetIds.push(id);
    });

    storeSendMessage(text, targetIds.length > 0 ? targetIds : undefined);
    inputEditor.clear();
    mentionedAgentsRef.current.clear();
    setMentionSearch(null);
  }, [sending, inputEditor, storeSendMessage]);

  const handleSlateChange = useCallback((value: import('slate').Descendant[]) => {
    inputEditor.onChange(value);
    setMentionSearch(inputEditor.getMentionSearch());
  }, [inputEditor]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (mentionSearch && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((p) => (p + 1) % mentionCandidates.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((p) => (p - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleInsertMention(mentionCandidates[mentionIndex]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMentionSearch(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [mentionSearch, mentionCandidates, mentionIndex, handleInsertMention, handleSend]);

  const [canSend, setCanSend] = useState(false);
  const handleSlateChangeWrapper = useCallback((value: import('slate').Descendant[]) => {
    handleSlateChange(value);
    setCanSend(!inputEditor.isEmpty);
  }, [handleSlateChange, inputEditor]);

  if (!activeRoom) {
    return (
      <div className="h-full flex items-center justify-center text-t-ghost font-mono text-[13px]">
        选择一个邮件线程查看
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-base">
      <div className="shrink-0 h-[42px] flex items-center gap-2 px-4 border-b border-border">
        <Hash size={14} strokeWidth={1.5} className="text-t-ghost" />
        <span className="text-[13px] font-mono font-medium text-t-primary">{activeRoom.name}</span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin py-3">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-t-ghost font-mono text-[12px]">
            Agent 通过 send_email 协作时，消息会出现在这里
          </div>
        )}
        {messages.map((msg) => <MessageBubble key={msg.id} msg={msg} members={roomMembers} />)}
        {sending && (
          <div className="flex items-center gap-2 px-4 py-2">
            <Loader2 size={14} className="animate-spin text-neon" />
            <span className="text-[11px] font-mono text-t-dim">投递中...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="relative">
          {mentionSearch && mentionCandidates.length > 0 && (
            <MentionDropdown candidates={mentionCandidates} selectedIndex={mentionIndex} onSelect={handleInsertMention} />
          )}
          <div className="bg-elevated rounded-xl border border-border-subtle focus-within:border-neon/40 transition-colors">
            <Slate editor={inputEditor.editor} initialValue={inputEditor.initialValue} onChange={handleSlateChangeWrapper}>
              <Editable renderElement={renderElement} onKeyDown={onKeyDown}
                placeholder="输入消息… @ 指定 Agent"
                className="w-full bg-transparent text-[13px] text-t-primary outline-none resize-none px-3 py-2.5 font-mono overflow-y-auto overflow-x-hidden"
                style={{ minHeight: 38, maxHeight: 100, wordBreak: 'break-word', overflowWrap: 'anywhere' }} />
            </Slate>
            <div className="flex items-center justify-between px-3 py-1.5 border-t border-white/[0.04]">
              <span className="text-[10px] text-t-ghost font-mono">Enter 发送 · @Agent 指定投递 · 不@ 投递给所有人</span>
              <button onClick={handleSend} disabled={!canSend || sending}
                className={`w-7 h-7 flex items-center justify-center rounded-lg shrink-0 transition-all duration-150 ${canSend && !sending ? 'bg-neon text-base hover:bg-neon/80 cursor-pointer' : 'bg-white/[0.06] text-t-ghost cursor-not-allowed'}`}
                title="发送">
                {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} strokeWidth={1.5} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
