/**
 * Chat store — syncs state from ws-stream-manager (Protocol v2).
 *
 * DESIGN: This store owns `activeChatId` — the single source of truth for
 * which chat the UI is displaying. The stream manager emits data for ALL chats,
 * and this store filters to only propagate the active one to React.
 *
 * `activeChatId` changes only via:
 * - switchChat() — user explicitly picks a chat
 * - onFocus callback — server assigns a chat (session.ready, new session)
 */
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import {
  streamManager,
  type ChatMessage,
  type ChatSession,
  type ToolCall,
  type ProgressHint,
} from "@/services/ws-stream-manager";
import type { WsConnectionStatus } from "@/services/websocket-client";
import type { MediaItem } from "@/services/ws-protocol";

export type { ChatMessage, ToolCall, ProgressHint };

export interface RetryState {
  attempt: number;
  maxAttempts: number;
  message: string;
}

export type ChatMode = "chat" | "plan";

interface ChatState {
  messages: ChatMessage[];
  toolCalls: ToolCall[];
  progress: ProgressHint | null;
  isBusy: boolean;
  error: string | null;
  activeChatId: string | null;
  sessionId: string | null;
  connected: boolean;
  wsStatus: WsConnectionStatus;
  model: string | null;
  agentId: string;
  mode: ChatMode;
  retryState: RetryState | null;
  contextTokens: number;

  sendMessage: (content: string, media?: MediaItem[]) => void;
  newChat: () => void;
  switchChat: (chatId: string) => void;
  setConnected: (v: boolean) => void;
  setWsStatus: (status: WsConnectionStatus) => void;
  setModel: (model: string | null) => void;
  setAgentId: (id: string) => void;
  setMode: (mode: ChatMode) => void;
  clearMessages: () => void;
}

export const useChat = create<ChatState>((set, get) => {
  // ─── Data updates: propagate session state to React ─────────────
  streamManager.onChange((session: ChatSession) => {
    const active = get().activeChatId;
    // Only update UI state if this session is the one we're displaying
    if (active && session.chatId !== active) {
      return;
    }
    set({
      messages: [...session.messages],
      toolCalls: [...session.toolCalls],
      progress: session.progress,
      isBusy: session.isBusy,
      error: session.error,
      activeChatId: session.chatId,
      sessionId: session.chatId,
    });
  });

  // ─── Focus changes: update which chat is displayed ──────────────
  streamManager.onFocus((chatId: string) => {
    const current = get().activeChatId;
    if (chatId === current) return;

    // Switch to the newly focused chat and load its current state
    const session = streamManager.getSession(chatId);
    set({
      activeChatId: chatId,
      sessionId: chatId,
      messages: [...session.messages],
      toolCalls: [...session.toolCalls],
      progress: session.progress,
      isBusy: session.isBusy,
      error: session.error,
    });
  });

  return {
    messages: [],
    toolCalls: [],
    progress: null,
    isBusy: false,
    error: null,
    activeChatId: null,
    sessionId: null,
    connected: false,
    wsStatus: "disconnected" as WsConnectionStatus,
    model: localStorage.getItem("selectedModel") || null,
    agentId: "code_agent",
    mode: "chat",
    retryState: null,
    contextTokens: 0,

    sendMessage: (content: string, media?: MediaItem[]) => {
      if (!content.trim() && (!media || media.length === 0)) return;
      streamManager.sendMessage(content, media);
    },

    newChat: () => {
      streamManager.newChat();
    },

    switchChat: (chatId: string) => {
      // streamManager.switchChat will emit both focus and change events.
      // Our onFocus/onChange handlers will sync the store state.
      streamManager.switchChat(chatId);
    },

    setConnected: (v: boolean) => set({ connected: v }),

    setWsStatus: (status: WsConnectionStatus) =>
      set({ wsStatus: status, connected: status === "connected" }),

    setModel: (model: string | null) => {
      localStorage.setItem("selectedModel", model || "");
      set({ model });
    },

    setAgentId: (id: string) => set({ agentId: id }),

    setMode: (mode) => set({ mode }),

    clearMessages: () => {
      set({
        messages: [],
        toolCalls: [],
        progress: null,
        isBusy: false,
        error: null,
        activeChatId: null,
        sessionId: null,
        retryState: null,
        contextTokens: 0,
        agentId: "code_agent",
      });
    },
  };
});

// ─── Selectors ──────────────────────────────────────────────────────

export const useMessageIds = (): string[] =>
  useChat(useShallow((s) => s.messages.map((m) => m.id)));

export const useMessageById = (id: string) =>
  useChat((s) => s.messages.find((m) => m.id === id));

/** @deprecated Use useIsBusy instead */
export const useIsStreaming = () => useChat((s) => s.isBusy);

export const useIsBusy = () => useChat((s) => s.isBusy);

export const useModel = () => useChat((s) => s.model);

export const useSessionId = () => useChat((s) => s.activeChatId);

export const useAgentId = () => useChat((s) => s.agentId);

export const useMode = () => useChat((s) => s.mode);

export const useContextTokens = () => useChat((s) => s.contextTokens);

export const useStreamingMessageId = () =>
  useChat((s) => {
    const streaming = s.messages.find((m) => m.streaming);
    return streaming?.id ?? null;
  });

export const useWsStatus = () => useChat((s) => s.wsStatus);

export const useToolCalls = () => useChat((s) => s.toolCalls);

export const useToolCallById = (callId: string) =>
  useChat((s) => s.toolCalls.find((t) => t.call_id === callId));

export const useProgress = () => useChat((s) => s.progress);
