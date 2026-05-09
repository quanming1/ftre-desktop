/**
 * Chat store — syncs state from ws-stream-manager.
 */
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import {
  streamManager,
  type ChatMessage,
  type ChatSession,
} from "@/services/ws-stream-manager";

/** Retry state — placeholder for future WS-based retry */
export interface RetryState {
  attempt: number;
  maxAttempts: number;
  message: string;
}

export type ChatMode = "chat" | "plan";

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  activeChatId: string | null;
  /** Alias for activeChatId — backwards compatibility */
  sessionId: string | null;
  connected: boolean;
  model: string | null;
  agentId: string;
  mode: ChatMode;
  retryState: RetryState | null;
  contextTokens: number;

  // Actions
  sendMessage: (content: string) => void;
  newChat: () => void;
  switchChat: (chatId: string) => void;
  setConnected: (v: boolean) => void;
  setModel: (model: string | null) => void;
  setAgentId: (id: string) => void;
  setMode: (mode: ChatMode) => void;
  clearMessages: () => void;
}

export const useChat = create<ChatState>((set, get) => {
  // Subscribe to stream manager changes
  streamManager.onChange((session: ChatSession) => {
    set({
      messages: [...session.messages],
      isStreaming: session.isStreaming,
      error: session.error,
      activeChatId: session.chatId,
      sessionId: session.chatId,
    });
  });

  return {
    messages: [],
    isStreaming: false,
    error: null,
    activeChatId: null,
    sessionId: null,
    connected: false,
    model: localStorage.getItem("selectedModel") || null,
    agentId: "code_agent",
    mode: "chat",
    retryState: null,
    contextTokens: 0,

    sendMessage: (content: string) => {
      if (!content.trim()) return;
      streamManager.sendMessage(content);
    },

    newChat: () => {
      streamManager.newChat();
    },

    switchChat: (chatId: string) => {
      streamManager.switchChat(chatId);
    },

    setConnected: (v: boolean) => set({ connected: v }),

    setModel: (model: string | null) => {
      localStorage.setItem("selectedModel", model || "");
      set({ model });
    },

    setAgentId: (id: string) => set({ agentId: id }),

    setMode: (mode: ChatMode) => set({ mode }),

    clearMessages: () => {
      set({
        messages: [],
        isStreaming: false,
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

// ── Selector Hooks ──

/** 获取消息 ID 列表（使用 shallow 比较避免不必要的重渲染） */
export const useMessageIds = (): string[] =>
  useChat(useShallow((s) => s.messages.map((m) => m.id)));

/** 根据 ID 获取单条消息 */
export const useMessageById = (id: string) =>
  useChat((s) => s.messages.find((m) => m.id === id));

/** 获取流式状态 */
export const useIsStreaming = () => useChat((s) => s.isStreaming);

/** 获取当前模型 */
export const useModel = () => useChat((s) => s.model);

/** 获取当前会话 ID */
export const useSessionId = () => useChat((s) => s.activeChatId);

/** 获取当前 Agent ID */
export const useAgentId = () => useChat((s) => s.agentId);

/** 获取当前聊天模式 */
export const useMode = () => useChat((s) => s.mode);

/** 获取上下文 token 数量 */
export const useContextTokens = () => useChat((s) => s.contextTokens);

/** 获取当前流式消息 ID (last streaming msg) */
export const useStreamingMessageId = () =>
  useChat((s) => {
    const streaming = s.messages.find((m) => m.streaming);
    return streaming?.id ?? null;
  });
