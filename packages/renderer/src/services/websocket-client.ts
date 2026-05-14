/**
 * WebSocket Client for ai-base gateway (Protocol v5)
 *
 * Upstream (client → server): { id, type, data }
 * Downstream (server → client): { id, role, data, metadata? }
 */

import {
  type ServerMessage,
  type MediaItem,
  type Frame,
  type ControlData,
  generateFrameId,
  isServerMessage,
} from "./ws-protocol";

export type { ServerMessage, MediaItem };

// ─── Types ──────────────────────────────────────────────────────────

type MessageHandler = (msg: ServerMessage) => void;
export type ConnectionHandler = () => void;
type StatusHandler = (status: WsConnectionStatus) => void;

export type WsConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

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
  private pendingAcks: Map<string, PendingAck> = new Map();

  // State
  public connected = false;
  public status: WsConnectionStatus = "disconnected";
  public chatId: string | null = null;
  public clientId: string | null = null;
  public protocol: string | null = null;

  private lastAttachedChatId: string | null = null;

  // Callbacks
  private messageHandlers: MessageHandler[] = [];
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
      if (this._clientId) params.push(`client_id=${encodeURIComponent(this._clientId)}`);
      if (this._token) params.push(`token=${encodeURIComponent(this._token)}`);
      if (params.length > 0) {
        url += (url.includes("?") ? "&" : "?") + params.join("&");
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
          const msg = JSON.parse(event.data);
          if (isServerMessage(msg)) {
            this.handleMessage(msg);
          } else {
            console.warn("[WS] Invalid message format:", msg);
          }
        } catch (e) {
          console.error("[WS] Failed to parse message:", e);
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

  reconnect(): void {
    this.disconnect();
    this.reconnectAttempt = 0;
    this.connect();
  }

  // ─── Sending (upstream: {id, type, data}) ───────────────────────

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

  sessionNew(): string {
    return this.send("session.new", {});
  }

  sessionAttach(chatId: string): string {
    return this.send("session.attach", { chat_id: chatId });
  }

  chatSend(
    chatId: string,
    text: string,
    media?: MediaItem[],
    model?: string | null,
    provider?: string | null,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Not connected"));
    }

    const data: Record<string, unknown> = { chat_id: chatId, text, webui: true };
    if (media && media.length > 0) data.media = media;
    if (model) data.model = model;
    if (provider) data.provider = provider;

    const frameId = this.send("chat.send", data);

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

  // ─── Event Handlers ─────────────────────────────────────────────

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    };
  }

  /** @deprecated Use onMessage() */
  onFrame(handler: MessageHandler): () => void {
    return this.onMessage(handler);
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
      this.disconnectHandlers = this.disconnectHandlers.filter((h) => h !== handler);
    };
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.push(handler);
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler);
    };
  }

  getLastAttachedChatId(): string | null {
    return this.lastAttachedChatId;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private setStatus(status: WsConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.statusHandlers.forEach((h) => h(status));
    }
  }

  private handleMessage(msg: ServerMessage): void {
    // Handle control messages internally
    if (msg.role === "control") {
      const data = msg.data as ControlData;

      if (data.event === "session.ready") {
        // chat_id is in data for all control messages
        this.chatId = data.chat_id || null;
        this.clientId = data.client_id || null;
        this.protocol = data.protocol || null;
        this.lastAttachedChatId = this.chatId;
      }

      if (data.event === "session.attached") {
        this.chatId = data.chat_id || null;
        this.lastAttachedChatId = this.chatId;
      }

      if (data.event === "chat.ack") {
        const pending = this.pendingAcks.get(data.ref_id || "");
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingAcks.delete(data.ref_id || "");
          pending.resolve();
        }
      }
    }

    // Dispatch to all handlers
    this.messageHandlers.forEach((h) => h(msg));
  }

  private scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    console.info(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt + 1})`);
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
}

// ─── Singleton ──────────────────────────────────────────────────────

export const wsClient = new WebSocketClient();
export type { MessageHandler };
