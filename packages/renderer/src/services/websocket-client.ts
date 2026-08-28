/**
 * WebSocket Client — 连接 ftre gateway
 *
 * F12 wire contract：
 *   上行：session.prompt/session.cancel/session.updateQueue，payload 携带业务数据，
 *   request_id 是唯一传输相关性标识；attach/detach 也使用 payload。
 *   下行：业务帧使用 {type, payload, metadata}；Inbox 操作成功直接返回
 *   session/queue 快照，错误使用统一 RPC envelope。
 *
 * Agent events follow ftre-agent's flat AgentStreamEvent protocol; Host
 * pipeline/maintenance events use the session_event topic:
 *   REPLY_*, MODEL_CALL_*, TEXT_BLOCK_*, THINKING_BLOCK_*,
 *   TOOL_CALL_*, TOOL_RESULT_*, HINT_BLOCK, retry.
 */

// ─── Types ──────────────────────────────────────────────────────────

/** 后端 F12 下行消息格式；队列操作成功帧也保留 type/payload。 */
import { wsLogCollector } from "./ws-log-collector";

export interface ServerMessage<TPayload = unknown> {
  type?: string;
  payload?: TPayload;
  metadata?: Record<string, unknown>;
  request_id?: string;
  ok?: boolean;
  value?: unknown;
  error?: Record<string, unknown>;
}

/** Gateway 在 attach/重连时返回的 SessionProjection 快照。 */
export const CompactEventName = {
  START: "context_compact_start",
  DONE: "context_compact_done",
  FAILED: "context_compact_failed",
} as const;

export const UserMessageEventType = "USER_MESSAGE" as const;

export type CompactEventName =
  (typeof CompactEventName)[keyof typeof CompactEventName];

export interface ReplySnapshotItem {
  reply_id: string;
  /** 当前 AssistantMsg 的稳定 id；同一 reply 可有多个。 */
  message_id: string;
  revision: number;
  /** 后端持久化的原始 Msg，由渲染层转换为 ChatMessage。 */
  message: Record<string, unknown>;
}

export interface ReplySnapshotPayload {
  session_id: string;
  replies: ReplySnapshotItem[];
  /** 仅客户端使用的 WebSocket 连接世代，用于建立新的 revision 比较区间。 */
  client_connection_epoch?: number;
  /** Projection 中仅驻内存的 Agent 与 Host typed event。 */
  events?: Array<AgentStreamEvent | SessionHostEvent>;
}

export interface QueueItemView {
  request_id: string;
  sequence: number;
  /** 服务端队列语义：普通排队、下一轮 steer，或插件上下文注入。 */
  placement?: QueueSnapshotItem["placement"];
  content?: string;
  attachments?: Array<Record<string, unknown>>;
  source?: string;
  /** 仅在客户端尚未收到服务端 queue response 时为 true；快照会替换它。 */
  optimistic?: boolean;
}

/** ftre-inbox 的权威 session/queue payload。 */
export interface QueueSnapshotItem {
  id: string;
  placement: "queued" | "steering" | "context";
  message: {
    content: Array<{ type: "text"; text: string }>;
    attachments?: Array<Record<string, unknown>>;
  };
}

export interface QueueSnapshotPayload {
  session_id: string;
  /** Inbox 持久化 revision；客户端据此丢弃乱序的旧快照。 */
  revision: number;
  items: QueueSnapshotItem[];
}

export type QueueUpdateAction =
  | { kind: "remove" }
  | { kind: "edit"; content: string; attachments?: Array<Record<string, unknown>> }
  | { kind: "steer" };

export interface RpcErrorPayload {
  request_id?: string;
  code: string;
  message: string;
  session_id?: string;
  retryable?: boolean;
}

