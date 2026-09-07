/**
 * Chat Store：消费 ftre gateway v4 事件日志 wire 协议（PRD-F41/F42）。
 * 每个 session 使用独立 bucket；顶层字段只是当前 bucket 的镜像。
 * 运行态 UI 直接读取 session、activity、queue 和 streaming 等窄语义字段。
 *
 * 帧路由（type 判别直发）：
 * - session/event → bucket fold + 状态机（chunk 走 10ms 批处理）；
 * - session/queue → applyQueueSnapshot（Inbox 权威快照）；
 * - session/projection → token_usage 写顶层、plan 写 bucket；
 * - session/maintenance → command_message 通知 / 压缩气泡；
 * - rpc → durable admission 结算（P1）+ 错误处理；
 * - session/subscribed → attach 返回 Event[]，统一 fold 成 Msg。
 *
 * 用户消息五阶段（PRD-F42 §3.2/§3.3）：
 * P0 optimistic（pendingMessages 预览）→ P1 admitted（rpc ok+queue 快照）→
 * P2 dispatching（turn/start 或快照项消失）→ P3 active（user/message 事件）→
 * P4 done（turn/end）。
 */
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { wsClient } from "@/services/websocket-client";
import {
  getQueueSnapshotFrame,
  getRpcErrorPayload,
  getRpcPayload,
  getSessionSubscribedPayload,
  isQueueSnapshotPayload,
  type QueueItemView,
  type QueueSnapshotPayload,
  type SessionActivity,
  type WsConnectionStatus,
  type WireFrame,
} from "@/services/websocket-client";
import { createSessionRemote, fetchChatAgents, updateAgent, type ChatAgent, type ContextTokenUsage, type TokenUsage } from "@/services/api";
import { ClientSessionProjection, type SessionProjectionState } from "./clientSessionProjection";
import { applyFrame, applyQueueSnapshot } from "./chatProjection";
import { hasActiveTurn, hasPendingWork, hasStreamingAssistant } from "./runtimeState";
import type { SessionEvent, WireMsg } from "@/types/wire.gen";
export { applyFrame, applyQueueSnapshot } from "./chatProjection";
export type { SessionProjectionState } from "./clientSessionProjection";

// ─── Types ───────────────────────────────────────────────────────────

import type {
  ChatMessage,
  PlanData,
  RetryState,
  SendMessageResult,
  SessionStatus,
} from "./chatTypes";
export type {
  ChatMessage,
  ContentBlock,
  MessageAttachment,
  PlanData,
  RetryState,
  Role,
  SendMessageResult,
  SessionStatus,
  ToolConfirm,
  ToolResult,
} from "./chatTypes";

let _defaultWsCache: string | null = null;

// ─── Per-session buckets (module-private) ────────────────────────────

const sessionProjections = new Map<string, ClientSessionProjection>();
/** 流式 chunk 事件的 10ms 合帧窗口（性能红线：append-only + 批量 mirror）。 */
const _wsFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const _wsBatches = new Map<string, WireFrame[]>();
const WS_BATCH_WINDOW_MS = 10;

const emptyBucket = (sid: string): ClientSessionProjection =>
  new ClientSessionProjection(
    { applyFrame },
    {
      sessionId: sid,
      onEventsSettled: () => mirror(sid),
      onReset: () => {
        import("./session")
          .then(({ useSession }) => useSession.getState().reconnectSession(sid))
          .catch(() => void 0);
      },
      onGap: () => {
        const projection = sessionProjections.get(sid);
        if (!projection) return;
        syncAttachCursor(sid, projection);
        wsClient.attach(sid);
      },
    },
  );

function bucket(sid: string): ClientSessionProjection {
  let b = sessionProjections.get(sid);
  if (!b) sessionProjections.set(sid, (b = emptyBucket(sid)));
  return b;
}

const last = <T>(arr: T[]): T | undefined => arr[arr.length - 1];

function mirror(sid: string): void {
  if (useChat.getState().sessionId !== sid) return;
  const b = sessionProjections.get(sid);
  if (!b) return;
  syncAttachCursor(sid, b);
  useChat.setState({
    messages: b.messages,
    sessionStatus: b.sessionStatus,
    sessionActivity: b.sessionActivity ?? "idle",
    sessionRevision: b.sessionRevision ?? -1,
    hasCoordinatorState: b.hasCoordinatorState ?? false,
    queueDepth: b.queueDepth ?? 0,
    queueCapacity: b.queueCapacity ?? null,
    pendingMessages: b.pendingMessages ?? [],
    clientCanSend: b.clientCanSend ?? true,
    canCancel: b.canCancel ?? false,
    blockedReason: b.blockedReason ?? null,
    error: b.error,
    retryState: b.retryState,
    lastUserInputTs: b.lastUserInputTs,
    turnStartTs: b.turnStartTs,
    commandName: b.commandName,
    plan: b.plan,
  });
}

