/**
 * WebSocket Stream Manager (Protocol v2)
 *
 * Manages per-chat message state with support for:
 * - Streaming text via chat.delta / chat.delta_end
 * - Tool calls via chat.tool_use / chat.tool_result (paired by call_id)
 * - Progress hints via chat.progress
 * - Turn lifecycle via turn.start / turn.end
 *
 * DESIGN: This module is a pure data layer. It stores session state for ALL chats
 * and emits changes. It does NOT decide which chat is "active" in the UI — that
 * responsibility belongs to the store (chat.ts). The only `activeChatId` here is
 * used as a fallback for frames that don't carry a chat_id, and to track the
 * server-side "focused" session for the WebSocket connection.
 */

import { wsClient } from "./websocket-client";
import type { ServerFrame, MediaItem, MediaUrl, Role } from "./ws-protocol";

// ─── Message Types ──────────────────────────────────────────────────

export type { MediaUrl, MediaItem };

export interface ChatMessage {
  id: string;
  role: Role | "user";
  content: string;
  timestamp: number;
  streaming?: boolean;
  // Rich content
  media_urls?: MediaUrl[];
  buttons?: string[][];
  button_prompt?: string;
  reply_to?: string;
}

export interface ToolCall {
  id: string;
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** "pending" = phase:start received, args still streaming
   *  "running" = phase:ready received, tool executing
   *  "ok" | "error" = result received */
  status: "pending" | "running" | "ok" | "error";
  /** Raw accumulated args JSON string, built from tool_args_delta frames */
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
  buffer: string;
}

export interface ChatSession {
  chatId: string;
  messages: ChatMessage[];
  toolCalls: ToolCall[];
  progress: ProgressHint | null;
  isBusy: boolean; // true between turn.start and turn.end
  error: string | null;
}

type ChangeHandler = (session: ChatSession) => void;

/**
 * Fired when the server assigns/confirms a "focused" chat for this connection.
 * The UI store should use this to know which chat to display.
 */