export function getRpcErrorPayload(message: ServerMessage): RpcErrorPayload | null {
  if (message.ok !== false) return null;
  const error = asRecord(message.error);
  if (!error || typeof error.code !== "string" || typeof error.message !== "string") {
    return null;
  }
  return {
    request_id: message.request_id,
    code: error.code,
    message: error.message,
    session_id: typeof error.session_id === "string" ? error.session_id : undefined,
    retryable: typeof error.retryable === "boolean" ? error.retryable : undefined,
  };
}

export type ReplySnapshotMessage = ServerMessage<ReplySnapshotPayload> & {
  type: "reply_snapshot";
};

export function isReplySnapshotMessage(
  message: ServerMessage<any>,
): message is ReplySnapshotMessage {
  return message.type === "reply_snapshot"
    && typeof (message.payload as ReplySnapshotPayload)?.session_id === "string"
    && Array.isArray((message.payload as ReplySnapshotPayload)?.replies)
    && (message.payload as ReplySnapshotPayload).replies.every((reply) => (
      typeof reply?.reply_id === "string"
      && typeof reply?.message_id === "string"
      && Number.isFinite(reply?.revision)
      && !!reply?.message
    ));
}

export type SessionActivity =
  | "idle"
  | "dispatching"
  | "executing"
  | "cancelling"
  | "compacting"
  | "paused"
  | "blocked"
  | "closing";

/** 后端 session/status 的状态通知。 */
export interface SessionStatusPayload {
  type?: "session_status";
  session_id: string;
  status: "idle" | "running" | "compacting" | "blocked";
  revision?: number;
}

/** 后端 command_message 仅用于向客户端展示命令处理结果。 */
export interface SessionCommandPayload {
  type?: "command_message";
  session_id?: string;
  content: string;
  level?: "info" | "warning" | "error";
}

export interface SessionContextWarningPayload {
  type?: "context_warning";
  session_id: string;
  code: string;
  message: string;
}

export type SessionEventPayload =
  | QueueSnapshotPayload;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function routeSessionId(message: ServerMessage<any>): string | null {
  const sessionId = message.metadata?.session_id;
  return typeof sessionId === "string" && sessionId && sessionId !== "*"
    ? sessionId
    : null;
}

function sessionRouteMatches(
  message: ServerMessage<any>,
  payloadSessionId: string,
): boolean {
  const routedSessionId = routeSessionId(message);
  return !routedSessionId || routedSessionId === payloadSessionId;
}

function isSessionStatus(value: unknown): value is SessionStatusPayload["status"] {
  return value === "idle"
    || value === "running"
    || value === "compacting"
    || value === "blocked";
}

export function isQueueSnapshotPayload(
  value: unknown,
): value is QueueSnapshotPayload {
  const raw = asRecord(value);
  return !!raw
    && typeof raw.session_id === "string"
    && Number.isFinite(raw.revision)
    && Array.isArray(raw.items)
    && raw.items.every((item) => {
      const record = asRecord(item);
      return !!record
        && typeof record.id === "string"
        && (record.placement === "queued"
          || record.placement === "steering"
          || record.placement === "context")
        && !!asRecord(record.message);
    });
}

export function getSessionEventPayload(
  message: ServerMessage<any>,
): SessionEventPayload | null {
  const raw = message.payload;
  if (!raw) return null;

  // 新协议：session/queue 的 payload 是 Inbox 权威快照。
  if (message.type === "session/queue") {
    return isQueueSnapshotPayload(raw)
      && sessionRouteMatches(message, raw.session_id)
      ? raw
      : null;
  }

  return null;
}

export function getSessionStatusPayload(
  message: ServerMessage<any>,
): SessionStatusPayload | null {
  const raw = asRecord(message.payload);
  if (!raw) return null;
  return message.type === "session/status"
    && typeof raw.session_id === "string"
    && isSessionStatus(raw.status)
    && sessionRouteMatches(message, raw.session_id)
    ? raw as unknown as SessionStatusPayload
    : null;
}

