/**
 * WebSocket Client for ai-base gateway (Protocol v2)
 *
 * Uniform envelope: every frame is { id, type, data }
 * - Upstream: session.new, session.attach, chat.send
 * - Downstream: 13 event types (see ws-protocol.ts)
 */

import {
  type Frame,
  type ServerFrame,
  type MediaItem,
  generateFrameId,
  isServerFrame,
} from "./ws-protocol";

// Re-export for convenience
export type { MediaItem } from "./ws-protocol";

// ─── Types ──────────────────────────────────────────────────────────

type FrameHandler = (frame: ServerFrame) => void;
export type ConnectionHandler = () => void;
type StatusHandler = (status: WsConnectionStatus) => void;

export type WsConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

/** Pending ack tracker */
interface PendingAck {
  frameId: string;
  chatId: string;
  resolve: () => void;
  reject: (reason: string) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_WS_URL = `ws://${window.location.hostname || "127.0.0.1"}:18790/`;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];
const ACK_TIMEOUT_MS = 30000;

// ─── WebSocket Client ───────────────────────────────────────────────

class WebSocketClient {
  private ws: WebSocket | null = null;
  private _url: string;
  private _token: string | null = null;
  private _clientId: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  // Pending acks for chat.send frames
  private pendingAcks: Map<string, PendingAck> = new Map();

  // State
  public connected = false;
  public status: WsConnectionStatus = "disconnected";
  public chatId: string | null = null;
  public clientId: string | null = null;
  public protocol: string | null = null;

  // Last chat_id we were attached to (for reconnect)
  private lastAttachedChatId: string | null = null;

  // Callbacks
  private frameHandlers: FrameHandler[] = [];
  private connectHandlers: ConnectionHandler[] = [];
  private disconnectHandlers: ConnectionHandler[] = [];
  private statusHandlers: StatusHandler[] = [];

  constructor(url?: string) {
    this._url = url || DEFAULT_WS_URL;
  }

  get url(): string {
    return this._url;
  }

  setUrl(url: string): void {
    const changed = this._url !== url;
    this._url = url;
    if (changed && this.connected) {
      this.disconnect();
      this.connect();
    }
  }

  setToken(token: string | null): void {
    this._token = token;
  }

  setClientId(clientId: string | null): void {
    this._clientId = clientId;
  }

  // ─── Connection ─────────────────────────────────────────────────

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.intentionalClose = false;
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    try {
      let url = this._url;
      const params: string[] = [];
      if (this._clientId) {
        params.push(`client_id=${encodeURIComponent(this._clientId)}`);
      }
      if (this._token) {
        params.push(`token=${encodeURIComponent(this._token)}`);
      }
      if (params.length > 0) {
        const separator = url.includes("?") ? "&" : "?";
        url = `${url}${separator}${params.join("&")}`;
      }

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempt = 0;
        this.setStatus("connected");
        this.connectHandlers.forEach((h) => h());
      };

