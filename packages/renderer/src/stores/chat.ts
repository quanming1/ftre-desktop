import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import type {
  AnyMessage,
  ChatMessage,
  ToolCallMessage,
  ActionButtonMessage,
  CodeRef,
  MessagePart,
} from "@/types/chat";
import type { RetryState } from "@/services/stream-manager";

let msgCounter = 0;
function nextId() {
  return `msg-${++msgCounter}-${Date.now()}`;
}

/** StreamSession 同步过来的数据 */
export interface SyncData {
  sessionId: string | null;
  messages: AnyMessage[];
  isStreaming: boolean;
  streamingMessageId: string | null;
  contextTokens: number;
  retryState: RetryState | null;
}

export type ChatMode = "chat" | "plan";

interface ChatState {
  sessionId: string | null;
  messages: AnyMessage[];
  isStreaming: boolean;
  streamingMessageId: string | null;
  model: string | null;
  contextTokens: number;
  retryState: RetryState | null;
  agentId: string;
  mode: ChatMode;

  setSessionId: (id: string) => void;
  setModel: (model: string | null) => void;
  setMode: (mode: ChatMode) => void;
  setAgentId: (id: string) => void;
  addUserMessage: (
    content: string,
    codeRefs?: CodeRef[],
    parts?: MessagePart[],
  ) => void;
  startAssistantMessage: () => string;
  appendAssistantContent: (id: string, content: string) => void;
  finalizeAssistantMessage: (id: string) => void;
  addToolCall: (
    toolId: string,
    name: string,
    args: Record<string, unknown>,
  ) => string;
  updateToolResult: (
    toolId: string,
    result: string,
    status?: "completed" | "error" | "cancelled",
  ) => void;
  addSystemMessage: (content: string) => void;
  addActionButton: (label: string, step: string, summary: string) => void;
  setStreaming: (v: boolean) => void;
  setContextTokens: (n: number) => void;
  clearMessages: () => void;
  /** 从 StreamSession 同步全部状态（视图层同步） */
  syncFrom: (data: SyncData) => void;
  getMessageById: (id: string) => AnyMessage | undefined;
  getMessageIds: () => string[];
}

export const useChat = create<ChatState>((set, get) => ({
  sessionId: null,
  messages: [],
  isStreaming: false,
  streamingMessageId: null,
  model: localStorage.getItem("selectedModel") || null,
  contextTokens: 0,
  retryState: null,
  agentId: "code_agent",
  mode: "chat",

  setSessionId: (id) => set({ sessionId: id }),
  setModel: (model) => {
    localStorage.setItem("selectedModel", model || "");
    set({ model });
  },
  setMode: (mode) => set({ mode }),
  setAgentId: (agentId) => set({ agentId }),

  addUserMessage: (content, codeRefs, parts) => {
    const msg: ChatMessage = {
      id: nextId(),
      role: "user",
      content,
      codeRefs,
      parts,
    };
    set({ messages: [...get().messages, msg] });
  },

  startAssistantMessage: () => {
    const id = nextId();
    const msg: ChatMessage = {
      id,
      role: "assistant",
      content: "",
      streaming: true,
    };
    set({ messages: [...get().messages, msg], streamingMessageId: id });
    return id;
  },

  appendAssistantContent: (id, content) => {
    set({
      messages: get().messages.map((m) =>
        m.id === id && "content" in m
          ? { ...m, content: m.content + content }
          : m,
      ),
    });
  },

  finalizeAssistantMessage: (id) => {
    set({
      messages: get().messages.map((m) =>
        m.id === id ? { ...m, streaming: false } : m,
      ),
      streamingMessageId: null,
    });
  },

  addToolCall: (toolId, name, args) => {
    const id = nextId();
    const msg: ToolCallMessage = {
      id,
      role: "tool",
      toolId,
      name,
      arguments: args,
      status: "running",
    };
    set({ messages: [...get().messages, msg] });
    return id;
  },

  updateToolResult: (toolId, result, status = "completed") => {
    set({
      messages: get().messages.map((m) =>
        "toolId" in m && m.toolId === toolId ? { ...m, result, status } : m,
      ),
    });
  },

  addSystemMessage: (content) => {
    const msg: ChatMessage = { id: nextId(), role: "system", content };
    set({ messages: [...get().messages, msg] });
  },

  addActionButton: (label, step, summary) => {
    const msg: ActionButtonMessage = {
      id: nextId(),
      role: "action_button",
      label,
      step,
      summary,
    };
    set({ messages: [...get().messages, msg] });
  },

  setStreaming: (v) => set({ isStreaming: v }),

  setContextTokens: (n) => set({ contextTokens: n }),

  clearMessages: () =>
    set({
      messages: [],
      sessionId: null,
      contextTokens: 0,
      isStreaming: false,
      streamingMessageId: null,
      retryState: null,
      agentId: "code_agent",
    }),

  syncFrom: (data) => {
    const cur = get();
    if (
      cur.messages === data.messages &&
      cur.isStreaming === data.isStreaming &&
      cur.streamingMessageId === data.streamingMessageId &&
      cur.contextTokens === data.contextTokens &&
      cur.sessionId === data.sessionId &&
      cur.retryState === data.retryState
    )
      return;
    set({
      sessionId: data.sessionId,
      messages: data.messages,
      isStreaming: data.isStreaming,
      streamingMessageId: data.streamingMessageId,
      contextTokens: data.contextTokens,
      retryState: data.retryState,
    });
  },

  getMessageById: (id) => get().messages.find((m) => m.id === id),

  getMessageIds: () => get().messages.map((m) => m.id),
}));

// ── O(1) 消息索引缓存 ──
// 当 messages 引用变化时重建 Map，后续 selector 调用 O(1) 查找
let _cachedMsgs: AnyMessage[] | null = null;
let _cachedIndex: Map<string, AnyMessage> | null = null;

function getIndex(messages: AnyMessage[]): Map<string, AnyMessage> {
  if (messages !== _cachedMsgs) {
    _cachedMsgs = messages;
    _cachedIndex = new Map();
    for (const m of messages) _cachedIndex.set(m.id, m);
  }
  return _cachedIndex!;
}

// ── 专用选择器 Hooks ──

/** 获取消息 ID 列表（使用 shallow 比较避免不必要的重渲染） */
export const useMessageIds = (): string[] =>
  useChat(useShallow((s) => s.messages.map((m) => m.id)));

/** 根据 ID 获取单条消息（O(1) Map 查找） */
export const useMessageById = (id: string) =>
  useChat((s) => getIndex(s.messages).get(id));

/** 获取流式状态 */
export const useIsStreaming = () => useChat((s) => s.isStreaming);

/** 获取当前流式消息 ID */
export const useStreamingMessageId = () => useChat((s) => s.streamingMessageId);

/** 获取上下文 token 数量 */
export const useContextTokens = () => useChat((s) => s.contextTokens);

/** 获取当前模型 */
export const useModel = () => useChat((s) => s.model);

/** 获取当前会话 ID */
export const useSessionId = () => useChat((s) => s.sessionId);

/** 获取当前 Agent ID */
export const useAgentId = () => useChat((s) => s.agentId);

/** 获取当前聊天模式 */
export const useMode = () => useChat((s) => s.mode);