export function getSessionCommandPayload(
  message: ServerMessage<any>,
): SessionCommandPayload | null {
  const raw = asRecord(message.payload);
  if (!raw) return null;
  return message.type === "session_event:command_message"
    && typeof raw.content === "string"
    && (!raw.session_id
      || (typeof raw.session_id === "string" && sessionRouteMatches(message, raw.session_id)))
    ? raw as unknown as SessionCommandPayload
    : null;
}

export function getSessionContextWarningPayload(
  message: ServerMessage<any>,
): SessionContextWarningPayload | null {
  const raw = asRecord(message.payload);
  if (!raw) return null;
  return message.type === "session_event:context_warning"
    && typeof raw.session_id === "string"
    && typeof raw.message === "string"
    && sessionRouteMatches(message, raw.session_id)
    ? raw as unknown as SessionContextWarningPayload
    : null;
}

/** Agent 事件（嵌套在 ServerMessage.payload 中） */
export interface AgentStreamEvent {
  type: string;
  id?: string;
  created_at?: string;
  reply_id?: string;
  /** MessageList 中具体 Assistant 气泡的稳定坐标。 */
  message_id?: string;
  metadata?: Record<string, unknown>;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/** SessionEventService 产生的 Host 维护事件；不属于 Agent 回复流。 */
export interface SessionHostEvent {
  type: "PIPELINE_EVENT" | "SESSION_MAINTENANCE";
  id?: string;
  created_at?: string;
  session_id?: string;
  reply_id?: string;
  name?: string;
  phase?: string;
  value?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export type WsConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

type MessageHandler = (msg: ServerMessage) => void;
type ConnectionHandler = () => void;
type StatusHandler = (status: WsConnectionStatus) => void;

interface PendingSend {
  frame: Record<string, unknown>;
}

interface PendingControlWaiter {
  resolve: (value: QueueSnapshotPayload) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type TransportSendResult =
  | { ok: true; queued: boolean }
  | { ok: false; reason: "outbox_full" | "send_failed" };

export type ChatTransportSendResult = TransportSendResult & {
  requestId: string;
};

// ─── Constants ──────────────────────────────────────────────────────

export const DEFAULT_WS_URL = (import.meta.env.VITE_WS_URL as string) || "ws://127.0.0.1:48650/";
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];
const MAX_PENDING_SENDS = 100;

export function normalizeGatewayUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

// ─── WebSocket Client ───────────────────────────────────────────────

class WebSocketClient {
  private ws: WebSocket | null = null;
  private _url: string;
  private reconnectAttempt = 0;
  private connectionEpoch = 0;
  /** 每次底层连接的审计标识，避免重连前后的帧混在一起。 */
  private connectionId = "";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private pendingSends: PendingSend[] = [];
  /** 聊天帧保留在这里，直到 Gateway 确认已经可靠写入持久化 Inbox。 */
  private unackedChats = new Map<string, Record<string, unknown>>();
  /** 取消帧使用相同幂等键重试，直到服务端确认取消动作已经应用。 */
  private unackedControls = new Map<string, Record<string, unknown>>();
  /** 需要等待 session/queue 响应的队列控制操作（remove/edit/steer）。 */
  private controlWaiters = new Map<string, PendingControlWaiter>();
  /** stableTimer: delay-reset reconnectAttempt to avoid fast reconnect loop */
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly STABLE_THRESHOLD = 5000;

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
    const nextUrl = normalizeGatewayUrl(url);
    const changed = this._url !== nextUrl;
    this._url = nextUrl;
    if (changed && this.connected) {
      this.disconnect();
      this.connect();
    }
  }

  // ─── Connection ─────────────────────────────────────────────────

