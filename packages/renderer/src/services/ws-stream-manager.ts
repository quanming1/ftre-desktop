/**
 * WebSocket Stream Manager (Protocol v5)
 *
 * Manages per-chat message state:
 * - Streaming text: assistant.delta → assistant
 * - Tool lifecycle: tool_call.delta → tool_call → tool_result
 * - Control: turn.start / turn.end / session events / errors
 *
 * MESSAGE MODEL:
 * Each "turn" produces: [tool_call, tool_result*, assistant]
 * Tool calls are embedded in the assistant message's `toolCalls` array.
 * The assistant message is the single rendered unit per turn.
 */

import { wsClient } from "./websocket-client";
import type {
  ServerMessage,
  MediaItem,
  MediaUrl,
  AssistantDeltaData,
  AssistantData,
  ToolCallData,
  ToolCallDeltaData,
  ToolResultData,
  ControlData,
} from "./ws-protocol";

// ─── Types ──────────────────────────────────────────────────────────

export type { MediaUrl, MediaItem };
export type Role = "assistant" | "user" | "system" | "tool";

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
  toolCallId?: string;
  name?: string;
  media?: string[];
  reasoning?: string;
  media_urls?: Array<{ url: string; name?: string }>;
  buttons?: string[][];
  button_prompt?: string;
}

export interface ProgressHint {
  id: string;
  text: string;
  timestamp: number;
}

export interface ChatSession {
  chatId: string;
  messages: ChatMessage[];
  progress: ProgressHint | null;
  isBusy: boolean;
  error: string | null;
}

type ChangeHandler = (session: ChatSession) => void;
type FocusHandler = (chatId: string) => void;
type TurnEndHandler = (chatId: string) => void;

// ─── ID Generation ──────────────────────────────────────────────────

let idCounter = 0;
function nextId(prefix = "msg"): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Extract chat_id from a server message (check data first, then metadata) */
function extractChatId(msg: ServerMessage): string | undefined {
  const data = msg.data as Record<string, unknown>;
  if (typeof data.chat_id === "string") return data.chat_id;
  if (msg.metadata && typeof msg.metadata.chat_id === "string") return msg.metadata.chat_id;
  return undefined;
}

/**
 * Strip channel prefix from a session key for WebSocket protocol.
 * "websocket:uuid" → "uuid", "dmwork:xxx" → "xxx", "uuid" → "uuid"
 */
function stripChannelPrefix(id: string): string {
  const colonIndex = id.indexOf(":");
  if (colonIndex !== -1) {
    return id.substring(colonIndex + 1);
  }
  return id;
}

// ─── Stream Manager ─────────────────────────────────────────────────

class WsStreamManager {
  private sessions: Map<string, ChatSession> = new Map();
  private changeHandlers: ChangeHandler[] = [];
  private focusHandlers: FocusHandler[] = [];
  private turnEndHandlers: TurnEndHandler[] = [];

  private serverChatId: string | null = null;
  private _requestedChatId: string | null = null;
  private newChatPending = false;

  /** Tracks accumulated tool args per call_id during streaming */
  private toolArgBuffers: Map<string, string> = new Map();

  constructor() {
    wsClient.onMessage((msg) => this.handleMessage(msg));
    wsClient.onDisconnect(() => {
      for (const session of this.sessions.values()) {
        if (session.isBusy) {
          session.isBusy = false;
          this.emitChange(session);
        }
      }
    });
  }

  // ─── Session Access ─────────────────────────────────────────────

  getSession(chatId: string): ChatSession {
    let session = this.sessions.get(chatId);
    if (!session) {
      session = { chatId, messages: [], progress: null, isBusy: false, error: null };
      this.sessions.set(chatId, session);
    }
    return session;
  }

  getActiveSession(): ChatSession | null {
    const id = this._requestedChatId || this.serverChatId;
    return id ? this.getSession(id) : null;
  }

  getActiveChatId(): string | null {
    return this._requestedChatId || this.serverChatId;
  }

  setActiveChatId(chatId: string | null): void {
    this._requestedChatId = chatId;
  }

  getAllChatIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  // ─── Actions ────────────────────────────────────────────────────

  sendMessage(text: string, media?: MediaItem[], model?: string | null, provider?: string | null): void {
    const chatId = this._requestedChatId || this.serverChatId || "pending";
    const session = this.getSession(chatId);

    session.messages.push({
      id: nextId("user"),
      role: "user",
      content: text,
      timestamp: Date.now(),
    });
    session.isBusy = true;
    session.error = null;
    this.emitChange(session);

    // Backend expects bare chat_id without channel prefix
    const bareChatId = stripChannelPrefix(chatId);
    wsClient.chatSend(bareChatId, text, media, model, provider);
  }

  newChat(): void {
    this.newChatPending = true;
    wsClient.sessionNew();
  }

  switchChat(chatId: string): void {
    this._requestedChatId = chatId;
    // Backend expects bare chat_id (UUID) without channel prefix
    const bareChatId = stripChannelPrefix(chatId);
    wsClient.sessionAttach(bareChatId);
    this.emitFocus(chatId);
  }

  attachBackground(chatId: string): void {
    const bareChatId = stripChannelPrefix(chatId);
    wsClient.sessionAttach(bareChatId);
  }

  loadHistory(chatId: string, messages: ChatMessage[]): void {
    const session = this.getSession(chatId);
    session.messages = messages;
    this.emitChange(session);
  }

  syncHistory(chatId: string, messages: ChatMessage[]): void {
    const session = this.getSession(chatId);
    // Always overwrite with server data (unless session is busy/streaming)
    if (!session.isBusy) {
      session.messages = messages;
      this.emitChange(session);
    }
  }

  // ─── Event Subscriptions ────────────────────────────────────────

  onChange(handler: ChangeHandler): () => void {
    this.changeHandlers.push(handler);
    return () => { this.changeHandlers = this.changeHandlers.filter((h) => h !== handler); };
  }

  onFocus(handler: FocusHandler): () => void {
    this.focusHandlers.push(handler);
    return () => { this.focusHandlers = this.focusHandlers.filter((h) => h !== handler); };
  }

  onTurnEnd(handler: TurnEndHandler): () => void {
    this.turnEndHandlers.push(handler);
    return () => { this.turnEndHandlers = this.turnEndHandlers.filter((h) => h !== handler); };
  }

  // ─── Message Dispatch ───────────────────────────────────────────

  private handleMessage(msg: ServerMessage): void {
    const chatId = extractChatId(msg) || this._requestedChatId || this.serverChatId;

    switch (msg.role) {
      case "control":
        this.onControl(msg.data as ControlData, msg.metadata);
        break;

      case "assistant.delta":
        if (chatId) this.onAssistantDelta(chatId, msg.id, msg.data as AssistantDeltaData);
        break;

      case "assistant":
        if (chatId) this.onAssistant(chatId, msg.id, msg.data as AssistantData);
        break;

      case "tool_call.delta":
        if (chatId) this.onToolCallDelta(chatId, msg.data as ToolCallDeltaData);
        break;

      case "tool_call":
        if (chatId) this.onToolCall(chatId, msg.data as ToolCallData);
        break;

      case "tool_result":
        if (chatId) this.onToolResult(chatId, msg.data as ToolResultData);
        break;

      case "user":
        // Echoed user messages (history sync) — ignore during active session
        break;

      default:
        // system, _metadata, unknown — ignore
        break;
    }
  }

  // ─── Control Events ─────────────────────────────────────────────

