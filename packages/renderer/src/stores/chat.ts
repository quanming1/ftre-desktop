/**
 * Chat Store — 直接消费 ftre gateway WebSocket 消息。
 *
 * 协议：
 *   上行: { content: "用户输入" }
 *   下行: { id, type: "agent_event", data: { type: EventType, data: {...} } }
 *
 * EventType: message, message_complete, reasoning, tool_call, tool_result,
 *            tool_call_streaming, done, error, retry, usage_update
 */
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { wsClient } from "@/services/websocket-client";
import type { WsConnectionStatus, ServerMessage } from "@/services/websocket-client";

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

export type Role = "assistant" | "user" | "system";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  status: "pending" | "running" | "ok" | "error";
  result?: string;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string | null;
  timestamp: number;
  streaming?: boolean;
  toolCalls?: ToolCall[];
  reasoning?: string;
}

export interface ProgressHint {
  id: string;
  text: string;
  timestamp: number;
}

export type ChatMode = "chat" | "plan";

export interface RetryState {
  attempt: number;
  maxAttempts: number;
  message: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

let idCounter = 0;
function nextId(prefix = "msg"): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Internal state
// ═══════════════════════════════════════════════════════════════════════

/** 当前 streaming 的 assistant 消息 ID */
let currentStreamingId: string | null = null;
/** 累积的 content buffer */
let contentBuffer = "";
/** 累积的 reasoning buffer */
let reasoningBuffer = "";
/** tool arg 累积 buffer */
const toolArgBuffers: Map<string, string> = new Map();

// ═══════════════════════════════════════════════════════════════════════
// Message dispatch
// ═══════════════════════════════════════════════════════════════════════

function dispatchMessage(msg: ServerMessage): void {
  if (msg.type !== "agent_event") return;

  const event = msg.data;
  if (!event || !event.type) return;

  const eventType = event.type as string;
  const eventData = event.data || {};

  switch (eventType) {
    case "message":
      handleMessageDelta(eventData as { content: string });
      break;
    case "message_complete":
      handleMessageComplete(eventData as { content: string });
      break;
    case "reasoning":
      handleReasoning(eventData as { content: string });
      break;
    case "tool_call":
      handleToolCall(eventData as { id: string; name: string; arguments: Record<string, unknown> });
      break;
    case "tool_result":
      handleToolResult(eventData as { id: string; name: string; result: string; error?: string | null; status?: string });
      break;
    case "tool_call_streaming":
      handleToolCallStreaming(eventData as { tool_calls: Array<{ index?: number; id?: string; name?: string; arguments_delta?: string }> });
      break;
    case "done":
      handleDone(eventData as { success: boolean; reason: string });
      break;
    case "error":
      handleError(eventData as { message: string; code: string });
      break;
    case "retry":
      handleRetry(eventData as { code: string; message: string; attempt: number; max_attempts: number });
      break;
    case "usage_update":
      // 暂不处理
      break;
    default:
      console.warn("[Chat] Unknown event type:", eventType);
  }
}

function getOrCreateStreamingMsg(): string {
  if (!currentStreamingId) {
    currentStreamingId = nextId("ast");
    contentBuffer = "";
    reasoningBuffer = "";
    const msgs = useChat.getState().messages;
    useChat.setState({
      messages: [
        ...msgs,
        {
          id: currentStreamingId,
          role: "assistant",
          content: null,
          timestamp: Date.now(),
          streaming: true,
        },
      ],
    });
  }
  return currentStreamingId;
}

function handleMessageDelta(data: { content: string }): void {
  const msgId = getOrCreateStreamingMsg();
  contentBuffer += data.content;
  updateStreamingMessage(msgId, { content: contentBuffer });
}

function handleReasoning(data: { content: string }): void {
  const msgId = getOrCreateStreamingMsg();
  reasoningBuffer += data.content;
  updateStreamingMessage(msgId, { reasoning: reasoningBuffer });
}

function handleMessageComplete(data: { content: string }): void {
  const msgId = getOrCreateStreamingMsg();
  contentBuffer = data.content || contentBuffer;
  updateStreamingMessage(msgId, { content: contentBuffer, streaming: false });
  // Don't reset currentStreamingId yet — tool calls may follow in same turn
}

function handleToolCall(data: { id: string; name: string; arguments: Record<string, unknown> }): void {
  const msgId = getOrCreateStreamingMsg();
  const msgs = useChat.getState().messages;
  const idx = msgs.findIndex((m) => m.id === msgId);
  if (idx === -1) return;

  const msg = msgs[idx];
  const toolCalls = [...(msg.toolCalls || [])];
  const argsStr = typeof data.arguments === "object" ? JSON.stringify(data.arguments) : String(data.arguments || "{}");

  const existing = toolCalls.findIndex((tc) => tc.id === data.id);
  if (existing !== -1) {
    toolCalls[existing] = { ...toolCalls[existing], name: data.name, arguments: argsStr, status: "running" };
  } else {
    toolCalls.push({ id: data.id, name: data.name, arguments: argsStr, status: "running" });
  }
  toolArgBuffers.delete(data.id);

  const updated = [...msgs];
  updated[idx] = { ...msg, toolCalls };
  useChat.setState({ messages: updated });
}

function handleToolCallStreaming(data: { tool_calls: Array<{ index?: number; id?: string; name?: string; arguments_delta?: string }> }): void {
  const msgId = getOrCreateStreamingMsg();
  const msgs = useChat.getState().messages;
  const idx = msgs.findIndex((m) => m.id === msgId);
  if (idx === -1) return;

  const msg = msgs[idx];
  const toolCalls = [...(msg.toolCalls || [])];

  for (const chunk of data.tool_calls) {
    if (!chunk.id) continue;
    const buf = toolArgBuffers.get(chunk.id) || "";
    toolArgBuffers.set(chunk.id, buf + (chunk.arguments_delta || ""));

    const existing = toolCalls.findIndex((tc) => tc.id === chunk.id);
    if (existing !== -1) {
      if (chunk.name) toolCalls[existing] = { ...toolCalls[existing], name: chunk.name };
      toolCalls[existing] = { ...toolCalls[existing], arguments: toolArgBuffers.get(chunk.id) || "" };
    } else {
      toolCalls.push({
        id: chunk.id,
        name: chunk.name || "unknown",
        arguments: chunk.arguments_delta || "",
        status: "running",
      });
    }
  }

  const updated = [...msgs];
  updated[idx] = { ...msg, toolCalls, streaming: true };
  useChat.setState({ messages: updated });
}

function handleToolResult(data: { id: string; name: string; result: string; error?: string | null; status?: string }): void {
  const msgs = useChat.getState().messages;
  const isError = !!data.error;

  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.toolCalls) {
      const tcIdx = m.toolCalls.findIndex((tc) => tc.id === data.id);
      if (tcIdx !== -1) {
        const updated = [...msgs];
        const updatedToolCalls = [...m.toolCalls];
        updatedToolCalls[tcIdx] = {
          ...updatedToolCalls[tcIdx],
          status: isError ? "error" : "ok",
          result: isError ? data.error! : data.result,
          name: data.name || updatedToolCalls[tcIdx].name,
        };
        updated[i] = { ...m, toolCalls: updatedToolCalls };
        useChat.setState({ messages: updated });
        return;
      }
    }
  }
}