/** Keep reconnect attach cursors at the same boundary as the local projection. */
function syncAttachCursor(sid: string, b: ClientSessionProjection): void {
  wsClient.setAttachCursor?.(sid, {
    seq: b.events.lastSeq,
  });
}

// ─── 发送 admission 结算（P1：rpc ok/error → ChatInput 草稿处置）────

interface SendAdmissionWaiter {
  resolve: (result: { ok: boolean; reason?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
  promise: Promise<{ ok: boolean; reason?: string }>;
}

const sendAdmissionWaiters = new Map<string, SendAdmissionWaiter>();
const SEND_ADMISSION_TIMEOUT_MS = 8000;

/**
 * 等待一次 sendMessage 的 durable admission 结算（rpc ok/error）。
 * 超时按已接纳处理：ws outbox 保证幂等重发，草稿可以安全清除。
 */
export function waitForSendAdmission(requestId: string): Promise<{ ok: boolean; reason?: string }> {
  const existing = sendAdmissionWaiters.get(requestId);
  if (existing) return existing.promise;
  let resolve!: SendAdmissionWaiter["resolve"];
  const promise = new Promise<{ ok: boolean; reason?: string }>((res) => {
    resolve = res;
  });
  const timer = setTimeout(() => settleSendAdmission(requestId, true), SEND_ADMISSION_TIMEOUT_MS);
  sendAdmissionWaiters.set(requestId, { resolve, timer, promise });
  return promise;
}

/** 结算一次发送 admission；返回是否有 waiter 在等（决定错误 toast 归属）。 */
function settleSendAdmission(requestId: string, ok: boolean, reason?: string): boolean {
  const waiter = sendAdmissionWaiters.get(requestId);
  if (!waiter) return false;
  sendAdmissionWaiters.delete(requestId);
  clearTimeout(waiter.timer);
  waiter.resolve({ ok, reason });
  return true;
}

// ─── ID gen ──────────────────────────────────────────────────────────

interface PendingNewSessionSend {
  frameId: string;
  displayText: string;
  attachments?: Array<{
    type: "image";
    mime_type: string;
    data: string;
    name?: string;
  }>;
  metadata: Record<string, unknown>;
}

/** 将前端已发出、尚未收到服务器快照的消息投影为队列横幅项（P0 optimistic）。 */
function pendingPreview(item: PendingNewSessionSend): QueueItemView {
  return {
    request_id: `local:${item.frameId}`,
    sequence: 0,
    placement: "queued",
    content: item.displayText,
    attachments: item.attachments?.map((attachment) => ({ ...attachment })),
    source: "user",
    optimistic: true,
  };
}

const MAX_PENDING_NEW_SESSION_SENDS = 100;
let pendingNewSessionSends: PendingNewSessionSend[] = [];
let pendingSessionCreation: Promise<void> | null = null;
let pendingSessionGeneration = 0;

function resetPendingSessionCreation(): void {
  pendingSessionGeneration += 1;
  pendingNewSessionSends = [];
  // 此处无法取消已经发出的 HTTP 请求。清除共享 Promise 后，新会话可以独立
  // 发起创建；generation 检查负责阻止旧请求回来后修改当前会话。
  pendingSessionCreation = null;
}

// ─── WS Wiring（模块级注册一次）──────────────────────────────────────

const __wsBoundFlag = "__ftreChatWsBound__";
if (!(globalThis as any)[__wsBoundFlag]) {
  (globalThis as any)[__wsBoundFlag] = true;

  let pageHidden = typeof document !== "undefined" ? document.hidden : false;

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      const wasHidden = pageHidden;
      pageHidden = document.hidden;
      if (wasHidden && !pageHidden) {
        // 切回前台：flush 所有未完成的批处理，避免残留。
        for (const sid of _wsBatches.keys()) {
          _flushWsBatch(sid);
        }
        const sid = useChat.getState().sessionId;
        if (sid) mirror(sid);
      }
    });
  }

  // 同一 session 的连续流式事件在窗口内收集，一批 apply + 一次 mirror，
  // 避免 replay 打字机回放。后台节流：Page Hidden 时只入桶不 mirror，
  // 回前台一把刷新。
  function _flushWsBatch(sid: string) {
    const timer = _wsFlushTimers.get(sid);
    if (timer) { clearTimeout(timer); _wsFlushTimers.delete(sid); }
    const frames = _wsBatches.get(sid);
    if (!frames || frames.length === 0) return;
    _wsBatches.delete(sid);
    const b = bucket(sid);
    for (const frame of frames) {
      b.apply(frame);
    }
    syncAttachCursor(sid, b);
    mirror(sid);
  }

  /** Snapshot 重置前丢弃旧 Gateway 的待合帧 chunk，避免它们在快照后迟到。 */
  function _discardWsBatch(sid: string) {
    const timer = _wsFlushTimers.get(sid);
    if (timer) { clearTimeout(timer); _wsFlushTimers.delete(sid); }
    _wsBatches.delete(sid);
  }

  function _enqueueWsFrame(sid: string, b: ClientSessionProjection, frame: WireFrame) {
    const event = (frame.payload as { event?: SessionEvent } | undefined)?.event;
    if (event?.type === "assistant/chunk") {
      let batch = _wsBatches.get(sid);
      if (!batch) { batch = []; _wsBatches.set(sid, batch); }
      batch.push(frame);
      const existing = _wsFlushTimers.get(sid);
      if (existing) clearTimeout(existing);
      _wsFlushTimers.set(sid, setTimeout(() => _flushWsBatch(sid), WS_BATCH_WINDOW_MS));
      return;
    }
    _flushWsBatch(sid);
    b.apply(frame);
    syncAttachCursor(sid, b);
    mirror(sid);
  }

  /** rpc 帧结算：P1 admitted（queue 快照）/ 拒绝错误。 */
  function _handleRpcFrame(frame: WireFrame, sid: string) {
    const payload = getRpcPayload(frame);
    if (!payload) return;
    const b = bucket(sid);
    if (payload.ok) {
      if (isQueueSnapshotPayload(payload.value)) {
        // 同一个 rpc 响应同时结算：durable admission（P1）、本地 optimistic
        // 预览清理和队列投影。
        applyQueueSnapshot(b, payload.value, payload.request_id);
        settleSendAdmission(payload.request_id, true);
        mirror(sid);
      }
      // cancel {accepted} 等非队列结算：wsClient 已完成 outbox 清理。
      return;
    }
    const error = getRpcErrorPayload(frame);
    if (!error) return;
    const requestId = error.request_id ?? payload.request_id;
    if (requestId) {
      // 被服务端拒绝的本地队列项不能一直留在横幅；没有 request_id 的
      // 通用错误则不猜测删除哪一项。
      b.pendingMessages = (b.pendingMessages ?? []).filter(
        (item) => item.request_id !== requestId && item.request_id !== `local:${requestId}`,
      );
      b.queueDepth = b.pendingMessages.length;
    }
    if (!b.hasCoordinatorState) {
      b.sessionStatus = "idle";
      b.sessionActivity = "idle";
      b.canCancel = false;
    }
    const handledByAdmission = requestId
      ? settleSendAdmission(requestId, false, error.message)
      : false;
    mirror(sid);
    if (!handledByAdmission) {
      // 队列编辑/取消等操作错误：通知中心提示（admission 错误由 ChatInput 呈现）。
      import("./notification")
        .then(({ useNotification }) => {
          useNotification.getState().addNotification({
            level: "error",
            message: error.message || error.code || "Request rejected",
          });
        })
        .catch(() => void 0);
    }
  }

  /** session/subscribed attach 响应：先 fold 返回的 Event[]，再继续直播。 */
  function _handleSubscribed(frame: WireFrame, sid: string) {
    const payload = getSessionSubscribedPayload(frame);
    if (!payload) return;
    const b = bucket(sid);
    b.events.applyAttach(payload.events, payload.seq, payload.resync_required);
    if (payload.resync_required) return;

    // 这里只兜底没有协调器事实时的运行态；真实状态仍由 lifecycle Event
    // 和 SessionService 的 status 快照共同驱动。
    if (!b.hasCoordinatorState) {
      const status = payload.status;
      if (status === "idle" || status === "running" || status === "compacting" || status === "blocked") {
        b.hasCoordinatorState = true;
        b.sessionStatus = status;
        b.sessionActivity = status === "idle"
          ? "idle"
          : status === "compacting" ? "compacting" : "executing";
        b.clientCanSend = status !== "compacting" && status !== "blocked";
        b.canCancel = status === "running";
        mirror(sid);
      }
    }
    syncAttachCursor(sid, b);
  }

  wsClient.onMessage((frame: WireFrame) => {
    const sid = frame.session_id;
    if (!sid || sid === "*") return;

    switch (frame.type) {
      case "session/event": {
        const event = (frame.payload as { event?: SessionEvent } | undefined)?.event;
        if (!event || typeof event.type !== "string") return;
        const b = bucket(sid);
        if (pageHidden) {
          b.apply(frame);
          syncAttachCursor(sid, b);
        } else {
          _enqueueWsFrame(sid, b, frame);
        }
        // turn 结束 / blocked 突变影响会话列表的运行徽章与未读检测。
        if (event.type === "turn/end" || event.type === "session/status") {
          import("../stores/session")
            .then(({ useSession }) => useSession.getState().loadAllSessions())
            .catch(() => void 0);
        }
        return;
      }

      case "session/queue": {
        if (!getQueueSnapshotFrame(frame)) return;
        const b = bucket(sid);
        b.apply(frame);
        mirror(sid);
        return;
      }

      case "session/maintenance": {
        const payload = frame.payload as { name?: string; value?: Record<string, unknown> } | undefined;
        if (payload?.name === "command_message") {
          const content = String((payload.value as { content?: string } | undefined)?.content ?? "");
          if (!content) return;
          const level = (payload.value as { level?: string } | undefined)?.level;
          import("./notification")
            .then(({ useNotification }) => {
              useNotification.getState().addNotification({
                level: level === "error" ? "error" : level === "warning" ? "warning" : "info",
                message: content,
              });
            })
            .catch(() => void 0);
          return;
        }
        const b = bucket(sid);
        b.apply(frame);
        mirror(sid);
        return;
      }

      case "session/projection": {
        const payload = frame.payload as { key?: string; value?: unknown; seq?: number } | undefined;
        if (payload?.key === "token_usage" && useChat.getState().sessionId === sid) {
          const usage = payload.value as TokenUsage | null;
          if (usage && typeof usage === "object" && typeof usage.total_tokens === "number") {
            // turn/end 的 usage 是整轮累计值，不是最后一次调用；保留
            // 现有 last_call_usage，避免把累计值误显示为单次调用。
            const previous = useChat.getState().tokenUsage;
            useChat.setState({
              tokenUsage: {
                last_call_usage: previous?.last_call_usage ?? null,
                pending_estimated: Number((usage as TokenUsage & { pending_estimated?: number }).pending_estimated ?? 0),
                context_tokens: Number((usage as TokenUsage & { context_tokens?: number }).context_tokens
                  ?? previous?.context_tokens
                  ?? usage.prompt_tokens
                  ?? usage.total_tokens
                  ?? 0),
                total: Number(usage.total_tokens ?? 0),
              },
            });
          }
        }
        const b = bucket(sid);
        b.apply(frame);
        mirror(sid);
        return;
      }

      case "rpc": {
        _handleRpcFrame(frame, sid);
        return;
      }

      case "session/subscribed": {
        _handleSubscribed(frame, sid);
        return;
      }

      default:
        // 未知帧类型按 F41 FR6 忽略。
        return;
    }
  });

  wsClient.onConnect(() => {
    useChat.setState({ connected: true, wsStatus: "connected" });
    // 重连恢复：wsClient onopen 已重发 attach；服务端在
    // session/subscribed 中直接返回基线之后的 Event[]。
  });
  wsClient.onStatusChange((s) => useChat.setState({ wsStatus: s, connected: s === "connected" }));
  wsClient.onDisconnect(() => {
    // 断线：关掉所有 bucket 的 streaming 状态，保留消息；
    // 重连后由 subscribed Event[] 精确恢复。
    for (const [sid, b] of sessionProjections) {
      if (!b.hasCoordinatorState) {
        b.sessionStatus = "idle";
        b.sessionActivity = "idle";
        b.canCancel = false;
        const tail = last(b.messages);
        if (tail?.streaming) {
          const next = b.messages.slice();
          next[next.length - 1] = { ...tail, streaming: false };
          b.messages = next;
        }
      }
      mirror(sid);
    }
    useChat.setState({ connected: false, wsStatus: "disconnected" });
  });
}