  private onControl(data: ControlData, metadata?: Record<string, unknown>): void {
    const chatId = data.chat_id || (metadata as any)?.chat_id;

    switch (data.event) {
      case "session.ready": {
        this.serverChatId = chatId || null;
        if (this.newChatPending && chatId) {
          this.newChatPending = false;
          this._requestedChatId = chatId;
          const session = this.getSession(chatId);
          session.messages = [];
          session.isBusy = false;
          session.error = null;
          this.emitChange(session);
        }
        if (chatId) this.emitFocus(chatId);
        break;
      }

      case "session.attached": {
        if (chatId) {
          this.serverChatId = chatId;
          if (this._requestedChatId !== chatId) {
            this._requestedChatId = chatId;
          }
          this.emitFocus(chatId);
        }
        break;
      }

      case "turn.start": {
        if (chatId) {
          const session = this.getSession(chatId);
          session.isBusy = true;
          session.error = null;
          this.emitChange(session);
        }
        break;
      }

      case "turn.end": {
        if (chatId) {
          const session = this.getSession(chatId);
          // Finalize any streaming messages and pending tool calls
          for (const m of session.messages) {
            if (m.streaming) m.streaming = false;
            // Force-complete any tool calls still in running/pending state
            if (m.toolCalls) {
              for (const tc of m.toolCalls) {
                if (tc.status === "running" || tc.status === "pending") {
                  tc.status = "ok";
                }
              }
            }
          }
          session.isBusy = false;
          session.progress = null;
          // Clear tool arg buffers
          this.toolArgBuffers.clear();
          this.emitChange(session);
          this.turnEndHandlers.forEach((h) => h(chatId));
        }
        break;
      }

      case "error": {
        if (chatId) {
          const session = this.getSession(chatId);
          session.error = data.detail || "Unknown error";
          session.isBusy = false;
          this.emitChange(session);
        }
        break;
      }

      case "session.updated":
      case "chat.ack":
        // Handled by wsClient or ignored
        break;
    }
  }

  // ─── Assistant Streaming ────────────────────────────────────────

  private onAssistantDelta(chatId: string, msgId: string, data: AssistantDeltaData): void {
    const session = this.getSession(chatId);
    if (session.progress) session.progress = null;

    // Find existing message by this exact id
    const idx = session.messages.findIndex((m) => m.id === msgId);

    if (idx !== -1) {
      // Update existing streaming message
      session.messages[idx] = { ...session.messages[idx], content: data.content, streaming: true };
    } else {
      // New message id = new assistant segment
      session.messages.push({
        id: msgId,
        role: "assistant",
        content: data.content,
        timestamp: Date.now(),
        streaming: true,
      });
    }

    this.emitChange(session);
  }

  private onAssistant(chatId: string, msgId: string, data: AssistantData): void {
    const session = this.getSession(chatId);

    // Find existing message by this exact id (from streaming)
    const idx = session.messages.findIndex((m) => m.id === msgId);

    const reasoning = data.reasoning
      || data.thinking_blocks?.filter((b) => b.thinking).map((b) => b.thinking).join("\n\n")
      || undefined;

    if (idx !== -1) {
      const existing = session.messages[idx];
      session.messages[idx] = {
        ...existing,
        content: data.content || existing.content,
        streaming: false,
        reasoning: reasoning || existing.reasoning,
      };
    } else {
      // No matching streaming message — create new (don't merge with previous)
      session.messages.push({
        id: msgId,
        role: "assistant",
        content: data.content,
        timestamp: Date.now(),
        streaming: false,
        reasoning,
      });
    }

    this.emitChange(session);
  }

  // ─── Tool Call Streaming ────────────────────────────────────────

  private onToolCallDelta(chatId: string, data: ToolCallDeltaData): void {
    const session = this.getSession(chatId);
    if (session.progress) session.progress = null;

    // Accumulate args
    const buf = this.toolArgBuffers.get(data.call_id) || "";
    this.toolArgBuffers.set(data.call_id, buf + data.delta);

    // Find or create assistant message for this turn
    const msg = this.getOrCreateTurnAssistant(session);
    if (!msg.toolCalls) msg.toolCalls = [];

    const existing = msg.toolCalls.find((tc) => tc.id === data.call_id);
    if (existing) {
      if (data.name) existing.name = data.name;
      existing.arguments = this.toolArgBuffers.get(data.call_id) || "";
    } else {
      msg.toolCalls.push({
        id: data.call_id,
        name: data.name || "unknown",
        arguments: data.delta,
        status: "running",
      });
    }

    msg.streaming = true;
    // Replace message reference to trigger React re-render
    const idx = session.messages.indexOf(msg);
    if (idx !== -1) {
      session.messages[idx] = { ...msg, toolCalls: [...msg.toolCalls] };
    }
    this.emitChange(session);
  }

