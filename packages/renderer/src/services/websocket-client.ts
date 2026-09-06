/**
 * WebSocket Client — 连接 ftre gateway（v4 事件日志 wire 协议）。
 *
 * 上行帧不变（F12 冻结）：attach / detach / session.prompt / session.cancel /
 * session.updateQueue，payload 携带业务数据，request_id 是唯一传输相关性标识。
 *
 * 下行帧信封（PRD-F41 §4.4）：{v: 1, session_id, type, payload}，6 种：
 *   session/event        事件透传（payload.event 为完整事件信封，含 seq）
 *   session/subscribed   attach 基线 {last_seq, status}
 *   session/queue        Inbox 权威队列快照（last-wins，含 revision）
 *   session/projection   派生状态快照 {key, value, seq}
 *   session/maintenance  非日志文本反馈 {name, value}
 *   rpc                  上行结算 {request_id, ok, value?, error?}
 *
 * 本文件只负责连接生命周期、outbox 重试与 rpc 结算；事件的 fold 与状态机
 * 在 stores/chatProjection.ts（经由 stores/chat.ts 路由）。
 */

// ─── Types ──────────────────────────────────────────────────────────

import { wsLogCollector } from "./ws-log-collector";
import type {
  DownstreamFrameType,
  RpcPayload,
  WireFrame,
} from "@/types/wire.gen";

export type { RpcPayload, WireFrame, DownstreamFrameType };

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

export type SessionActivity =
  | "idle"
  | "dispatching"
  | "executing"
  | "cancelling"
  | "compacting"
  | "paused"
  | "blocked"
  | "closing";

export type WsConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

// ─── 帧解析与校验 ───────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

/**
 * 解析下行帧信封：{v:1, session_id, type, payload}。
 * 信封非法返回 null（未知 type 由消费端按 FR6 忽略）。
 */
export function parseDownstreamFrame(raw: unknown): WireFrame | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  if (frame.v !== 1) return null;
  if (typeof frame.session_id !== "string" || !frame.session_id) return null;
  if (typeof frame.type !== "string" || !frame.type) return null;
  return frame as unknown as WireFrame;
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

/** session/queue 帧 → Inbox 权威快照（非法形状返回 null）。 */
export function getQueueSnapshotFrame(frame: WireFrame): QueueSnapshotPayload | null {
  if (frame.type !== "session/queue") return null;
  return isQueueSnapshotPayload(frame.payload) ? frame.payload : null;
}

/** rpc 帧 → 结算 payload；非 rpc 或形状非法返回 null。 */
export function getRpcPayload(frame: WireFrame): RpcPayload | null {
  if (frame.type !== "rpc") return null;
  const payload = asRecord(frame.payload);
  if (!payload
    || typeof payload.request_id !== "string"
    || typeof payload.ok !== "boolean") {
    return null;
  }
  return payload as unknown as RpcPayload;
}

export function getRpcErrorPayload(frame: WireFrame): RpcErrorPayload | null {
  const payload = getRpcPayload(frame);
  if (!payload || payload.ok !== false) return null;
  const error = asRecord(payload.error);
  if (!error || typeof error.code !== "string" || typeof error.message !== "string") {
    return null;
  }
  return {
    request_id: payload.request_id || undefined,
    code: error.code,
    message: error.message,
    session_id: frame.session_id !== "*" ? frame.session_id : undefined,
    retryable: typeof error.retryable === "boolean" ? error.retryable : undefined,
  };
}

// ─── Constants ──────────────────────────────────────────────────────

export const DEFAULT_WS_URL = (import.meta.env.VITE_WS_URL as string) || "ws://127.0.0.1:48650/";
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];
const MAX_PENDING_SENDS = 100;

export function normalizeGatewayUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

// ─── WebSocket Client ───────────────────────────────────────────────

type MessageHandler = (frame: WireFrame) => void;
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

class WebSocketClient {
  private ws: WebSocket | null = null;
  private _url: string;
  private reconnectAttempt = 0;
  /** 每次底层连接的审计标识，避免重连前后的帧混在一起。 */
  private connectionId = "";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private pendingSends: PendingSend[] = [];
  /** 聊天帧保留在这里，直到 Gateway 确认已经可靠写入持久化 Inbox。 */
  private unackedChats = new Map<string, Record<string, unknown>>();
  /** 取消帧使用相同幂等键重试，直到服务端确认取消动作已经应用。 */
  private unackedControls = new Map<string, Record<string, unknown>>();
  /** 需要等待 rpc(queue 快照) 响应的队列控制操作（remove/edit/steer）。 */
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
        this.connected = true;
        this.setStatus("connected");
        if (this.stableTimer) clearTimeout(this.stableTimer);
        this.stableTimer = setTimeout(() => {
          this.reconnectAttempt = 0;
          this.stableTimer = null;
        }, WebSocketClient.STABLE_THRESHOLD);
        // 重连后重新 attach 所有之前关注的 session；
        // Gateway 会在输出锁内先回 session/subscribed 基线再推直播帧。
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
          const frame = parseDownstreamFrame(JSON.parse(raw));
          if (!frame) return;
          if (frame.type === "rpc") this.consumeRpcFrame(frame);
          this.messageHandlers.forEach((h) => h(frame));
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
      // rpc(ok+queue 快照) 或明确错误确认 Inbox 已处理后才移除 outbox。
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

  /** 通过 WebSocket 控制面更新 Inbox 队列，并返回最新权威快照。 */
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

  /**
   * rpc 帧结算：prompt/updateQueue 的 ok 响应 value 是 Inbox 快照，
   * 同时结算聊天 outbox、队列控制 waiter；cancel 的 value 是 {accepted}。
   */
  private consumeRpcFrame(frame: WireFrame): void {
    const payload = getRpcPayload(frame);
    if (!payload) return;
    if (payload.ok) {
      if (isQueueSnapshotPayload(payload.value)) {
        this.unackedChats.delete(payload.request_id);
        this.unackedControls.delete(payload.request_id);
        this.settleControlWaiter(payload.request_id, payload.value);
        return;
      }
      // session.cancel 等非队列结算：控制面 ACK。
      this.unackedControls.delete(payload.request_id);
      return;
    }
    const error = getRpcErrorPayload(frame);
    if (error?.request_id) {
      this.unackedChats.delete(error.request_id);
      this.unackedControls.delete(error.request_id);
      this.settleControlWaiter(error.request_id, undefined, error);
    }
  }

  private settleControlWaiter(
    requestId: string,
    snapshot?: QueueSnapshotPayload,
    error?: RpcErrorPayload,
  ): void {
    const waiter = this.controlWaiters.get(requestId);
    if (!waiter) return;

    clearTimeout(waiter.timer);
    this.controlWaiters.delete(requestId);
    if (error) {
      waiter.reject(new Error(error.message));
      return;
    }
    if (snapshot) {
      waiter.resolve(snapshot);
      return;
    }
    waiter.reject(new Error("队列操作返回了无效快照"));
  }

}

// ─── Singleton ──────────────────────────────────────────────────────

export const wsClient = new WebSocketClient();