// ─── Store ───────────────────────────────────────────────────────────

interface HistoryPage {
  messages: ChatMessage[];
  /** 同页 WireMsg 种子（assembler 基线重建）。 */
  wire: WireMsg[];
  /** /messages 响应的统一 Session seq。 */
  seq: number;
  hasMoreHistory: boolean;
  status: SessionStatus;
  turnStartTs?: number | null;
  plan?: PlanData | null;
  commandName?: string | null;
  queue?: QueueSnapshotPayload | null;
}

interface ChatState {
  // mirrored from active bucket
  messages: ChatMessage[];
  lastUserInputTs: number | null;
  turnStartTs: number | null;
  commandName: string | null;
  plan: PlanData | null;
  sessionStatus: SessionStatus;
  sessionActivity: SessionActivity;
  sessionRevision: number;
  hasCoordinatorState: boolean;
  queueDepth: number;
  queueCapacity: number | null;
  /** 后端 Inbox items 的只读投影，供队列横幅渲染。 */
  pendingMessages: QueueItemView[];
  clientCanSend: boolean;
  canCancel: boolean;
  blockedReason: string | null;
  error: string | null;
  retryState: RetryState | null;

  // session-independent
  sessionId: string | null;
  connected: boolean;
  wsStatus: WsConnectionStatus;
  model: string | null;
  provider: string | null;
  agentId: string;
  agents: ChatAgent[];
  fetchAgents: () => Promise<void>;
  updateAgentLlm: (provider: string, model: string, reasoningEffort?: string) => Promise<void>;
  /** 当前会话的 token 用量明细。turn/end 后由 session/projection(token_usage)
   *  实时推送；切换 session 时经 HTTP 刷新。 */
  tokenUsage: ContextTokenUsage | null;
  /** 当前选中模型的上下文窗口大小（token 数）。 */
  contextWindow: number | null;
  /** 还没有 sessionId 时（欢迎页/新对话）用户预设的工作区。 */
  pendingWorkspace: string | null;