  connect(): void {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return; // OPEN or CONNECTING → 不重连
    this.intentionalClose = false;
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    try {
      this.connectionId = crypto.randomUUID();
      this.ws = new WebSocket(this._url);

      this.ws.onopen = () => {
        wsLogCollector.recordSystem(
          "open",
          JSON.stringify({ url: this._url }),
          { connectionId: this.connectionId },
        );
        this.connectionEpoch += 1;
        this.connected = true;
        this.setStatus("connected");
        if (this.stableTimer) clearTimeout(this.stableTimer);
        this.stableTimer = setTimeout(() => {
          this.reconnectAttempt = 0;
          this.stableTimer = null;
        }, WebSocketClient.STABLE_THRESHOLD);
        // 重连后重新 attach 所有之前关注的 session
        for (const sid of this.attachedSessions) {
          this.sendWire({
            type: "attach",
            payload: { session_id: sid },
          }, "reconnect_replay");
        }
        this.flushPendingSends();
        this.flushUnackedChats();
        this.flushUnackedControls();
        this.connectHandlers.forEach((h) => h());
      };

      this.ws.onmessage = (event) => {
        const raw = typeof event.data === "string" ? event.data : String(event.data);
        wsLogCollector.record("in", raw, { connectionId: this.connectionId });
        try {
          const msg = JSON.parse(raw) as ServerMessage;
          if (
            msg.type === "reply_snapshot"
            && msg.payload
            && typeof msg.payload === "object"
          ) {
            (msg.payload as Record<string, unknown>).client_connection_epoch =
              this.connectionEpoch;
          }
          this.consumeQueueOperationResponse(msg);
          this.messageHandlers.forEach((h) => h(msg));
        } catch (e) {
          wsLogCollector.recordSystem("parse_error", raw, { connectionId: this.connectionId });
          console.error("[WS] Failed to parse message:", e);
        }
      };

      this.ws.onclose = () => {
        wsLogCollector.recordSystem(
          "close",
          JSON.stringify({ intentional: this.intentionalClose }),
          { connectionId: this.connectionId },
        );
        this.connected = false;
        if (this.stableTimer) {
          clearTimeout(this.stableTimer);
          this.stableTimer = null;
        }
        this.disconnectHandlers.forEach((h) => h());
        if (!this.intentionalClose) {
          this.setStatus("reconnecting");
          this.scheduleReconnect();
        } else {
          this.setStatus("disconnected");
        }
      };

      this.ws.onerror = (e) => {
        wsLogCollector.recordSystem("error", JSON.stringify({ message: String(e) }), {
          connectionId: this.connectionId,
        });
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
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
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
  send(data: Record<string, unknown>): TransportSendResult {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.pendingSends.length >= MAX_PENDING_SENDS) {
        console.error("[WS] Outbox full; send rejected", { type: data.type });
        return { ok: false, reason: "outbox_full" };
      }
      this.pendingSends.push({ frame: data });
      console.warn("[WS] Queued send, not connected", { type: data.type });
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.connect();
      }
      return { ok: true, queued: true };
    }
    try {
      this.sendWire(data, "initial");
      return { ok: true, queued: false };
    } catch (error) {
      if (this.pendingSends.length >= MAX_PENDING_SENDS) {
        console.error("[WS] Send failed and outbox is full", error);
        return { ok: false, reason: "outbox_full" };
      }
      // 保留原始帧供下次重连重发；WebSocket.send 尚未成功返回前，绝不从
      // 本地 outbox 删除该条目。
      this.pendingSends.push({ frame: data });
      console.error("[WS] Send failed; retained in outbox", error);
      return { ok: true, queued: true };
    }
  }

