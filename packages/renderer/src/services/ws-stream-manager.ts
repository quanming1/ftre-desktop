/**
 * WebSocket Stream Manager (Protocol v4)
 *
 * Manages per-chat message state with support for:
 * - Streaming text via text.delta / text.done
 * - Tool lifecycle via tool.start / tool.delta / tool.done / tool.error
 * - Complete messages via message frame
 * - Turn lifecycle via turn.start / turn.end
 *
 * DESIGN: This module is a pure data layer. It stores session state for ALL chats
 * and emits changes. It does NOT decide which chat is "active" in the UI — that
 * responsibility belongs to the store (chat.ts).
 */

import { wsClient } from "./websocket-client";
import type {
  ServerFrame,
  MediaItem,
  MediaUrl,
  Role,
  ToolCall as ProtocolToolCall,
  TextDeltaData,
  TextDoneData,
  ToolStartData,
  ToolDeltaData,
  ToolDoneData,
  ToolErrorData,
  MessageData,
} from "./ws-protocol";

// ─── Message Types ──────────────────────────────────────────────────

export type { MediaUrl, MediaItem };

export interface ChatMessage {
  id: string;
  role: Role;
  content: string | null;
  timestamp: number;
  streaming?: boolean;
  // Tool calls declared by assistant
  toolCalls?: InlineToolCall[];
  // For tool result messages
  toolCallId?: string;
  name?: string;
  // Media attachments
  media?: string[];
  // Reasoning content (for models that expose chain-of-thought)
  reasoning?: string;
  // Rich media URLs (images, etc.)
  media_urls?: Array<{ url: string; name?: string }>;
  // Interactive buttons (2D array for matrix layout)
  buttons?: string[][];
  button_prompt?: string;
}

/** Tool call embedded in a message */
export interface InlineToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
  // Status tracking (for UI display)
  status?: "pending" | "running" | "ok" | "error";
  result?: string;
}

/** Legacy ToolCall interface for backward compatibility */
export interface ToolCall {
  id: string;
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: "pending" | "running" | "ok" | "error";
  argsBuffer: string;
  result?: unknown;
  error?: string;
  files?: unknown[];
  embeds?: unknown[];
  timestamp: number;
}

export interface ProgressHint {
  id: string;
  text: string;
  timestamp: number;
}

/** Represents a streaming text segment */
interface StreamSegment {
  streamId: string;
  messageId: string;
}

export interface ChatSession {
  chatId: string;
  messages: ChatMessage[];
  toolCalls: ToolCall[]; // Legacy, kept for compatibility
  progress: ProgressHint | null;
  isBusy: boolean; // true between turn.start and turn.end
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

// ─── Stream Manager ─────────────────────────────────────────────────

class WsStreamManager {
  private sessions: Map<string, ChatSession> = new Map();
  private changeHandlers: ChangeHandler[] = [];
  private focusHandlers: FocusHandler[] = [];
  private turnEndHandlers: TurnEndHandler[] = [];

  // The chat_id that the server considers "focused" for this WS connection.
  private serverFocusedChatId: string | null = null;

  // The chat_id that the UI explicitly requested to view.
  private _requestedChatId: string | null = null;

  // True between newChat() and the next session.attached that confirms it.
  private newChatPending = false;

  // Per-chat streaming segments (keyed by stream_id)
  private streamSegments: Map<string, StreamSegment> = new Map();

  constructor() {
    wsClient.onFrame((frame) => this.handleFrame(frame));

    wsClient.onConnect(() => {
      console.info("[StreamManager] WS connected");
    });

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
      session = {
        chatId,
        messages: [],
        toolCalls: [],
        progress: null,
        isBusy: false,
        error: null,
      };
      this.sessions.set(chatId, session);
    }
    return session;
  }

  getActiveSession(): ChatSession | null {
    const id = this._requestedChatId || this.serverFocusedChatId;
    if (!id) return null;
    return this.getSession(id);
  }

  getActiveChatId(): string | null {
    return this._requestedChatId || this.serverFocusedChatId;
  }

  setActiveChatId(chatId: string): void {
    this._requestedChatId = chatId;
  }

  getAllChatIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  // ─── User Actions ───────────────────────────────────────────────

  sendMessage(
    content: string,
    media?: MediaItem[],
    model?: string | null,
    provider?: string | null,
  ): void {
    const chatId =
      this._requestedChatId || this.serverFocusedChatId || wsClient.chatId;
    if (!chatId) {
      console.warn("[StreamManager] No active chat");
      return;
    }

    const session = this.getSession(chatId);
    const messageId = nextId("user");

    // Add user message immediately (optimistic)
    session.messages.push({
      id: messageId,
      role: "user",
      content,
      timestamp: Date.now(),
    });
    session.error = null;
    this.emitChange(session);

    // Send via WebSocket
    wsClient.chatSend(chatId, content, media, model, provider).catch((err) => {
      console.error("[StreamManager] Failed to send message:", err);
      session.error = err.message;
      this.emitChange(session);
    });
  }