  sendMessage: (
    content: string,
    attachments?: Array<{
      type: "image";
      mime_type: string;
      data: string;
      name?: string;
    }>,
    system?: boolean,
  ) => SendMessageResult;
  cancelStream: () => void;
  /** 回复工具权限确认：批准/拒绝某个待确认工具调用，驱动后端从挂起恢复。 */
  confirmToolCall: (toolCallId: string, approved: boolean) => void;
  newChat: () => void;
  /** 切到指定 session（不取消后台生成；离开的 session 靠历史 + WS replay 恢复）。 */
  switchTo: (sessionId: string) => void;
  /** 仅当桶为空时填充（首次进入 session 用） */
  clearSessionCache: (sessionId: string) => void;
  setSessionStatus: (sessionId: string, status: SessionStatus) => void;
  /** Put history page into the session bucket (history loader). */
  loadSessionMessages: (sessionId: string, page: HistoryPage) => void;
  /**
   * Prepend earlier ChatMessage[] to the session, deduping by message id.
   * Used for "load earlier messages" pagination.
   */
  prependSessionMessages: (
    sessionId: string,
    earlierMessages: ChatMessage[],
    hasMoreHistory: boolean,
  ) => void;
  /** 该 session 已知最早事件的 timestamp（用作"加载更早"的 before_ts）。 */
  getEarliestEventTs: (sessionId: string) => number | null;
  /** 该 session 的历史是否还有更早的页可拉。 */
  hasMoreHistory: (sessionId: string) => boolean;
  setModel: (model: string | null) => void;
  setProvider: (provider: string | null) => void;
  setAgentId: (id: string) => void;
  /** 同步当前模型的上下文窗口大小（由 ModelSelector 写入）。 */
  setContextWindow: (n: number | null) => void;
  /** 设置欢迎页/新对话的待用工作区。会在创建 session 时透传给后端。 */
  setPendingWorkspace: (path: string | null) => void;
  /** 从后端 config 预加载默认工作区（启动时调用一次）。 */
  initDefaultWorkspace: () => Promise<void>;
  /** 主动刷新当前 session 的 token 估算（异步，失败静默）。 */
  refreshTokenUsage: (sessionId?: string) => Promise<void>;
}