      this.ws.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data);
          if (isServerFrame(frame)) {
            this.handleFrame(frame);
          } else {
            console.warn("[WS] Invalid frame format:", frame);
          }
        } catch (e) {
          console.error("[WS] Failed to parse frame:", e);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.rejectAllPendingAcks("Connection closed");
        this.disconnectHandlers.forEach((h) => h());
        if (!this.intentionalClose) {
          this.setStatus("reconnecting");
          this.scheduleReconnect();
        } else {
          this.setStatus("disconnected");
        }
      };

      this.ws.onerror = (e) => {
        console.error("[WS] Error:", e);
      };
    } catch (e) {
      console.error("[WS] Connect failed:", e);
      this.setStatus("reconnecting");
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectAllPendingAcks("Disconnected");
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.setStatus("disconnected");
  }

  /** Manual reconnect — resets attempt counter and connects immediately */
  reconnect(): void {
    this.disconnect();
    this.reconnectAttempt = 0;
    this.connect();
  }

  // ─── Frame Sending ──────────────────────────────────────────────

  /**
   * Send a raw frame to the server.
   * All frames must have { id, type, data } shape.
   */
  send<T extends string>(type: T, data: Record<string, unknown>): string {
    const frameId = generateFrameId();
    const frame: Frame<T> = { id: frameId, type, data };

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[WS] Cannot send, not connected");
      return frameId;
    }

    this.ws.send(JSON.stringify(frame));
    return frameId;
  }

  /**
   * Create a new chat session.
   * Server responds with session.attached containing the new chat_id.
   */
  sessionNew(): string {
    return this.send("session.new", {});
  }

  /**
   * Attach to an existing chat session.
   * Server responds with session.attached.
   */
  sessionAttach(chatId: string): string {
    return this.send("session.attach", { chat_id: chatId });
  }

  /**
   * Send a chat message.
   * Returns a promise that resolves when chat.ack is received.
   */
  chatSend(chatId: string, text: string, media?: MediaItem[]): Promise<void> {
    // Fail fast if not connected
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Not connected"));
    }

    const data: Record<string, unknown> = {
      chat_id: chatId,
      text,
      webui: true,
    };
    if (media && media.length > 0) {
      data.media = media;
    }

    const frameId = this.send("chat.send", data);

    // Track pending ack
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAcks.delete(frameId);
        reject(new Error("Ack timeout"));
      }, ACK_TIMEOUT_MS);

      this.pendingAcks.set(frameId, {
        frameId,
        chatId,
        resolve,
        reject: (reason) => reject(new Error(reason)),
        timeout,
      });
    });
  }

  // ─── Legacy API (for backward compatibility) ────────────────────

  /** @deprecated Use sessionNew() instead */
  newChat(): void {
    this.sessionNew();
  }

  /** @deprecated Use sessionAttach() instead */
  attachChat(chatId: string): void {
    this.sessionAttach(chatId);
  }

  /** @deprecated Use chatSend() instead */
  sendMessage(chatId: string, content: string, media?: MediaItem[]): void {
    this.chatSend(chatId, content, media).catch((err) => {
      console.error("[WS] Send message failed:", err);
    });
  }

  // ─── Event Handlers ─────────────────────────────────────────────

  onFrame(handler: FrameHandler): () => void {
    this.frameHandlers.push(handler);
    return () => {
      this.frameHandlers = this.frameHandlers.filter((h) => h !== handler);
    };
  }

  /** @deprecated Use onFrame() instead */
  onMessage(handler: (data: any) => void): () => void {
    // Wrap to provide backward-compatible format
    const wrappedHandler: FrameHandler = (frame) => {
      // Convert to legacy format for compatibility
      handler({
        event: frame.type
          .replace(".", "_")
          .replace("session_", "")
          .replace("chat_", ""),
        ...frame.data,
      });
    };
    this.frameHandlers.push(wrappedHandler);
    return () => {
      this.frameHandlers = this.frameHandlers.filter(
        (h) => h !== wrappedHandler,
      );
    };
  }

  onConnect(handler: ConnectionHandler): () => void {
    this.connectHandlers.push(handler);
    return () => {
      this.connectHandlers = this.connectHandlers.filter((h) => h !== handler);
    };
  }

  onDisconnect(handler: ConnectionHandler): () => void {
    this.disconnectHandlers.push(handler);
    return () => {
      this.disconnectHandlers = this.disconnectHandlers.filter(
        (h) => h !== handler,
      );
    };
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.push(handler);
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler);
    };
  }

  // ─── Internal ───────────────────────────────────────────────────

  private setStatus(status: WsConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.statusHandlers.forEach((h) => h(status));
    }
  }

  private handleFrame(frame: ServerFrame): void {
    const { type, data } = frame;

    // Handle session.ready
    if (type === "session.ready") {
      const d = data as {
        chat_id: string;
        client_id: string;
        protocol: string;
      };
      this.chatId = d.chat_id;
      this.clientId = d.client_id;
      this.protocol = d.protocol;
      this.lastAttachedChatId = d.chat_id;

      // If we had a different chat attached before disconnect, re-attach
      // (handled by stream manager via session.ready event)
    }

    // Handle session.attached
    if (type === "session.attached") {
      const d = data as { chat_id: string };
      this.chatId = d.chat_id;
      this.lastAttachedChatId = d.chat_id;
    }

    // Handle chat.ack - resolve pending promise
    if (type === "chat.ack") {
      const d = data as { ref_id: string };
      const pending = this.pendingAcks.get(d.ref_id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingAcks.delete(d.ref_id);
        pending.resolve();
      }
    }

    // Dispatch to all handlers
    this.frameHandlers.forEach((h) => h(frame));
  }

  private scheduleReconnect(): void {
    const delay =
      RECONNECT_DELAYS[
      Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)
      ];
    console.info(
      `[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt + 1})`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempt++;
      this.connect();
    }, delay);
  }

  private rejectAllPendingAcks(reason: string): void {
    for (const pending of this.pendingAcks.values()) {
      clearTimeout(pending.timeout);
      pending.reject(reason);
    }
    this.pendingAcks.clear();
  }

  /** Get last attached chat ID for reconnect purposes */
  getLastAttachedChatId(): string | null {
    return this.lastAttachedChatId;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export const wsClient = new WebSocketClient();

// Legacy exports for backward compatibility
export type MessageHandler = (data: any) => void;