  newChat(): void {
    this.newChatPending = true;
    wsClient.sessionNew();
  }

  switchChat(chatId: string): void {
    this._requestedChatId = chatId;
    wsClient.sessionAttach(chatId);
    this.emitFocus(chatId);
    this.emitChange(this.getSession(chatId));
  }

  attachBackground(chatId: string): void {
    wsClient.sessionAttach(chatId);
  }

  loadHistory(chatId: string, messages: ChatMessage[]): void {
    const session = this.getSession(chatId);
    session.messages = messages;
    this.emitChange(session);
  }

  syncHistory(chatId: string, messages: ChatMessage[]): void {
    const session = this.getSession(chatId);
    if (session.messages.length === 0 && messages.length > 0) {
      session.messages = messages;
      this.emitChange(session);
    }
  }

  // ─── Change Subscription ────────────────────────────────────────

  onChange(handler: ChangeHandler): () => void {
    this.changeHandlers.push(handler);
    return () => {
      this.changeHandlers = this.changeHandlers.filter((h) => h !== handler);
    };
  }

  onFocus(handler: FocusHandler): () => void {
    this.focusHandlers.push(handler);
    return () => {
      this.focusHandlers = this.focusHandlers.filter((h) => h !== handler);
    };
  }

  onTurnEnd(handler: TurnEndHandler): () => void {
    this.turnEndHandlers.push(handler);
    return () => {
      this.turnEndHandlers = this.turnEndHandlers.filter((h) => h !== handler);
    };
  }

  // ─── Frame Handling ─────────────────────────────────────────────

  private handleFrame(frame: ServerFrame): void {
    const { type, data } = frame;

    const chatId =
      (data as { chat_id?: string }).chat_id ||
      this._requestedChatId ||
      this.serverFocusedChatId;

    switch (type) {
      // ─── Session control ───
      case "session.ready":
        this.handleSessionReady(data as { chat_id: string; client_id: string });
        break;

      case "session.attached":
        this.handleSessionAttached(data as { chat_id: string });
        break;

      case "session.updated":
        this.handleSessionUpdated(data as { chat_id: string });
        break;

      // ─── Turn lifecycle ───
      case "turn.start":
        this.handleTurnStart(data as { chat_id: string });
        break;

      case "turn.end":
        this.handleTurnEnd(data as { chat_id: string });
        break;

      case "chat.ack":
        // Handled by wsClient internally
        break;

      // ─── v4: Text streaming ───
      case "text.delta":
        this.handleTextDelta(data as TextDeltaData);
        break;

      case "text.done":
        this.handleTextDone(data as TextDoneData);
        break;

      // ─── v4: Tool lifecycle ───
      case "tool.start":
        this.handleToolStart(data as ToolStartData);
        break;

      case "tool.delta":
        this.handleToolDelta(data as ToolDeltaData);
        break;

      case "tool.done":
        this.handleToolDone(data as ToolDoneData);
        break;

      case "tool.error":
        this.handleToolError(data as ToolErrorData);
        break;

      // ─── v4: Complete message ───
      case "message":
        this.handleMessage(data as MessageData);
        break;

      // ─── Error ───
      case "error":
        this.handleError(chatId, data as { detail: string; reason?: string });
        break;

      default:
        console.warn("[StreamManager] Unknown frame type:", type);
    }
  }

  // ─── Session Handlers ───────────────────────────────────────────

  private handleSessionReady(data: {
    chat_id: string;
    client_id: string;
  }): void {
    this.serverFocusedChatId = data.chat_id;

    if (this.newChatPending) {
      this.newChatPending = false;
      this._requestedChatId = data.chat_id;
      this.emitFocus(data.chat_id);
    }

    this.emitChange(this.getSession(data.chat_id));
  }

  private handleSessionAttached(data: { chat_id: string }): void {
    this.serverFocusedChatId = data.chat_id;

    if (this.newChatPending) {
      this.newChatPending = false;
      this._requestedChatId = data.chat_id;
      this.emitFocus(data.chat_id);
    }

    this.emitChange(this.getSession(data.chat_id));
  }

  private handleSessionUpdated(data: { chat_id: string }): void {
    this.emitChange(this.getSession(data.chat_id));
  }

  // ─── Turn Handlers ──────────────────────────────────────────────

  private handleTurnStart(data: { chat_id: string }): void {
    const session = this.getSession(data.chat_id);
    session.isBusy = true;
    session.progress = null;
    session.toolCalls = [];
    this.emitChange(session);
  }

