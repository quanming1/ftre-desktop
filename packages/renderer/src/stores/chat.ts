/**
 * Chat Store — 消费 ftre gateway WebSocket 事件流
 *
 * 上行: { type: "user_input", data: { content, session_id } }
 * 下行: { type: "agent_event", data: { type, data }, metadata: { session_id } }
 */
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { wsClient } from "@/services/websocket-client";
import type { WsConnectionStatus, ServerMessage } from "@/services/websocket-client";

// ─── Types ──────────────────────────────────────────────────────────

export type Role = "assistant" | "user";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  status: "pending" | "running" | "ok" | "error";
  result?: string;
}

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCallId: string };

export interface ChatMessage {
  id: string;
  role: Role;
  content: string | null;
  timestamp: number;
  streaming?: boolean;
  toolCalls?: ToolCall[];
  reasoning?: string;
  parts?: MessagePart[];
  isError?: boolean;
}

export interface RetryState {
  attempt: number;
  maxAttempts: number;
  message: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

let idCounter = 0;
function nextId(prefix = "msg"): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

// ─── Streaming State ────────────────────────────────────────────────

let currentStreamingId: string | null = null;
let contentBuffer = "";
let reasoningBuffer = "";
const toolArgBuffers = new Map<string, string>();

function resetStreamingState(): void {
  currentStreamingId = null;
  contentBuffer = "";
  reasoningBuffer = "";
  toolArgBuffers.clear();
}

// ─── Streaming Msg Helpers ──────────────────────────────────────────

/** 获取或创建当前 streaming assistant 消息 */
function ensureStreamingMsg(): void {
  if (currentStreamingId) return;
  currentStreamingId = nextId("ast");
  contentBuffer = "";
  reasoningBuffer = "";
  const msgs = useChat.getState().messages;
  useChat.setState({
    messages: [...msgs, {
      id: currentStreamingId,
      role: "assistant",
      content: null,
      timestamp: Date.now(),
      streaming: true,
      parts: [],
      toolCalls: [],
    }],
  });
}

/** 更新当前 streaming 消息 */
function updateStreaming(updater: (msg: ChatMessage) => ChatMessage): void {
  if (!currentStreamingId) return;
  const msgs = useChat.getState().messages;
  const idx = msgs.findIndex((m) => m.id === currentStreamingId);
  if (idx === -1) return;
  const updated = [...msgs];
  updated[idx] = updater(msgs[idx]);
  useChat.setState({ messages: updated });
}

// ─── Event Handlers ─────────────────────────────────────────────────

function dispatchMessage(msg: ServerMessage): void {
  if (msg.type !== "agent_event") return;
  const event = msg.data;
  if (!event?.type) return;

  // 同步 session_id
  const sessionId = msg.metadata?.session_id as string | undefined;
  if (sessionId && sessionId !== useChat.getState().sessionId) {
    useChat.setState({ sessionId });
  }

  const { type } = event;
  const d = event.data || {};

  switch (type) {
    case "message": {
      ensureStreamingMsg();
      contentBuffer += (d as any).content || "";
      updateStreaming((m) => {
        const parts = [...(m.parts || [])];
        const last = parts[parts.length - 1];
        if (last?.type === "text") {
          parts[parts.length - 1] = { type: "text", text: last.text + (d as any).content };
        } else {
          parts.push({ type: "text", text: (d as any).content });
        }
        return { ...m, content: contentBuffer, parts, streaming: true };
      });
      break;
    }

    case "message_complete": {
      ensureStreamingMsg();
      const finalText = (d as any).content || "";
      updateStreaming((m) => {
        const parts = [...(m.parts || [])];
        const last = parts[parts.length - 1];
        if (last?.type === "text") {
          parts[parts.length - 1] = { type: "text", text: finalText };
        }
        contentBuffer = parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("");
        return { ...m, content: contentBuffer, parts, streaming: false };
      });
      break;
    }

    case "reasoning": {
      ensureStreamingMsg();
      reasoningBuffer += (d as any).content || "";
      updateStreaming((m) => ({ ...m, reasoning: reasoningBuffer }));
      break;
    }

    case "tool_call": {
      ensureStreamingMsg();
      const { id, name, arguments: args } = d as any;
      const argsStr = typeof args === "object" ? JSON.stringify(args) : String(args || "{}");
      updateStreaming((m) => {
        const toolCalls = [...(m.toolCalls || [])];
        const parts = [...(m.parts || [])];
        const existing = toolCalls.findIndex((tc) => tc.id === id);
        if (existing !== -1) {
          toolCalls[existing] = { ...toolCalls[existing], name, arguments: argsStr, status: "running" };
        } else {
          toolCalls.push({ id, name, arguments: argsStr, status: "running" });
          parts.push({ type: "tool_call", toolCallId: id });
        }
        toolArgBuffers.delete(id);
        return { ...m, toolCalls, parts };
      });
      break;
    }

    case "tool_call_streaming": {
      ensureStreamingMsg();
      const chunks = (d as any).tool_calls || [];
      updateStreaming((m) => {
        const toolCalls = [...(m.toolCalls || [])];
        const parts = [...(m.parts || [])];
        for (const chunk of chunks) {
          if (!chunk.id) continue;
          toolArgBuffers.set(chunk.id, (toolArgBuffers.get(chunk.id) || "") + (chunk.arguments_delta || ""));
          const existing = toolCalls.findIndex((tc) => tc.id === chunk.id);
          if (existing !== -1) {
            if (chunk.name) toolCalls[existing] = { ...toolCalls[existing], name: chunk.name };
            toolCalls[existing] = { ...toolCalls[existing], arguments: toolArgBuffers.get(chunk.id) || "" };
          } else {
            toolCalls.push({ id: chunk.id, name: chunk.name || "unknown", arguments: chunk.arguments_delta || "", status: "running" });
            parts.push({ type: "tool_call", toolCallId: chunk.id });
          }
        }
        return { ...m, toolCalls, parts, streaming: true };
      });
      break;
    }

    case "tool_result": {
      const { id, name, result, error } = d as any;
      const isError = !!error;
      const msgs = useChat.getState().messages;
      for (let i = msgs.length - 1; i >= 0; i--) {
        const tc = msgs[i].toolCalls?.find((t) => t.id === id);
        if (tc) {
          const updated = [...msgs];
          const updatedTc = [...msgs[i].toolCalls!];
          const tcIdx = updatedTc.findIndex((t) => t.id === id);
          updatedTc[tcIdx] = { ...updatedTc[tcIdx], status: isError ? "error" : "ok", result: isError ? error : result, name: name || updatedTc[tcIdx].name };
          updated[i] = { ...msgs[i], toolCalls: updatedTc };
          useChat.setState({ messages: updated });
          break;
        }
      }
      break;
    }

    case "done": {
      if (currentStreamingId) {
        updateStreaming((m) => ({
          ...m,
          streaming: false,
          toolCalls: m.toolCalls?.map((tc) =>
            tc.status === "running" || tc.status === "pending" ? { ...tc, status: "ok" as const } : tc
          ),
        }));
      }
      resetStreamingState();
      useChat.setState({ isBusy: false, retryState: null });
      break;
    }

    case "error": {
      const { message: errMsg, code } = d as any;
      // 将错误作为一条 assistant 消息显示在对话中
      const errorMsg: ChatMessage = {
        id: nextId("err"),
        role: "assistant",
        content: errMsg,
        timestamp: Date.now(),
        isError: true,
      };
      useChat.setState({
        messages: [...useChat.getState().messages, errorMsg],
        error: `[${code}] ${errMsg}`,
        isBusy: false,
      });
      resetStreamingState();
      break;
    }

    case "retry": {
      const { attempt, max_attempts, message: retryMsg } = d as any;
      useChat.setState({ retryState: { attempt, maxAttempts: max_attempts, message: retryMsg } });
      break;
    }
  }
}

// ─── Wire up WebSocket ──────────────────────────────────────────────

wsClient.onMessage(dispatchMessage);
wsClient.onDisconnect(() => {
  useChat.setState({ isBusy: false, connected: false, wsStatus: "disconnected" });
  resetStreamingState();
});
wsClient.onConnect(() => useChat.setState({ connected: true, wsStatus: "connected" }));
wsClient.onStatusChange((s) => useChat.setState({ wsStatus: s, connected: s === "connected" }));

// ─── Store ──────────────────────────────────────────────────────────

interface ChatState {
  messages: ChatMessage[];
  isBusy: boolean;
  error: string | null;
  sessionId: string | null;
  connected: boolean;
  wsStatus: WsConnectionStatus;
  model: string | null;
  provider: string | null;
  agentId: string;
  retryState: RetryState | null;

