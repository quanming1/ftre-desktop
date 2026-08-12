/**
 * WebSocket Client — 连接 ftre gateway
 *
 * 协议：
 *   上行（client → server）: { frame_id, type: "user_message", data, metadata }
 *   下行（server → client）: { frame_id, type, data: AgentStreamEvent, metadata }
 *
 * Agent events follow ftre-agent-core's flat AgentStreamEvent protocol:
 *   REPLY_*, MODEL_CALL_*, TEXT_BLOCK_*, THINKING_BLOCK_*,
 *   TOOL_CALL_*, TOOL_RESULT_*, DATA_BLOCK_*, HINT_BLOCK, retry, CUSTOM.
 */

// ─── Types ──────────────────────────────────────────────────────────

/** 后端下行消息格式 */
import { wsLogCollector } from "./ws-log-collector";

export interface ServerMessage<TData = AgentStreamEvent> {
  frame_id: string;
  type: string;
  data: TData;
  metadata: Record<string, unknown>;
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
  revision: number;
  /** 后端持久化的原始 Msg，由渲染层转换为 ChatMessage。 */
  message: Record<string, unknown>;
}

export interface ReplySnapshotPayload {
  session_id: string;
  replies: ReplySnapshotItem[];
  /** 仅客户端使用的 WebSocket 连接世代，用于建立新的 revision 比较区间。 */
  client_connection_epoch?: number;
  /** Projection 中仅驻内存的 session 级 active Event。 */
  events?: AgentStreamEvent[];
  /** attach/重连时恢复的 SessionLane 权威 Mailbox 快照。 */
  mailbox?: MailboxSnapshotPayload;
}

/** 后端 SessionLane 对外公布的运行阶段。 */
export type MailboxPhase =
  | "idle"
  | "running"
  | "cancelling"
  | "compacting"
  | "blocked";

export interface MailboxItemPayload {
  request_id: string;
  sequence: number;
  content?: string;
  attachments?: Array<Record<string, unknown>>;
  source?: string;
  /** 仅在客户端尚未收到服务端 ACK 时为 true；下一张 mailbox 快照会替换它。 */
  optimistic?: boolean;
}

/** session_event:mailbox_snapshot 的扁平 data Payload。 */
export interface MailboxSnapshotPayload {
  type?: "mailbox_snapshot";
  session_id: string;
  revision: number;
  phase: MailboxPhase;
  pending: MailboxItemPayload[];
  capacity: number;
  accepting_messages: boolean;
  can_cancel_active: boolean;
  blocked_reason?: string | null;
}

/** user_message 被 AgentLoop 耐久接纳后的即时确认。 */
export interface MessageAckPayload {
  session_id: string;
  request_id: string;
  queue_position: number;
  created: boolean;
}

export function getMessageAckPayload(
  message: ServerMessage<any>,
): MessageAckPayload | null {
  const raw = asRecord(message.data);
  if (message.type !== "message_ack" || !raw) return null;
  if (
    typeof raw.session_id !== "string"
    || typeof raw.request_id !== "string"
    || typeof raw.queue_position !== "number"
    || typeof raw.created !== "boolean"
  ) return null;
  return raw as unknown as MessageAckPayload;
}

export type ReplySnapshotMessage = ServerMessage<ReplySnapshotPayload> & {
  type: "reply_snapshot";
};