  private handleTurnEnd(data: { chat_id: string }): void {
    const session = this.getSession(data.chat_id);

    // Finalize any open stream segments
    for (const [streamId, segment] of this.streamSegments.entries()) {
      const msgIdx = session.messages.findIndex(
        (m) => m.id === segment.messageId,
      );
      if (msgIdx !== -1) {
        session.messages[msgIdx] = {
          ...session.messages[msgIdx],
          streaming: false,
        };
        this.streamSegments.delete(streamId);
      }
    }

    session.isBusy = false;
    session.progress = null;
    this.emitChange(session);

    // Notify turn end subscribers
    this.turnEndHandlers.forEach((h) => h(data.chat_id));
  }

  // ─── v4 Text Handlers ────────────────────────────────────────────

  /**
   * Handle streaming text delta (v4 protocol).
   * data.content is already accumulated, can render directly.
   */
  private handleTextDelta(data: TextDeltaData): void {
    const session = this.getSession(data.chat_id);

    // Clear progress when content arrives
    if (session.progress) {
      session.progress = null;
    }

    // Find existing message by id
    const existingIdx = session.messages.findIndex(
      (m) => m.id === data.message_id,
    );

    if (existingIdx !== -1) {
      // Update existing message
      session.messages[existingIdx] = {
        ...session.messages[existingIdx],
        content: data.content,
        streaming: true,
      };
    } else {
      // Create new streaming message
      session.messages.push({
        id: data.message_id,
        role: "assistant",
        content: data.content,
        timestamp: Date.now(),
        streaming: true,
      });
    }

    // Track for cleanup
    this.streamSegments.set(data.message_id, {
      streamId: data.message_id,
      messageId: data.message_id,
    });

    this.emitChange(session);
  }

  /**
   * Handle text stream completion (v4 protocol).
   */
  private handleTextDone(data: TextDoneData): void {
    const session = this.getSession(data.chat_id);

    const existingIdx = session.messages.findIndex(
      (m) => m.id === data.message_id,
    );

    if (existingIdx !== -1) {
      session.messages[existingIdx] = {
        ...session.messages[existingIdx],
        content: data.content,
        streaming: false,
        reasoning: this.extractReasoning(data),
      };
    } else {
      // Create complete message if delta was missed
      session.messages.push({
        id: data.message_id,
        role: "assistant",
        content: data.content,
        timestamp: data.timestamp
          ? new Date(data.timestamp).getTime()
          : Date.now(),
        streaming: false,
        reasoning: this.extractReasoning(data),
      });
    }

    // Cleanup stream tracking
    this.streamSegments.delete(data.message_id);

    this.emitChange(session);
  }

  // ─── v4 Tool Handlers ───────────────────────────────────────────

  /**
   * Handle tool start event (v4 protocol).
   */
  private handleToolStart(data: ToolStartData): void {
    const session = this.getSession(data.chat_id);

    const existingIdx = session.toolCalls.findIndex(
      (tc) => tc.call_id === data.call_id,
    );

    if (existingIdx === -1) {
      session.toolCalls.push({
        id: data.call_id,
        call_id: data.call_id,
        name: data.name,
        arguments: {},
        status: "pending",
        argsBuffer: "",
        timestamp: Date.now(),
      });
    } else {
      session.toolCalls[existingIdx].status = "running";
    }

    this.emitChange(session);
  }

  /**
   * Handle tool arguments delta (v4 protocol).
   */
  private handleToolDelta(data: ToolDeltaData): void {
    const session = this.getSession(data.chat_id);

    const existingIdx = session.toolCalls.findIndex(
      (tc) => tc.call_id === data.call_id,
    );

    if (existingIdx !== -1) {
      session.toolCalls[existingIdx].argsBuffer += data.delta;
      session.toolCalls[existingIdx].status = "running";
    } else {
      // Create entry if start was missed
      session.toolCalls.push({
        id: data.call_id,
        call_id: data.call_id,
        name: "unknown",
        arguments: {},
        status: "running",
        argsBuffer: data.delta,
        timestamp: Date.now(),
      });
    }

    this.emitChange(session);
  }

  /**
   * Handle tool completion (v4 protocol).
   * data.arguments is already parsed, no JSON.parse needed.
   */
  private handleToolDone(data: ToolDoneData): void {
    const session = this.getSession(data.chat_id);

    const existingIdx = session.toolCalls.findIndex(
      (tc) => tc.call_id === data.call_id,
    );

    if (existingIdx !== -1) {
      const tc = session.toolCalls[existingIdx];
      tc.status = "ok";
      tc.name = data.name;
      tc.arguments = data.arguments; // Already parsed
      tc.result = data.result;
      tc.files = data.files;
      tc.embeds = data.embeds;
    } else {
      // Create completed entry if start was missed
      session.toolCalls.push({
        id: data.call_id,
        call_id: data.call_id,
        name: data.name,
        arguments: data.arguments,
        status: "ok",
        argsBuffer: "",
        result: data.result,
        files: data.files,
        embeds: data.embeds,
        timestamp: Date.now(),
      });
    }

    this.emitChange(session);
  }