function handleDone(_data: { success: boolean; reason: string }): void {
  // Finalize streaming message
  if (currentStreamingId) {
    const msgs = useChat.getState().messages;
    const idx = msgs.findIndex((m) => m.id === currentStreamingId);
    if (idx !== -1) {
      const updated = [...msgs];
      const msg = updated[idx];
      // Force-complete any pending tool calls
      const toolCalls = msg.toolCalls?.map((tc) =>
        tc.status === "running" || tc.status === "pending" ? { ...tc, status: "ok" as const } : tc
      );
      updated[idx] = { ...msg, streaming: false, toolCalls };
      useChat.setState({ messages: updated });
    }
  }

  currentStreamingId = null;
  contentBuffer = "";
  reasoningBuffer = "";
  toolArgBuffers.clear();
  useChat.setState({ isBusy: false, progress: null, retryState: null });
}

function handleError(data: { message: string; code: string }): void {
  useChat.setState({ error: `[${data.code}] ${data.message}`, isBusy: false });
  currentStreamingId = null;
  contentBuffer = "";
  reasoningBuffer = "";
}

function handleRetry(data: { code: string; message: string; attempt: number; max_attempts: number }): void {
  useChat.setState({
    retryState: { attempt: data.attempt, maxAttempts: data.max_attempts, message: data.message },
  });
}

function updateStreamingMessage(msgId: string, patch: Partial<ChatMessage>): void {
  const msgs = useChat.getState().messages;
  const idx = msgs.findIndex((m) => m.id === msgId);
  if (idx === -1) return;
  const updated = [...msgs];
  updated[idx] = { ...updated[idx], ...patch };
  useChat.setState({ messages: updated });
}

