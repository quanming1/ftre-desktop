import { create } from 'zustand';
import {
  fetchAgentDefs, fetchRooms, fetchRoomMessages, sendRoomMessage,
  type AgentDef, type RoomInfo, type RoomMember, type RoomMessage,
} from '@/services/api';

// ─── 类型 ──────────────────────────────────────────────────────────

export type { AgentDef, RoomInfo, RoomMember, RoomMessage };

export interface AgentMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  type: 'text' | 'system';
  color: string;
}

function rawToMessage(m: RoomMessage, roomId: string): AgentMessage {
  return {
    id: m.id,
    roomId,
    senderId: m.sender_id,
    senderName: m.sender_name,
    content: m.content,
    timestamp: m.timestamp,
    type: (m.type === 'system' ? 'system' : 'text') as 'text' | 'system',
    color: m.color || '#888',
  };
}

// ─── Store ──────────────────────────────────────────────────────────

export interface AgentChatState {
  agentDefs: AgentDef[];
  rooms: RoomInfo[];
  activeRoomId: string | null;
  messages: AgentMessage[];
  loading: boolean;
  sending: boolean;
  _pollTimer: ReturnType<typeof setInterval> | null;

  init: (workspace: string) => Promise<void>;
  loadRooms: () => Promise<void>;
  setActiveRoom: (roomId: string) => Promise<void>;
  loadMessages: (roomId: string) => Promise<void>;
  sendMessage: (content: string, targetAgentIds?: string[]) => Promise<void>;
  getActiveRoomMembers: () => RoomMember[];
  startPolling: () => void;
  stopPolling: () => void;
}

export const useAgentChat = create<AgentChatState>((set, get) => ({
  agentDefs: [],
  rooms: [],
  activeRoomId: null,
  messages: [],
  loading: false,
  sending: false,
  _pollTimer: null,

  init: async (workspace: string) => {
    set({ loading: true });
    try {
      const [defs, rooms] = await Promise.all([fetchAgentDefs(workspace), fetchRooms()]);
      set({ agentDefs: defs, rooms });
      if (rooms.length > 0 && !get().activeRoomId) {
        await get().setActiveRoom(rooms[0].room_id);
      }
    } finally {
      set({ loading: false });
    }
  },

  loadRooms: async () => {
    const rooms = await fetchRooms();
    set({ rooms });
  },

  setActiveRoom: async (roomId) => {
    get().stopPolling();
    set({ activeRoomId: roomId, messages: [] });
    await get().loadMessages(roomId);
    get().startPolling();
  },

  loadMessages: async (roomId) => {
    const raw = await fetchRoomMessages(roomId);
    set({ messages: raw.map((m) => rawToMessage(m, roomId)) });
  },

  startPolling: () => {
    get().stopPolling();
    const timer = setInterval(async () => {
      const { activeRoomId, messages } = get();
      if (!activeRoomId) return;
      const lastTs = messages.length > 0
        ? Math.max(...messages.map((m) => m.timestamp))
        : 0;
      const raw = await fetchRoomMessages(activeRoomId, lastTs);
      if (raw.length > 0) {
        const newMsgs = raw.map((m) => rawToMessage(m, activeRoomId));
        const existingIds = new Set(messages.map((m) => m.id));
        const unique = newMsgs.filter((m) => !existingIds.has(m.id));
        if (unique.length > 0) {
          set((s) => ({ messages: [...s.messages, ...unique] }));
        }
      }
    }, 1500);
    set({ _pollTimer: timer });
  },

  stopPolling: () => {
    const timer = get()._pollTimer;
    if (timer) {
      clearInterval(timer);
      set({ _pollTimer: null });
    }
  },

  sendMessage: async (content, targetAgentIds) => {
    const { activeRoomId } = get();
    if (!activeRoomId || !content.trim()) return;
    set({ sending: true });
    try {
      await sendRoomMessage(activeRoomId, content, undefined, targetAgentIds);
      await get().loadRooms();
    } finally {
      set({ sending: false });
    }
  },

  getActiveRoomMembers: () => {
    const { rooms, activeRoomId } = get();
    const room = rooms.find((r) => r.room_id === activeRoomId);
    return room?.members || [];
  },
}));