  /** 发送聊天消息，返回 transport 接受结果和稳定 client id。
   *  content: 纯文本 string（Inbound 协议只承载纯文本；结构化 part 是 Msg 存储层形态） */
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
  ): ChatTransportSendResult {
    const payload: Record<string, unknown> = {
      content,
      session_id: metadata?.session_id || "",
      mode: "queue",
    };
    if (attachments && attachments.length > 0) {
      payload.attachments = attachments;
    }
    const id = frameId || crypto.randomUUID().slice(0, 16);
    const frame = {
      request_id: id,
      type: "session.prompt",
      payload,
      metadata: { ...(metadata || {}) },
    };
    if (!this.unackedChats.has(id) && this.unackedChats.size >= MAX_PENDING_SENDS) {
      console.error("[WS] Durable chat outbox full; send rejected", { requestId: id });
      return { ok: false, reason: "outbox_full", requestId: id };
    }
    this.unackedChats.set(id, frame);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) this.connect();
      return { ok: true, queued: true, requestId: id };
    }
    try {
      this.sendWire(frame, "initial");
      // WebSocket.send 只表示本地写入成功，不等于服务端已经接纳。必须等
      // session/queue 操作响应或明确错误确认 Inbox 已处理后才移除 outbox。
      return { ok: true, queued: false, requestId: id };
    } catch (error) {
      console.error("[WS] Chat send failed; retained until queue response", error);
      return { ok: true, queued: true, requestId: id };
    }
  }

  /** 发送不进入聊天历史的工具确认控制指令。 */
  sendToolConfirmation(
    sessionId: string,
    toolCallIds: string | string[],
    approved: boolean,
  ): void {
    const ids = (Array.isArray(toolCallIds) ? toolCallIds : [toolCallIds])
      .filter(Boolean);
    if (!sessionId || ids.length === 0) return;
    this.send({
      request_id: crypto.randomUUID().slice(0, 16),
      type: "session.prompt",
      payload: {
        session_id: sessionId,
        mode: "queue",
        content: `${approved ? "/allow" : "/deny"} ${ids.join(" ")}`,
      },
    });
  }

  /** 取消当前执行：发送独立控制帧，不进入用户消息队列。 */
  sendCancel(sessionId?: string, expectedRequestId?: string): void {
    const requestId = crypto.randomUUID().slice(0, 16);
    const frame = {
      request_id: requestId,
      type: "session.cancel",
      payload: {
        session_id: sessionId || "",
        // 后端控制面按 request_id 精确取消，避免误取消同一会话中的其他排队请求。
        ...(expectedRequestId ? { expected_request_id: expectedRequestId } : {}),
      },
    };
    if (this.unackedControls.size >= MAX_PENDING_SENDS) {
      console.error("[WS] Control outbox full; cancellation rejected locally");
      return;
    }
    this.unackedControls.set(requestId, frame);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) this.connect();
      return;
    }
    try {
      this.sendWire(frame, "initial");
    } catch (error) {
      console.error("[WS] Cancel send failed; retained until control response", error);
    }
  }

  /** 通过 F12 WebSocket 控制面更新 Inbox 队列，并返回最新权威快照。 */
  updateQueue(
    sessionId: string,
    itemId: string,
    action: QueueUpdateAction,
  ): Promise<QueueSnapshotPayload> {
    if (!sessionId || !itemId) {
      return Promise.reject(new Error("队列操作缺少 session_id 或 item_id"));
    }
    if (this.unackedControls.size >= MAX_PENDING_SENDS) {
      return Promise.reject(new Error("队列操作暂存已满，请稍后重试"));
    }

    const requestId = crypto.randomUUID().slice(0, 16);
    const frame = {
      request_id: requestId,
      type: "session.updateQueue",
      payload: {
        session_id: sessionId,
        item_id: itemId,
        action,
      },
    };

    return new Promise<QueueSnapshotPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.controlWaiters.delete(requestId);
        this.unackedControls.delete(requestId);
        reject(new Error("队列操作超时，请重试"));
      }, 15_000);
      this.controlWaiters.set(requestId, { resolve, reject, timer });
      this.unackedControls.set(requestId, frame);

      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.connect();
        return;
      }
      try {
        this.sendWire(frame, "initial");
      } catch {
        // 保留在 unackedControls，待连接建立或重连后统一重发。
      }
    });
  }

  /** 将普通排队消息提升为下一轮注入消息；结果仍以后端 queue 快照为准。 */
  promoteQueueItemToSteer(sessionId: string, itemId: string): Promise<QueueSnapshotPayload> {
    return this.updateQueue(sessionId, itemId, { kind: "steer" });
  }

  /** Attach：告诉后端这条 ws 关注指定 session，后续该 session 的 outbound 会推送过来。 */
  attach(sessionId: string): void {
    if (!sessionId) return;
    this.attachedSessions.add(sessionId);
    this.send({
      type: "attach",
      payload: { session_id: sessionId },
    });
  }

  detach(sessionId: string): void {
    if (!sessionId) return;
    this.attachedSessions.delete(sessionId);
    this.send({
      type: "detach",
      payload: { session_id: sessionId },
    });
  }

  subscribeOnly(sessionId: string | null): void {
    for (const sid of [...this.attachedSessions]) {
      if (sid !== sessionId) this.detach(sid);
    }
    if (sessionId) this.attach(sessionId);
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

  private flushPendingSends(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.pendingSends.length > 0) {
      const pending = this.pendingSends[0];
      try {
        this.sendWire(pending.frame, "outbox_flush");
      } catch (error) {
        console.error("[WS] Failed to flush outbox; frame retained", error);
        return;
      }
      this.pendingSends.shift();
    }
  }

  private flushUnackedChats(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const frame of this.unackedChats.values()) {
      try {
        this.sendWire(frame, "reconnect_replay");
      } catch (error) {
        console.error("[WS] Failed to resend unacknowledged chat; retained", error);
        return;
      }
    }
  }

  private flushUnackedControls(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const frame of this.unackedControls.values()) {
      try {
        this.sendWire(frame, "reconnect_replay");
      } catch (error) {
        console.error("[WS] Failed to resend control frame; retained", error);
        return;
      }
    }
  }

  /** 统一的底层发送出口：先真正写入 WebSocket，再记录原始帧。 */
  private sendWire(
    frame: Record<string, unknown>,
    attempt: "initial" | "outbox_flush" | "reconnect_replay",
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    const raw = JSON.stringify(frame);
    this.ws.send(raw);
    wsLogCollector.record("out", raw, {
      attempt,
      connectionId: this.connectionId,
    });
  }

  private consumeQueueOperationResponse(message: ServerMessage): void {
    if (message.type === "session/queue" && message.ok === true
      && typeof message.request_id === "string"
      && getSessionEventPayload(message)) {
      // 同一个 queue response 同时结算聊天 outbox、队列控制 waiter 和队列投影；
      // 不再维护一套独立的 Message ACK 协议。
      this.unackedChats.delete(message.request_id);
      this.unackedControls.delete(message.request_id);
      this.settleControlWaiter(message);
      return;
    }
    // session.cancel 仍使用控制面 ACK；它不改变 Inbox items，所以不需要
    // 伪造一个 queue snapshot。
    if (message.ok === true && typeof message.request_id === "string") {
      this.unackedControls.delete(message.request_id);
    }
    const error = getRpcErrorPayload(message);
    if (error?.request_id) {
      this.unackedChats.delete(error.request_id);
      this.unackedControls.delete(error.request_id);
      this.settleControlWaiter(message);
    }
  }

  private settleControlWaiter(message: ServerMessage): void {
    if (typeof message.request_id !== "string") return;
    const waiter = this.controlWaiters.get(message.request_id);
    if (!waiter) return;

    clearTimeout(waiter.timer);
    this.controlWaiters.delete(message.request_id);
    const error = getRpcErrorPayload(message);
    if (error?.request_id) {
      this.unackedControls.delete(error.request_id);
    }
    if (error) {
      waiter.reject(new Error(error.message));
      return;
    }
    const payload = getSessionEventPayload(message);
    if (message.type === "session/queue" && message.ok === true && payload) {
      waiter.resolve(payload);
      return;
    }
    waiter.reject(new Error("队列操作返回了无效快照"));
  }

}

// ─── Singleton ──────────────────────────────────────────────────────

export const wsClient = new WebSocketClient();