  sendMessage: (content: string) => void;
  cancelStream: () => void;
  newChat: () => void;
  setModel: (model: string | null) => void;
  setProvider: (provider: string | null) => void;
  setAgentId: (id: string) => void;
}

export const useChat = create<ChatState>(() => ({
  messages: [],
  isBusy: false,
  error: null,
  sessionId: null,
  connected: false,
  wsStatus: "disconnected" as WsConnectionStatus,
  model: null,
  provider: null,
  agentId: "code_agent",
  retryState: null,

  sendMessage: (content: string) => {
    if (!content.trim()) return;

    const userMsg: ChatMessage = { id: nextId("user"), role: "user", content, timestamp: Date.now() };
    useChat.setState({
      messages: [...useChat.getState().messages, userMsg],
      isBusy: true,
      error: null,
      retryState: null,
    });

    const doSend = (sid: string) => {
      const { model, provider, agentId } = useChat.getState();
      wsClient.sendChat(content, {
        ...(model && { model }),
        ...(provider && { provider }),
        ...(agentId && { agent_id: agentId }),
        session_id: sid,
      });
    };

    const { sessionId } = useChat.getState();
    if (sessionId) {
      doSend(sessionId);
    } else {
      fetch("http://127.0.0.1:18790/api/sessions", { method: "POST" })
        .then((r) => r.json())
        .then((data) => { useChat.setState({ sessionId: data.session_id }); doSend(data.session_id); })
        .catch(() => useChat.setState({ isBusy: false, error: "创建会话失败" }));
    }
  },

  cancelStream: () => {
    wsClient.sendCancel(useChat.getState().sessionId || undefined);
    useChat.setState({ isBusy: false });
  },

  newChat: () => {
    resetStreamingState();
    useChat.setState({ messages: [], isBusy: false, error: null, sessionId: null, retryState: null });
  },

  setModel: (model) => useChat.setState({ model }),
  setProvider: (provider) => useChat.setState({ provider }),
  setAgentId: (id) => useChat.setState({ agentId: id }),
}));

// ─── Selectors ──────────────────────────────────────────────────────

export const useMessageIds = () => useChat(useShallow((s) => s.messages.map((m) => m.id)));
export const useMessageById = (id: string) => useChat((s) => s.messages.find((m) => m.id === id));
export const useIsBusy = () => useChat((s) => s.isBusy);
export const useIsStreaming = () => useChat((s) => s.isBusy);
export const useModel = () => useChat((s) => s.model);
export const useProvider = () => useChat((s) => s.provider);
export const useSessionId = () => useChat((s) => s.sessionId);
export const useAgentId = () => useChat((s) => s.agentId);
export const useWsStatus = () => useChat((s) => s.wsStatus);
export const useStreamingMessageId = () => useChat((s) => s.messages.find((m) => m.streaming)?.id ?? null);
