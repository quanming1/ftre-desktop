/**
 * WebSocket Client — 连接 ftre gateway (ws://127.0.0.1:18790/)
 *
 * 协议：
 *   上行（client → server）: 任意 JSON，后端只看 data 字段
 *   下行（server → client）: { id, type, data: AgentEvent, metadata }
 *
 * AgentEvent.data.type:
 *   message, message_complete, reasoning, tool_call, tool_result,
 *   tool_call_streaming, external_message, done, error, retry, usage_update
 */

// ─── Types ──────────────────────────────────────────────────────────

/** 后端下行消息格式 */
export interface ServerMessage {
  id: string;
  type: string; // "agent_event"
  data: AgentEvent;
  metadata: Record<string, unknown>;
}

/** Agent 事件（嵌套在 ServerMessage.data 中） */
export interface AgentEvent {
  type: string; // EventType enum value
  data: Record<string, unknown>;
}

export type WsConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

type MessageHandler = (msg: ServerMessage) => void;
type ConnectionHandler = () => void;
type StatusHandler = (status: WsConnectionStatus) => void;

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_WS_URL = "ws://127.0.0.1:18790/";
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];

// ─── WebSocket Client ───────────────────────────────────────────────

class WebSocketClient {
  private ws: WebSocket | null = null;
  private _url: string;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  public connected = false;
  public status: WsConnectionStatus = "disconnected";

  /** 当前已 attach 的 session 集合（重连后自动重发 attach） */
  private attachedSessions = new Set<string>();

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

  // ─── Connection ─────────────────────────────────────────────────

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.intentionalClose = false;
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    try {
      this.ws = new WebSocket(this._url);

      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempt = 0;
        this.setStatus("connected");
        // 重连后重新 attach 所有之前关注的 session
        for (const sid of this.attachedSessions) {
          this.send({
            id: crypto.randomUUID().slice(0, 16),
            type: "attach",
            data: { session_id: sid },
          });
        }
        this.connectHandlers.forEach((h) => h());
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerMessage;
          this.messageHandlers.forEach((h) => h(msg));
        } catch (e) {
          console.error("[WS] Failed to parse message:", e);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
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

  // ─── Sending ────────────────────────────────────────────────────

  /** 发送用户消息 */
  send(data: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[WS] Cannot send, not connected");
      return;
    }
    this.ws.send(JSON.stringify(data));
  }

  /** 发送聊天消息。返回所用的帧 id（前端可用作本地占位 userMsg.id 与 echo 去重）。 */
  sendChat(
    content: string,
    metadata?: Record<string, unknown>,
    attachments?: Array<{
      type: "image";
      mime_type: string;
      data: string;
      name?: string;
    }>,
    frameId?: string,
  ): string {
    const data: Record<string, unknown> = {
      content,
      session_id: metadata?.session_id || "",
    };
    if (attachments && attachments.length > 0) {
      data.attachments = attachments;
    }
    const id = frameId || crypto.randomUUID().slice(0, 16);
    this.send({
      id,
      type: "user_input",
      data,
      metadata: metadata || {},
    });
    return id;
  }

  /** 取消当前执行 */
  sendCancel(sessionId?: string): void {
    this.send({
      id: crypto.randomUUID().slice(0, 16),
      type: "cancel",
      data: { session_id: sessionId || "" },
    });
  }

  /** Attach：告诉后端这条 ws 关注指定 session，后续该 session 的 outbound 会推送过来。 */
  attach(sessionId: string): void {
    if (!sessionId) return;
    this.attachedSessions.add(sessionId);
    this.send({
      id: crypto.randomUUID().slice(0, 16),
      type: "attach",
      data: { session_id: sessionId },
    });
  }

  detach(sessionId: string): void {
    if (!sessionId) return;
    this.attachedSessions.delete(sessionId);
    this.send({
      id: crypto.randomUUID().slice(0, 16),
      type: "detach",
      data: { session_id: sessionId },
    });
  }

  // ─── Event Handlers ─────────────────────────────────────────────

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
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
      this.disconnectHandlers = this.disconnectHandlers.filter((h) => h !== handler);
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

  private scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    console.info(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt + 1})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempt++;
      this.connect();
    }, delay);
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export const wsClient = new WebSocketClient();