// ─── Wire up WebSocket ──────────────────────────────────────────────

wsClient.onMessage(dispatchMessage);
wsClient.onDisconnect(() => {
  useChat.setState({ isBusy: false, connected: false, wsStatus: "disconnected" });
  currentStreamingId = null;
});
wsClient.onConnect(() => {
  useChat.setState({ connected: true, wsStatus: "connected" });
});
wsClient.onStatusChange((status) => {
  useChat.setState({ wsStatus: status, connected: status === "connected" });
});

// ═══════════════════════════════════════════════════════════════════════
// Zustand Store
// ═══════════════════════════════════════════════════════════════════════

interface ChatState {
  messages: ChatMessage[];
  progress: ProgressHint | null;
  isBusy: boolean;
  error: string | null;
  sessionId: string | null;
  connected: boolean;
  wsStatus: WsConnectionStatus;
  model: string | null;
  provider: string | null;
  agentId: string;
  mode: ChatMode;
  retryState: RetryState | null;
  contextTokens: number;

  sendMessage: (content: string) => void;
  newChat: () => void;
  setConnected: (v: boolean) => void;
  setWsStatus: (status: WsConnectionStatus) => void;
  setModel: (model: string | null) => void;
  setProvider: (provider: string | null) => void;
  setAgentId: (id: string) => void;
  setMode: (mode: ChatMode) => void;
  clearMessages: () => void;
}

export const useChat = create<ChatState>(() => ({
  messages: [],
  progress: null,
  isBusy: false,
  error: null,
  sessionId: null,
  connected: false,
  wsStatus: "disconnected" as WsConnectionStatus,
  model: null,
  provider: null,
  agentId: "code_agent",
  mode: "chat",
  retryState: null,
  contextTokens: 0,

  sendMessage: (content: string) => {
    if (!content.trim()) return;

    // Add user message to UI
    const userMsg: ChatMessage = {
      id: nextId("user"),
      role: "user",
      content,
      timestamp: Date.now(),
    };
    const msgs = useChat.getState().messages;
    useChat.setState({
      messages: [...msgs, userMsg],
      isBusy: true,
      error: null,
      retryState: null,
    });

    // Send to backend
    wsClient.sendChat(content);
  },

  newChat: () => {
    currentStreamingId = null;
    contentBuffer = "";
    reasoningBuffer = "";
    toolArgBuffers.clear();
    useChat.setState({
      messages: [],
      progress: null,
      isBusy: false,
      error: null,
      retryState: null,
      contextTokens: 0,
    });
  },

  setConnected: (v: boolean) => useChat.setState({ connected: v }),
  setWsStatus: (status: WsConnectionStatus) =>
    useChat.setState({ wsStatus: status, connected: status === "connected" }),
  setModel: (model: string | null) => useChat.setState({ model }),
  setProvider: (provider: string | null) => useChat.setState({ provider }),
  setAgentId: (id: string) => useChat.setState({ agentId: id }),
  setMode: (mode) => useChat.setState({ mode }),

  clearMessages: () => {
    currentStreamingId = null;
    contentBuffer = "";
    reasoningBuffer = "";
    toolArgBuffers.clear();
    useChat.setState({
      messages: [],
      progress: null,
      isBusy: false,
      error: null,
      sessionId: null,
      retryState: null,
      contextTokens: 0,
      agentId: "code_agent",
    });
  },
}));

// ═══════════════════════════════════════════════════════════════════════
// Selectors
// ═══════════════════════════════════════════════════════════════════════

export const useMessageIds = (): string[] =>
  useChat(useShallow((s) => s.messages.map((m) => m.id)));
export const useMessageById = (id: string) =>
  useChat((s) => s.messages.find((m) => m.id === id));
export const useIsBusy = () => useChat((s) => s.isBusy);
export const useIsStreaming = () => useChat((s) => s.isBusy);
export const useModel = () => useChat((s) => s.model);
export const useProvider = () => useChat((s) => s.provider);
export const useSessionId = () => useChat((s) => s.sessionId);
export const useAgentId = () => useChat((s) => s.agentId);
export const useMode = () => useChat((s) => s.mode);
export const useWsStatus = () => useChat((s) => s.wsStatus);
export const useProgress = () => useChat((s) => s.progress);
export const useContextTokens = () => useChat((s) => s.contextTokens);
export const useStreamingMessageId = () =>
  useChat((s) => s.messages.find((m) => m.streaming)?.id ?? null);