  /**
   * Handle tool error (v4 protocol).
   */
  private handleToolError(data: ToolErrorData): void {
    const session = this.getSession(data.chat_id);

    const existingIdx = session.toolCalls.findIndex(
      (tc) => tc.call_id === data.call_id,
    );

    if (existingIdx !== -1) {
      session.toolCalls[existingIdx].status = "error";
      session.toolCalls[existingIdx].error = data.error;
      if (data.arguments) {
        session.toolCalls[existingIdx].arguments = data.arguments;
      }
    } else {
      // Create error entry if start was missed
      session.toolCalls.push({
        id: data.call_id,
        call_id: data.call_id,
        name: data.name,
        arguments: data.arguments || {},
        status: "error",
        argsBuffer: "",
        error: data.error,
        timestamp: Date.now(),
      });
    }

    this.emitChange(session);
  }

  // ─── v4 Message Handler ─────────────────────────────────────────

  /**
   * Handle complete message (v4 protocol).
   * Used for: history messages, tool results, non-streaming messages.
   */
  private handleMessage(data: MessageData): void {
    const session = this.getSession(data.chat_id);

    // Clear progress
    if (session.progress) {
      session.progress = null;
    }

    // Check for duplicate (same content as last assistant message)
    if (data.role === "assistant") {
      const lastAssistantMsg = [...session.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (lastAssistantMsg && lastAssistantMsg.content === data.content) {
        // Skip duplicate - just ensure streaming is false
        const lastIdx = session.messages.findIndex(
          (m) => m.id === lastAssistantMsg.id,
        );
        if (lastIdx !== -1) {
          session.messages[lastIdx] = {
            ...session.messages[lastIdx],
            streaming: false,
          };
        }
        this.emitChange(session);
        return;
      }
    }

    // Find existing or add new
    const existingIdx = session.messages.findIndex((m) => m.id === data.id);

    const message: ChatMessage = {
      id: data.id,
      role: data.role,
      content: data.content,
      timestamp: data.timestamp
        ? new Date(data.timestamp).getTime()
        : Date.now(),
      streaming: false,
      toolCalls: this.parseToolCalls(data.tool_calls),
      toolCallId: data.tool_call_id,
      name: data.name,
      reasoning: this.extractReasoning(data),
      media_urls: data.media_urls,
    };

    if (existingIdx !== -1) {
      session.messages[existingIdx] = message;
    } else {
      session.messages.push(message);
    }

    this.emitChange(session);
  }

  // ─── Helper Methods ─────────────────────────────────────────────

  private parseToolCalls(
    toolCalls?: ProtocolToolCall[],
  ): InlineToolCall[] | undefined {
    if (!toolCalls || toolCalls.length === 0) return undefined;

    return toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments, // Still JSON string for message.tool_calls
      status: "pending" as const,
    }));
  }

  /**
   * Extract reasoning content from message data.
   * Supports both `reasoning_content` (DeepSeek/Kimi) and `thinking_blocks` (Anthropic).
   */
  private extractReasoning(data: {
    reasoning_content?: string;
    thinking_blocks?: Array<{ type: string; thinking?: string }>;
  }): string | undefined {
    // Direct reasoning content (DeepSeek-R1, Kimi-K2, etc.)
    if (data.reasoning_content) {
      return data.reasoning_content;
    }
    // Anthropic thinking blocks - concatenate thinking text
    if (data.thinking_blocks?.length) {
      const thinking = data.thinking_blocks
        .filter((b) => b.thinking)
        .map((b) => b.thinking)
        .join("\n\n");
      return thinking || undefined;
    }
    return undefined;
  }

  // ─── Error Handler ──────────────────────────────────────────────

  private handleError(
    chatId: string | null,
    data: { detail: string; reason?: string },
  ): void {
    if (!chatId) {
      console.error("[StreamManager] Error without chat_id:", data);
      return;
    }

    const session = this.getSession(chatId);
    session.error = data.reason || data.detail;
    session.isBusy = false;
    this.emitChange(session);
  }

  // ─── Emit Helpers ───────────────────────────────────────────────

  private emitChange(session: ChatSession): void {
    session.messages = [...session.messages];
    session.toolCalls = [...session.toolCalls];
    this.changeHandlers.forEach((h) => h(session));
  }

  private emitFocus(chatId: string): void {
    this.focusHandlers.forEach((h) => h(chatId));
  }

  // ─── Legacy API ─────────────────────────────────────────────────

  get isStreaming(): boolean {
    const session = this.getActiveSession();
    return session?.isBusy ?? false;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export const streamManager = new WsStreamManager();