export const useChat = create<ChatState>((set, get) => ({
  messages: [],
  lastUserInputTs: null,
  turnStartTs: null,
  commandName: null,
  plan: null,
  sessionStatus: "idle",
  sessionActivity: "idle",
  sessionRevision: -1,
  hasCoordinatorState: false,
  queueDepth: 0,
  queueCapacity: null,
  pendingMessages: [],
  clientCanSend: true,
  canCancel: false,
  blockedReason: null,
  error: null,
  retryState: null,
  sessionId: null,
  connected: false,
  wsStatus: "disconnected" as WsConnectionStatus,
  model: null,
  provider: null,
  agentId: typeof localStorage !== "undefined"
    ? localStorage.getItem("ftre_agent_id") || "default"
    : "default",
  agents: [] as ChatAgent[],
  tokenUsage: null,
  contextWindow: null,
  pendingWorkspace: null,

  sendMessage: (content, attachments, _system) => {
    // Session 正在压缩时禁止创建本地乐观消息；后端也有同样的竞态兜底。
    const currentState = get();
    if (currentState.sessionStatus === "compacting") {
      return { ok: false, reason: "compacting" };
    }
    if (currentState.hasCoordinatorState && !currentState.clientCanSend) {
      return { ok: false, reason: "blocked" };
    }

    // 归一：string → 本地回显文本（Inbound 协议只承载纯文本字符串）
    const displayText = content.trim();
    const hasAttachments = !!attachments && attachments.length > 0;
    if (!displayText && !hasAttachments) return { ok: false, reason: "empty" };

    // 系统级指令（如 /cancel）为 ephemeral 控制，不创建本地假消息，也不主动改 busy 状态
    // /cancel 使用独立的高优先级控制帧；其它输入（包括普通指令）都先入队。

    // 本地回显：把后端协议形态的 attachments 转成带 data URL 的形态
    const frameId = crypto.randomUUID().slice(0, 16);
    const { model, provider, agentId } = get();
    const outbound: PendingNewSessionSend = {
      frameId,
      displayText,
      attachments,
      metadata: {
        ...(model && { model }),
        ...(provider && { provider }),
        ...(agentId && { agent_id: agentId }),
      },
    };
    const send = (sid: string, item: PendingNewSessionSend = outbound) => {
      const b = bucket(sid);
      const result = wsClient.sendChat(
        item.displayText,
        { ...item.metadata, session_id: sid },
        item.attachments,
        item.frameId,
      );
      if (result.ok) {
        if (!b.pendingMessages.some((queued) => queued.request_id === `local:${item.frameId}` || queued.request_id === item.frameId)) {
          // P0 optimistic：每条用户输入都先显示在队列横幅，绝不在聊天区创建
          // 本地 UserMessage；user/message 事件（P3）到达后才进入聊天记录。
          b.pendingMessages = [...b.pendingMessages, pendingPreview(item)];
          b.queueDepth = b.pendingMessages.length;
        }
        b.lastUserInputTs = null;
        b.sessionStatus = "running";
        if (!b.hasCoordinatorState) b.sessionActivity = "dispatching";
        b.error = null;
        b.retryState = null;
      }
      mirror(sid);
      return result;
    };

    const sid = get().sessionId;
    if (sid) {
      const result = send(sid);
      if (!result.ok) {
        return {
          ok: false,
          reason: result.reason === "outbox_full" ? "outbox_full" : "transport_failed",
        };
      }
      return { ok: true, requestId: frameId };
    }

    // 首次发消息：fetch 创建 session 期间会有 100~500ms 网络往返，
    // session 创建期间先显示派发态和 pending 预览，避免 WelcomeView 闪回。
    if (pendingNewSessionSends.length >= MAX_PENDING_NEW_SESSION_SENDS) {
      return { ok: false, reason: "outbox_full" };
    }
    pendingNewSessionSends.push(outbound);
    set({
      sessionStatus: "running",
      sessionActivity: "dispatching",
      // 新 session 还没有 bucket；先在顶层投影显示同一套 pending 横幅。
      queueDepth: pendingNewSessionSends.length,
      pendingMessages: pendingNewSessionSends.map(pendingPreview),
      lastUserInputTs: null,
      error: null,
    });

    if (!pendingSessionCreation) {
      const generation = pendingSessionGeneration;
      const workspace = get().pendingWorkspace;
      const creation = createSessionRemote({ channelId: "ws", workspace })
        .then((data) => {
          if (generation !== pendingSessionGeneration) return;
          if (!data?.session_id) throw new Error("Failed to create session");

          const queued = pendingNewSessionSends;
          pendingNewSessionSends = [];
          set({ sessionId: data.session_id, pendingWorkspace: null });
          wsClient.subscribeOnly(data.session_id);
          for (const item of queued) send(data.session_id, item);
        })
        .catch(() => {
          if (generation !== pendingSessionGeneration) return;
          pendingNewSessionSends = [];
          set({
            sessionStatus: "idle",
            sessionActivity: "idle",
            queueDepth: 0,
            pendingMessages: [],
            error: "Failed to create session",
          });
        })
        .finally(() => {
          if (pendingSessionCreation === creation) pendingSessionCreation = null;
        });
      pendingSessionCreation = creation;
    }
    return { ok: true, requestId: frameId };
  },
  cancelStream: () => {
    const sid = get().sessionId;
    if (!sid) return;
    const b = bucket(sid);
    if (b.hasCoordinatorState && !b.canCancel) return;
    b.sessionActivity = "cancelling";
    b.sessionStatus = "running";
    b.canCancel = false;
    mirror(sid);
    // /cancel 使用独立的 session.cancel 控制帧，在 Session lock 外处理。
    wsClient.sendCancel(sid);
  },

  confirmToolCall: (toolCallId, approved) => {
    const sid = get().sessionId;
    if (!sid || !toolCallId) return;
    // 保留 asking 卡片，直到后端确认回执（user/message "/allow …"）与
    // tool/result(denied) 到达。发送失败时仍能超时解锁并重试。
    const b = bucket(sid);
    if (!b.hasCoordinatorState) {
      b.sessionStatus = "running";
      b.sessionActivity = "executing";
      b.canCancel = true;
    }
    mirror(sid);
    wsClient.sendToolConfirmation(sid, toolCallId, approved);
  },

  newChat: () => {
    resetPendingSessionCreation();
    wsClient.subscribeOnly(null);
    set({
      sessionId: null,
      messages: [],
      lastUserInputTs: null,
      turnStartTs: null,
      commandName: null,
      plan: null,
      sessionStatus: "idle",
      sessionActivity: "idle",
      sessionRevision: -1,
      hasCoordinatorState: false,
      queueDepth: 0,
      queueCapacity: null,
      pendingMessages: [],
      clientCanSend: true,
      canCancel: false,
      blockedReason: null,
      error: null,
      retryState: null,
      tokenUsage: null,
      pendingWorkspace: _defaultWsCache,
    });
  },
  switchTo: (sessionId) => {
    resetPendingSessionCreation();
    const b = bucket(sessionId);
    set({
      sessionId,
      messages: b.messages,
      lastUserInputTs: b.lastUserInputTs,
      turnStartTs: b.turnStartTs,
      commandName: b.commandName,
      plan: b.plan,
      sessionStatus: b.sessionStatus,
      sessionActivity: b.sessionActivity,
      sessionRevision: b.sessionRevision,
      hasCoordinatorState: b.hasCoordinatorState,
      queueDepth: b.queueDepth,
      queueCapacity: b.queueCapacity,
      pendingMessages: b.pendingMessages,
      clientCanSend: b.clientCanSend,
      canCancel: b.canCancel,
      blockedReason: b.blockedReason,
      error: b.error,
      retryState: b.retryState,
      tokenUsage: null,
    });
    void get().refreshTokenUsage(sessionId);
  },

  clearSessionCache: (sessionId) => {
    const timer = _wsFlushTimers.get(sessionId);
    if (timer) { clearTimeout(timer); _wsFlushTimers.delete(sessionId); }
    _wsBatches.delete(sessionId);
    sessionProjections.set(sessionId, emptyBucket(sessionId));
    mirror(sessionId);
  },

  setSessionStatus: (sessionId, status) => {
    const b = bucket(sessionId);
    if (b.hasCoordinatorState) return;
    b.sessionStatus = status;
    if (status !== "blocked") b.blockedReason = null;
    b.sessionActivity = status === "idle"
      ? "idle"
      : status === "compacting"
        ? "compacting"
        : "executing";
    b.clientCanSend = status !== "compacting" && status !== "blocked";
    b.canCancel = status === "running";
    if (status === "running") {
      b.error = null;
      b.retryState = null;
    } else {
      b.retryState = null;
    }
    mirror(sessionId);
  },

  loadSessionMessages: (sessionId, page) => {
    const b = bucket(sessionId);
    b.hydrate({
      messages: page.messages,
      wire: page.wire,
      seq: page.seq,
      hasMoreHistory: page.hasMoreHistory,
      status: page.status,
      turnStartTs: page.turnStartTs,
      plan: page.plan,
      commandName: page.commandName,
    });
    if (page.queue) {
      // HTTP 返回的 queue 是刷新后的权威快照，直接复用实时帧的投影 reducer。
      applyQueueSnapshot(b, page.queue);
    }
    mirror(sessionId);
  },

  prependSessionMessages: (sessionId, earlierMessages, hasMoreHistory) => {
    const b = bucket(sessionId);
    b.prependHistory(earlierMessages, hasMoreHistory);
    mirror(sessionId);
  },

  getEarliestEventTs: (sessionId) => bucket(sessionId).earliestTs,

  hasMoreHistory: (sessionId) => bucket(sessionId).hasMoreHistory,

  setModel: (model) => set({ model }),
  setProvider: (provider) => set({ provider }),
  setAgentId: (id) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("ftre_agent_id", id);
    }
    set({ agentId: id });
  },

  fetchAgents: async () => {
    const list = await fetchChatAgents();
    const currentId = get().agentId;
    // 如果当前 agentId 不在列表中，回退到 default
    if (list.length > 0 && !list.find((a) => a.id === currentId)) {
      const def = list.find((a) => a.id === "default") || list[0];
      if (def && def.id !== currentId) {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("ftre_agent_id", def.id);
        }
        set({ agents: list, agentId: def.id });
        return;
      }
    }
    set({ agents: list });
  },

  updateAgentLlm: async (provider, model, reasoningEffort) => {
    const { agentId } = get();
    if (!agentId) return;
    const patch: { llm: { provider?: string; model?: string; reasoning_effort?: string } } = { llm: { provider, model } };
    if (reasoningEffort !== undefined) patch.llm.reasoning_effort = reasoningEffort;
    const ok = await updateAgent(agentId, patch);
    if (ok) {
      set({ model, provider });
      await get().fetchAgents();
    }
  },

  setContextWindow: (n) => set({ contextWindow: n }),
  setPendingWorkspace: (path) => set({ pendingWorkspace: path }),

  initDefaultWorkspace: async () => {
    const { pendingWorkspace } = get();
    if (pendingWorkspace) return;
    try {
      const { fetchAppConfig } = await import("@/services/api");
      const cfg = await fetchAppConfig();
      const def = cfg?.default_workspace;
      if (typeof def === "string" && def.trim() && !get().pendingWorkspace) {
        _defaultWsCache = def.trim();
        set({ pendingWorkspace: def.trim() });
      }
    } catch { /* 静默失败 */ }
  },

  refreshTokenUsage: async (sessionId) => {
    const sid = sessionId ?? get().sessionId;
    if (!sid) {
      set({ tokenUsage: null });
      return;
    }
    try {
      // 动态 import 打破 chat → api 之间的循环（api 也会 import chat store）。
      const { fetchTokenUsage } = await import("@/services/api");
      const usage = await fetchTokenUsage(sid);
      // 刷新过程中如果用户已经切走了 session，丢弃这次结果。
      if (get().sessionId !== sid) return;
      set({ tokenUsage: usage });
    } catch (e) {
      // HTTP/网络失败：保留上一次值，避免 UI 闪到 0。
      console.error("[chat] refreshTokenUsage failed:", e);
    }
  },
}));

// ─── Selectors ───────────────────────────────────────────────────────

export const useMessageIds = () => useChat(useShallow((s) => s.messages.map((m) => m.id)));
export const useMessageById = (id: string) => useChat((s) => s.messages.find((m) => m.id === id));
export const useIsStreaming = () => useChat((s) => hasStreamingAssistant(s.messages));
export const useHasPendingWork = () => useChat((s) => hasPendingWork(s.queueDepth, s.pendingMessages));
export const useHasActiveTurn = () => useChat((s) => hasActiveTurn(s.sessionStatus, s.sessionActivity));
export const useModel = () => useChat((s) => s.model);
export const useProvider = () => useChat((s) => s.provider);
export const useSessionId = () => useChat((s) => s.sessionId);
export const useAgentId = () => useChat((s) => s.agentId);
export const useWsStatus = () => useChat((s) => s.wsStatus);
export const useStreamingMessageId = () =>
  useChat((s) => s.messages.find((m) => m.streaming)?.id ?? null);