type FocusHandler = (chatId: string) => void;

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

  // The chat_id that the server considers "focused" for this WS connection.
  // Used only as fallback for frames without chat_id.
  private serverFocusedChatId: string | null = null;

  // The chat_id that the UI explicitly requested to view.
  // Set by switchChat() — this is the source of truth for "what the user wants to see".
  private _requestedChatId: string | null = null;

  // True between newChat() and the next session.attached that confirms it.
  // Lets us identify which session.attached response corresponds to a chat we just created.
  private newChatPending = false;

  // Per-chat streaming segments (keyed by stream_id)
  private streamSegments: Map<string, StreamSegment> = new Map();

  constructor() {
    // Subscribe to frames
    wsClient.onFrame((frame) => this.handleFrame(frame));

    wsClient.onConnect(() => {
      console.info("[StreamManager] WS connected");
    });

    wsClient.onDisconnect(() => {
      // Mark all sessions as not busy on disconnect
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

  /**
   * Returns the chat ID that the UI has explicitly requested.
   * This is the single source of truth for "which chat is displayed".
   */
  getActiveChatId(): string | null {
    return this._requestedChatId || this.serverFocusedChatId;
  }

  /** @deprecated Use getActiveChatId() — kept for backward compat */
  setActiveChatId(chatId: string): void {
    this._requestedChatId = chatId;
  }

  getAllChatIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  // ─── User Actions ───────────────────────────────────────────────

  sendMessage(content: string, media?: MediaItem[]): void {
    const chatId = this._requestedChatId || this.serverFocusedChatId || wsClient.chatId;
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
    wsClient.chatSend(chatId, content, media).catch((err) => {
      console.error("[StreamManager] Failed to send message:", err);
      session.error = err.message;
      this.emitChange(session);
    });
  }

  newChat(): void {
    // Mark that a new chat was requested. The next session.attached/ready
    // response that doesn't match any known session is the server's confirmation.
    this.newChatPending = true;
    wsClient.sessionNew();
  }

  /**
   * Switch the UI to a different chat.
   * Sets _requestedChatId immediately (optimistic) and sends session.attach.
   * The server will respond with session.attached, but we don't wait for it.
   */
  switchChat(chatId: string): void {
    this._requestedChatId = chatId;
    wsClient.sessionAttach(chatId);
    this.emitFocus(chatId);
    this.emitChange(this.getSession(chatId));
  }

  /**
   * Attach to a chat on the server WITHOUT changing the UI focus.
   * Used for background operations like preloading history for tabs.
   */
  attachBackground(chatId: string): void {
    wsClient.sessionAttach(chatId);
  }

  loadHistory(chatId: string, messages: ChatMessage[]): void {
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

  /**
   * Subscribe to focus changes (when the active chat should change).
   * Fired on: session.ready, explicit switchChat(), session.new response.
   */
  onFocus(handler: FocusHandler): () => void {
    this.focusHandlers.push(handler);
    return () => {
      this.focusHandlers = this.focusHandlers.filter((h) => h !== handler);
    };
  }

  // ─── Frame Handling ─────────────────────────────────────────────

  private handleFrame(frame: ServerFrame): void {
    const { type, data } = frame;

    // Extract chat_id from data (most frames have it)
    const chatId =
      (data as { chat_id?: string }).chat_id ||
      this._requestedChatId ||
      this.serverFocusedChatId;

    // Dispatch by frame type
    switch (type) {
      case "session.ready":
        this.handleSessionReady(data as { chat_id: string; client_id: string });
        break;

      case "session.attached":
        this.handleSessionAttached(data as { chat_id: string });
        break;

      case "session.updated":
        this.handleSessionUpdated(data as { chat_id: string });
        break;

      case "turn.start":
        this.handleTurnStart(data as { chat_id: string });
        break;

      case "turn.end":
        this.handleTurnEnd(data as { chat_id: string });
        break;

      case "chat.ack":
        // Ack is handled by wsClient internally
        break;

      case "chat.message":
        this.handleChatMessage(
          data as {
            chat_id: string;
            role: Role;
            text: string;
            media_urls?: MediaUrl[];
            buttons?: string[][];
            button_prompt?: string;
            reply_to?: string;
          },
        );
        break;

      case "chat.delta":
        this.handleChatDelta(
          data as {
            chat_id: string;
            role: Role;
            text: string;
            stream_id: string;
          },
        );
        break;

      case "chat.delta_end":
        this.handleChatDeltaEnd(
          data as {
            chat_id: string;
            stream_id: string;
          },
        );
        break;

      case "chat.progress":
        this.handleChatProgress(data as { chat_id: string; text: string });
        break;

      case "chat.tool_use":
        this.handleToolUse(
          data as {
            chat_id: string;
            call_id: string;
            name: string;
            phase: "start" | "ready";
            arguments?: Record<string, unknown>;
          },
        );
        break;

      case "chat.tool_args_delta":
        this.handleToolArgsDelta(
          data as {
            chat_id: string;
            call_id: string;
            delta: string;
          },
        );
        break;

      case "chat.tool_result":
        this.handleToolResult(
          data as {
            chat_id: string;
            call_id: string;
            name: string;
            status: "ok" | "error";
            result?: unknown;
            error?: string;
            files?: unknown[];
            embeds?: unknown[];
          },
        );
        break;

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

    if (!this._requestedChatId) {
      // First connection or after newChat() — adopt server's assignment
      this._requestedChatId = data.chat_id;
      this.emitFocus(data.chat_id);
    } else if (this._requestedChatId !== data.chat_id) {
      // Reconnect scenario: user was viewing a different chat.
      // Re-attach to the user's chat so the server knows our intent.
      wsClient.sessionAttach(this._requestedChatId);
    }

    this.emitChange(this.getSession(data.chat_id));
  }

  private handleSessionAttached(data: { chat_id: string }): void {
    // Update server-side focus tracking
    this.serverFocusedChatId = data.chat_id;

    // If we just called newChat(), this attached response confirms the new chat — adopt it
    if (this.newChatPending) {
      this.newChatPending = false;
      this._requestedChatId = data.chat_id;
      this.emitFocus(data.chat_id);
    }
    // Otherwise, late responses from background attaches are ignored for focus

    this.emitChange(this.getSession(data.chat_id));
  }

  private handleSessionUpdated(data: { chat_id: string }): void {
    // Session metadata changed (e.g., title) — just emit to trigger refresh
    this.emitChange(this.getSession(data.chat_id));
  }

  // ─── Turn Handlers ──────────────────────────────────────────────

  private handleTurnStart(data: { chat_id: string }): void {
    const session = this.getSession(data.chat_id);
    session.isBusy = true;
    session.progress = null;
    session.toolCalls = []; // Clear tool calls for new turn
    this.emitChange(session);
  }

  private handleTurnEnd(data: { chat_id: string }): void {
    const session = this.getSession(data.chat_id);

    // Finalize any open stream segments that belong to THIS session
    for (const [streamId, segment] of this.streamSegments.entries()) {
      const msgIdx = session.messages.findIndex(
        (m) => m.id === segment.messageId,
      );
      // Only clean up segments whose message lives in this session
      if (msgIdx === -1) continue;

      session.messages[msgIdx] = {
        ...session.messages[msgIdx],
        content: segment.buffer,
        streaming: false,
      };
      this.streamSegments.delete(streamId);
    }

    session.isBusy = false;
    session.progress = null;
    this.emitChange(session);
  }

  // ─── Chat Content Handlers ──────────────────────────────────────

  private handleChatMessage(data: {
    chat_id: string;
    role: Role;
    text: string;
    media_urls?: MediaUrl[];
    buttons?: string[][];
    button_prompt?: string;
    reply_to?: string;
  }): void {
    const session = this.getSession(data.chat_id);
    session.messages.push({
      id: nextId("msg"),
      role: data.role,
      content: data.text,
      timestamp: Date.now(),
      media_urls: data.media_urls,
      buttons: data.buttons,
      button_prompt: data.button_prompt,
      reply_to: data.reply_to,
    });
    this.emitChange(session);
  }

  private handleChatDelta(data: {
    chat_id: string;
    role: Role;
    text: string;
    stream_id: string;
  }): void {
    const session = this.getSession(data.chat_id);
    let segment = this.streamSegments.get(data.stream_id);

    if (!segment) {
      // Start new streaming message
      const messageId = nextId("stream");
      segment = {
        streamId: data.stream_id,
        messageId,
        buffer: "",
      };
      this.streamSegments.set(data.stream_id, segment);

      session.messages.push({
        id: messageId,
        role: data.role,
        content: "",
        timestamp: Date.now(),
        streaming: true,
      });
    }

    // Clear progress when streaming starts
    if (session.progress) {
      session.progress = null;
    }

    // Append text
    segment.buffer += data.text;

    // Update message content
    const msgIdx = session.messages.findIndex(
      (m) => m.id === segment!.messageId,
    );
    if (msgIdx !== -1) {
      session.messages[msgIdx] = {
        ...session.messages[msgIdx],
        content: segment.buffer,
      };
    }

    this.emitChange(session);
  }

  private handleChatDeltaEnd(data: {
    chat_id: string;
    stream_id: string;
  }): void {
    const session = this.getSession(data.chat_id);
    const segment = this.streamSegments.get(data.stream_id);

    if (segment) {
      const msgIdx = session.messages.findIndex(
        (m) => m.id === segment.messageId,
      );
      if (msgIdx !== -1) {
        session.messages[msgIdx] = {
          ...session.messages[msgIdx],
          content: segment.buffer,
          streaming: false,
        };
      }
      this.streamSegments.delete(data.stream_id);
    }

    this.emitChange(session);
  }

  private handleChatProgress(data: { chat_id: string; text: string }): void {
    const session = this.getSession(data.chat_id);
    session.progress = {
      id: nextId("progress"),
      text: data.text,
      timestamp: Date.now(),
    };
    this.emitChange(session);
  }

  // ─── Tool Call Handlers ─────────────────────────────────────────

  private handleToolUse(data: {
    chat_id: string;
    call_id: string;
    name: string;
    phase: "start" | "ready";
    arguments?: Record<string, unknown>;
  }): void {
    const session = this.getSession(data.chat_id);
    const existingIdx = session.toolCalls.findIndex(
      (t) => t.call_id === data.call_id,
    );

    if (data.phase === "start") {
      // LLM just announced the call — args are still streaming in via tool_args_delta
      if (existingIdx !== -1) return; // shouldn't happen, but be safe
      session.toolCalls.push({
        id: nextId("tool"),
        call_id: data.call_id,
        name: data.name,
        arguments: {},
        argsBuffer: "",
        status: "pending",
        timestamp: Date.now(),
      });
    } else {
      // phase === "ready": args are complete, tool is about to execute
      if (existingIdx !== -1) {
        session.toolCalls[existingIdx] = {
          ...session.toolCalls[existingIdx],
          arguments: data.arguments ?? {},
          status: "running",
        };
      } else {
        // ready arrived without a prior start (e.g. reconnect) — create directly
        session.toolCalls.push({
          id: nextId("tool"),
          call_id: data.call_id,
          name: data.name,
          arguments: data.arguments ?? {},
          argsBuffer: "",
          status: "running",
          timestamp: Date.now(),
        });
      }
    }

    this.emitChange(session);
  }

  private handleToolArgsDelta(data: {
    chat_id: string;
    call_id: string;
    delta: string;
  }): void {
    const session = this.getSession(data.chat_id);
    const idx = session.toolCalls.findIndex((t) => t.call_id === data.call_id);
    if (idx === -1) return;

    session.toolCalls[idx] = {
      ...session.toolCalls[idx],
      argsBuffer: session.toolCalls[idx].argsBuffer + data.delta,
    };

    this.emitChange(session);
  }

  private handleToolResult(data: {
    chat_id: string;
    call_id: string;
    name: string;
    status: "ok" | "error";
    result?: unknown;
    error?: string;
    files?: unknown[];
    embeds?: unknown[];
  }): void {
    const session = this.getSession(data.chat_id);
    const toolIdx = session.toolCalls.findIndex(
      (t) => t.call_id === data.call_id,
    );

    if (toolIdx !== -1) {
      session.toolCalls[toolIdx] = {
        ...session.toolCalls[toolIdx],
        status: data.status,
        result: data.result,
        error: data.error,
        files: data.files,
        embeds: data.embeds,
      };
    } else {
      // Result arrived before tool_use (e.g. reconnect mid-turn)
      session.toolCalls.push({
        id: nextId("tool"),
        call_id: data.call_id,
        name: data.name,
        arguments: {},
        argsBuffer: "",
        status: data.status,
        result: data.result,
        error: data.error,
        files: data.files,
        embeds: data.embeds,
        timestamp: Date.now(),
      });
    }

    this.emitChange(session);
  }

  // ─── Error Handler ──────────────────────────────────────────────

  private handleError(
    chatId: string | null,
    data: { detail: string; reason?: string },
  ): void {
    console.error("[StreamManager] Server error:", data.detail, data.reason);

    if (chatId) {
      const session = this.getSession(chatId);
      session.error = data.reason
        ? `${data.detail}: ${data.reason}`
        : data.detail;
      session.isBusy = false;
      this.emitChange(session);
    }
  }

  // ─── Change Emission ────────────────────────────────────────────

  private emitChange(session: ChatSession): void {
    // Create new references to trigger React updates
    session.messages = [...session.messages];
    session.toolCalls = [...session.toolCalls];
    this.changeHandlers.forEach((h) => h(session));
  }

  private emitFocus(chatId: string): void {
    this.focusHandlers.forEach((h) => h(chatId));
  }

  // ─── Legacy API (for compatibility with old code) ───────────────

  /** @deprecated Use isBusy instead */
  get isStreaming(): boolean {
    const session = this.getActiveSession();
    return session?.isBusy ?? false;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export const streamManager = new WsStreamManager();