export function isReplySnapshotMessage(
  message: ServerMessage<any>,
): message is ReplySnapshotMessage {
  return message.type === "reply_snapshot"
    && typeof (message.data as unknown as ReplySnapshotPayload)?.session_id === "string"
    && Array.isArray((message.data as unknown as ReplySnapshotPayload)?.replies);
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

/** 后端 global_event:session_status 的状态通知。 */
export interface SessionStatusPayload {
  type?: "session_status";
  session_id: string;
  status: "idle" | "running" | "compacting";
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
  | MailboxSnapshotPayload;

export type SessionEventMessage = ServerMessage<SessionEventPayload> & {
  type: "session_event:mailbox_snapshot";
};

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

function isSessionActivity(value: unknown): value is SessionActivity {
  return value === "idle"
    || value === "dispatching"
    || value === "executing"
    || value === "cancelling"
    || value === "compacting"
    || value === "paused"
    || value === "blocked"
    || value === "closing";
}

function isSessionStatus(value: unknown): value is SessionStatusPayload["status"] {
  return value === "idle" || value === "running" || value === "compacting";
}

function isMailboxPhase(value: unknown): value is MailboxPhase {
  return value === "idle"
    || value === "running"
    || value === "cancelling"
    || value === "compacting"
    || value === "blocked";
}

/** Mailbox phase 映射为客户端现有的展示状态。 */
function mailboxPhaseToActivity(phase: MailboxPhase): SessionActivity {
  switch (phase) {
    case "running": return "executing";
    default: return phase;
  }
}

export function mailboxToSessionState(
  snapshot: MailboxSnapshotPayload,
): {
  session_id: string;
  revision: number;
  activity: SessionActivity;
  queue: { depth: number; capacity: number };
  client_can_send: boolean;
  can_cancel: boolean;
  blocked_reason: string | null;
} {
  const activity = mailboxPhaseToActivity(snapshot.phase);
  return {
    session_id: snapshot.session_id,
    revision: snapshot.revision,
    activity,
    queue: {
      depth: snapshot.pending.length,
      capacity: snapshot.capacity,
    },
    client_can_send: snapshot.accepting_messages,
    can_cancel: snapshot.can_cancel_active,
    blocked_reason: snapshot.blocked_reason ?? null,
  };
}

export function isMailboxSnapshotPayload(
  value: unknown,
): value is MailboxSnapshotPayload {
  const raw = asRecord(value);
  return !!raw
    && typeof raw.session_id === "string"
    && Number.isFinite(Number(raw.revision))
    && isMailboxPhase(raw.phase)
    && Array.isArray(raw.pending)
    && typeof raw.accepting_messages === "boolean"
    && typeof raw.can_cancel_active === "boolean";
}

export function getSessionEventPayload(
  message: ServerMessage<any>,
): SessionEventPayload | null {
  const raw = asRecord(message.data);
  if (!raw) return null;

  // 新协议：Topic 已经包含事件类型，Payload 直接平铺在 data 中。
  if (message.type === "session_event:mailbox_snapshot") {
    return isMailboxSnapshotPayload(raw)
      && sessionRouteMatches(message, raw.session_id)
      ? { ...raw, type: "mailbox_snapshot" } as MailboxSnapshotPayload
      : null;
  }

  return null;
}

export function isSessionEventMessage(
  message: ServerMessage<any>,
): message is SessionEventMessage {
  return getSessionEventPayload(message) !== null;
}

export function getSessionStatusPayload(
  message: ServerMessage<any>,
): SessionStatusPayload | null {
  const raw = asRecord(message.data);
  if (!raw) return null;
  return message.type === "global_event:session_status"
    && typeof raw.session_id === "string"
    && isSessionStatus(raw.status)
    && sessionRouteMatches(message, raw.session_id)
    ? raw as unknown as SessionStatusPayload
    : null;
}

export function getSessionCommandPayload(
  message: ServerMessage<any>,
): SessionCommandPayload | null {
  const raw = asRecord(message.data);
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
  const raw = asRecord(message.data);
  if (!raw) return null;
  return message.type === "session_event:context_warning"
    && typeof raw.session_id === "string"
    && typeof raw.message === "string"
    && sessionRouteMatches(message, raw.session_id)
    ? raw as unknown as SessionContextWarningPayload
    : null;
}

/** Agent 事件（嵌套在 ServerMessage.data 中） */
export interface AgentStreamEvent {
  type: string;
  id?: string;
  created_at?: string;
  reply_id?: string;
  metadata?: Record<string, unknown>;
  data?: Record<string, unknown>;
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
            frame_id: crypto.randomUUID().slice(0, 16),
            type: "attach",
            data: { session_id: sid },
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
            && msg.data
            && typeof msg.data === "object"
          ) {
            (msg.data as Record<string, unknown>).client_connection_epoch =
              this.connectionEpoch;
          }
          this.consumeDurableAdmissionAck(msg);
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
    const data: Record<string, unknown> = {
      content,
      session_id: metadata?.session_id || "",
    };
    if (attachments && attachments.length > 0) {
      data.attachments = attachments;
    }
    const id = frameId || crypto.randomUUID().slice(0, 16);
    const frame = {
      frame_id: id,
      type: "user_message",
      data,
      metadata: { ...(metadata || {}) },
    };
    if (!this.unackedChats.has(id) && this.unackedChats.size >= MAX_PENDING_SENDS) {
      console.error("[WS] Durable chat outbox full; send rejected", { frameId: id });
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
      // message_ack 或重连快照确认 state.json 已落盘后才能移除 outbox。
      return { ok: true, queued: false, requestId: id };
    } catch (error) {
      console.error("[WS] Chat send failed; retained until durable ACK", error);
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
      frame_id: crypto.randomUUID().slice(0, 16),
      type: "user_message",
      data: {
        session_id: sessionId,
        content: `${approved ? "/allow" : "/deny"} ${ids.join(" ")}`,
      },
    });
  }

  /** 取消当前执行：发送独立控制帧，不进入用户消息队列。 */
  sendCancel(sessionId?: string, expectedRequestId?: string): void {
    const frameId = crypto.randomUUID().slice(0, 16);
    const frame = {
      frame_id: frameId,
      type: "cancel",
      data: {
        session_id: sessionId || "",
        scope: "active",
        // 后端控制面按 request_id 精确取消，避免误取消同一会话中的其他排队请求。
        ...(expectedRequestId ? { expected_request_id: expectedRequestId } : {}),
      },
    };
    if (this.unackedControls.size >= MAX_PENDING_SENDS) {
      console.error("[WS] Control outbox full; cancellation rejected locally");
      return;
    }
    this.unackedControls.set(frameId, frame);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) this.connect();
      return;
    }
    try {
      this.sendWire(frame, "initial");
    } catch (error) {
      console.error("[WS] Cancel send failed; retained until control ACK", error);
    }
  }

  /** Attach：告诉后端这条 ws 关注指定 session，后续该 session 的 outbound 会推送过来。 */
  attach(sessionId: string): void {
    if (!sessionId) return;
    this.attachedSessions.add(sessionId);
    this.send({
      frame_id: crypto.randomUUID().slice(0, 16),
      type: "attach",
      data: { session_id: sessionId },
    });
  }

  detach(sessionId: string): void {
    if (!sessionId) return;
    this.attachedSessions.delete(sessionId);
    this.send({
      frame_id: crypto.randomUUID().slice(0, 16),
      type: "detach",
      data: { session_id: sessionId },
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
        console.error("[WS] Failed to resend cancellation; retained", error);
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

  private consumeDurableAdmissionAck(message: ServerMessage): void {
    const acknowledge = (value: unknown) => {
      if (typeof value === "string" && value) this.unackedChats.delete(value);
    };

    // message_ack 表示消息已经写入后端持久化 Inbox；只有收到它才能移除本地重试 outbox。
    const admissionAck = getMessageAckPayload(message);
    if (admissionAck) {
      acknowledge(admissionAck.request_id);
      // ACK 外层 frame_id 是传输幂等键；request_id 是 mailbox 的业务键。
      acknowledge(message.frame_id);
    }

    if (message.type === "reply_snapshot" && message.data && typeof message.data === "object") {
      const snapshot = message.data as unknown as ReplySnapshotPayload;
      for (const item of snapshot.mailbox?.pending || []) {
        acknowledge(item.request_id);
      }
    }

    if (message.type === "agent_event") {
      acknowledge(message.metadata?.request_id);
      const event = message.data as unknown as AgentStreamEvent;
      if (event?.type === UserMessageEventType) {
        acknowledge(event.metadata?.request_id);
        acknowledge(event.data?.request_id);
      }
    }

    if (message.type === "error" && message.data && typeof message.data === "object") {
      const requestId = (message.data as Record<string, unknown>).request_id;
      acknowledge(requestId);
      if (typeof requestId === "string" && requestId) {
        this.unackedControls.delete(requestId);
      }
    }

    if (message.type === "control_ack" && message.data && typeof message.data === "object") {
      const requestId = (message.data as Record<string, unknown>).request_id;
      if (typeof requestId === "string" && requestId) {
        this.unackedControls.delete(requestId);
      }
    }
  }

}

// ─── Singleton ──────────────────────────────────────────────────────

export const wsClient = new WebSocketClient();