  private onToolCall(chatId: string, data: ToolCallData): void {
    const session = this.getSession(chatId);
    const msg = this.getOrCreateTurnAssistant(session);
    if (!msg.toolCalls) msg.toolCalls = [];

    for (const call of data.calls) {
      const existing = msg.toolCalls.find((tc) => tc.id === call.call_id);
      const argsStr = typeof call.arguments === "object"
        ? JSON.stringify(call.arguments)
        : String(call.arguments || "{}");

      if (existing) {
        existing.name = call.name || existing.name;
        existing.arguments = argsStr;
        existing.status = "running";
      } else {
        msg.toolCalls.push({
          id: call.call_id,
          name: call.name || "unknown",
          arguments: argsStr,
          status: "running",
        });
      }

      // Clear the arg buffer since we have final args
      this.toolArgBuffers.delete(call.call_id);
    }

    // Replace message reference to trigger React re-render
    const idx = session.messages.indexOf(msg);
    if (idx !== -1) {
      session.messages[idx] = { ...msg, toolCalls: [...msg.toolCalls] };
    }
    this.emitChange(session);
  }

  private onToolResult(chatId: string, data: ToolResultData): void {
    const session = this.getSession(chatId);
    const isError = !!data.error;
    const resultContent = isError
      ? data.error!
      : typeof data.output === "string"
        ? data.output
        : data.output != null
          ? JSON.stringify(data.output)
          : "";

    // Find the tool call across all messages and update with new reference
    let found = false;
    for (let i = 0; i < session.messages.length; i++) {
      const m = session.messages[i];
      if (m.role === "assistant" && m.toolCalls) {
        const tcIdx = m.toolCalls.findIndex((t) => t.id === data.call_id);
        if (tcIdx !== -1) {
          const updatedToolCalls = [...m.toolCalls];
          updatedToolCalls[tcIdx] = {
            ...updatedToolCalls[tcIdx],
            status: isError ? "error" : "ok",
            result: resultContent,
            name: data.name || updatedToolCalls[tcIdx].name,
          };
          session.messages[i] = { ...m, toolCalls: updatedToolCalls };
          found = true;
          break;
        }
      }
    }

    if (!found) {
      // Create entry in current turn's assistant message
      const msg = this.getOrCreateTurnAssistant(session);
      if (!msg.toolCalls) msg.toolCalls = [];
      msg.toolCalls.push({
        id: data.call_id,
        name: data.name,
        arguments: "",
        status: isError ? "error" : "ok",
        result: resultContent,
      });
      const idx = session.messages.indexOf(msg);
      if (idx !== -1) {
        session.messages[idx] = { ...msg, toolCalls: [...msg.toolCalls] };
      }
    }

    this.emitChange(session);
  }

  // ─── Helpers ────────────────────────────────────────────────────

  /**
   * Find or create an assistant message to attach tool calls to.
   * Only reuses a message that has NO content (pure tool placeholder).
   * If the last assistant has content (text), create a new one for tools.
   */
  private getOrCreateTurnAssistant(session: ChatSession): ChatMessage {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i];
      if (m.role === "user") break;
      if (m.role === "assistant") {
        // Only reuse if it has no text content (pure tool-only message)
        if (!m.content) {
          return m;
        }
        // Has content — don't mix tools into it
        break;
      }
    }

    // Create new assistant message for tool calls
    const msg: ChatMessage = {
      id: nextId("ast"),
      role: "assistant",
      content: null,
      timestamp: Date.now(),
      streaming: true,
      toolCalls: [],
    };
    session.messages.push(msg);
    return msg;
  }

  private emitChange(session: ChatSession): void {
    this.changeHandlers.forEach((h) => h(session));
  }

  private emitFocus(chatId: string): void {
    this.focusHandlers.forEach((h) => h(chatId));
  }

  // ─── Public Getters ─────────────────────────────────────────────

  get isStreaming(): boolean {
    return this.getActiveSession()?.isBusy ?? false;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export const streamManager = new WsStreamManager();
