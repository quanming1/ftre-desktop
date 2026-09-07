/**
 * Session Chat projection reducer（统一 seq 事件消费端，PRD-F42 §3）。
 *
 * applyFrame 把 6 种下行帧分发到：
 * - session/event → SessionEventClient（seq 游标 + assembler fold）+ 会话状态机；
 * - session/queue → applyQueueSnapshot（Inbox 权威快照，last-wins）；
 * - session/maintenance → 压缩瞬态气泡；
 * - session/projection → plan 等派生状态（token_usage 在 chat.ts 顶层处理）；
 * - rpc / session/subscribed 由 chat.ts 处理（attach Event[] 与顶层副作用）。
 *
 * 状态机（F42 §3.1）：turn/start→executing、turn/end(outcome)→idle/paused、
 * session/status 仅处理 blocked、turn/retry→重试横幅——一态一源。
 * Reducer 不依赖 React，便于单测和重连复用。
 */
import {
  isQueueSnapshotPayload,
  type QueueItemView,
  type QueueSnapshotPayload,
} from "@/services/websocket-client";
import type {
  SessionEvent,
  SessionMaintenancePayload,
  SessionProjectionPayload,
  WireFrame,
} from "@/types/wire.gen";
import type { Role } from "./chatTypes";
import type { ChatMessage } from "./chatTypes";
import type { SessionProjectionState } from "./clientSessionProjection";

let messageSequence = 0;
const nextId = (prefix = "msg") => `${prefix}_${Date.now()}_${++messageSequence}`;

function canonicalRequestId(requestId: string): string {
  return requestId.startsWith("local:") ? requestId.slice("local:".length) : requestId;
}

// ─── 队列快照（Inbox 权威事实，F24 冻结形状）─────────────────────────

/** 将 ftre-inbox 的权威 session/queue 投影为队列横幅数据。 */
export function applyQueueSnapshot(
  b: SessionProjectionState,
  payload: QueueSnapshotPayload,
  operationRequestId?: string,
): void {
  const acknowledgedRequestId = operationRequestId
    ? canonicalRequestId(operationRequestId)
    : null;
  // 操作响应的 request_id 是独立于 revision 的结算事实。后台广播可能先到，
  // 让后续操作响应因 revision 较旧而被丢弃；即使如此，也必须清掉对应的
  // 本地 optimistic 预览，不能让已处理消息永久留在队列横幅中。
  if (acknowledgedRequestId) {
    b.pendingMessages = (b.pendingMessages ?? []).filter(
      (item) => !item.optimistic
        || canonicalRequestId(item.request_id) !== acknowledgedRequestId,
    );
    b.queueDepth = (b.pendingMessages ?? []).length;
  }
  // revision 属于 Inbox 持久化状态，不再用客户端收到帧的顺序猜测新旧。
  // 操作响应和后台广播可能乱序，旧 revision 必须完全丢弃。
  const revision = payload.revision;
  if (revision <= (b.sessionRevision ?? -1)) return;
  const pending = payload.items.map((item, index): QueueItemView => ({
    request_id: item.id,
    sequence: index + 1,
    placement: item.placement,
    content: item.message.content.map((part) => part.text).join(""),
    attachments: item.message.attachments,
    source: item.placement === "context" ? "plugin" : "user",
  }));
  // 网络上可能先到达旧快照，而刚点发送的本地请求尚未收到 rpc 结算。
  // 只保留尚未确认的本地 request_id，已确认项目完全以后端 pending 为准。
  const serverRequestIds = new Set(
    pending
      .map((item) => canonicalRequestId(item.request_id))
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  // 操作响应携带 request_id，表示这个本地发送已经由 Inbox 结算。
  // 如果 Agent 在响应生成前就 claim 了消息，快照会直接是空数组；此时
  // 不能再把对应 optimistic 项当成“尚未确认”保留下来。没有 request_id
  // 的后台广播仍不能猜测本地 outbox 是否已经送达，因此继续保留它。
  const awaitingAdmission = (b.pendingMessages ?? []).filter((item) => (
    item.optimistic
    && canonicalRequestId(item.request_id) !== acknowledgedRequestId
    && !serverRequestIds.has(canonicalRequestId(item.request_id))
  ));
  // Queue snapshot 是 claim 的权威事实。已消费项不能继续以“正在消费”占位
  // 留在队列横幅，否则用户会看到队列未清理；user/message 到达后再进入消息列表。
  const pendingMessages = [...pending, ...awaitingAdmission];
  const queueDepth = pending.length + awaitingAdmission.length;
  b.hasCoordinatorState = true;
  b.sessionRevision = revision;
  b.queueDepth = queueDepth;
  // Inbox snapshot 不包含容量和 active 状态；这些字段由本地配置和状态事件
  // 分别维护，队列事件只能替换 pending 事实。
  b.queueCapacity = b.queueCapacity ?? null;
  b.pendingMessages = pendingMessages;
  b.clientCanSend = b.clientCanSend ?? true;
  b.canCancel = b.canCancel ?? false;
  b.blockedReason = b.blockedReason ?? null;
  if (b.sessionStatus === "idle" && queueDepth === 0) {
    b.commandName = null;
    b.turnStartTs = null;
  }
}

// ─── 帧分发 ──────────────────────────────────────────────────────────

/**
 * 应用一个下行帧（幂等；事件帧的幂等由 seq 游标保证）。
 * rpc 与 session/subscribed 不在此处理——它们需要异步 catch-up 与顶层
 * store 副作用，由 stores/chat.ts 路由。
 */
export function applyFrame(b: SessionProjectionState, frame: WireFrame): void {
  switch (frame.type) {
    case "session/event": {
      const payload = frame.payload as { event?: SessionEvent } | undefined;
      const event = payload?.event;
      if (!event || typeof event.type !== "string") return;
      const accepted: SessionEvent[] = [];
      b.events.ingest(event, (acceptedEvent) => accepted.push(acceptedEvent));
      b.projectEvents();
      // 跳号事件会暂存在 SessionEventClient；只有实际按 seq 接受时才推进
      // 状态机，避免一个迟到的 turn/end 提前把会话标成 idle。
      for (const acceptedEvent of accepted) applyLifecycleEvent(b, acceptedEvent);
      return;
    }
    case "session/queue": {
      if (isQueueSnapshotPayload(frame.payload)) {
        applyQueueSnapshot(b, frame.payload);
      }
      return;
    }
    case "session/maintenance": {
      applyMaintenanceFrame(b, (frame.payload ?? { name: "", value: {} }) as SessionMaintenancePayload);
      return;
    }
    case "session/projection": {
      applyProjectionFrame(b, (frame.payload ?? { key: "", value: null, seq: 0 }) as SessionProjectionPayload);
      return;
    }
    default:
      // rpc / session/subscribed / 未知帧：chat.ts 路由或按 FR6 忽略。
      return;
  }
}

// ─── 会话状态机（F42 §3.1；驱动源 = 生命周期事件）───────────────────

/** 生命周期事件驱动的状态迁移 + user/message 的队列横幅结算（P3）。 */
export function applyLifecycleEvent(b: SessionProjectionState, event: SessionEvent): void {
  const data = (event.data ?? {}) as Record<string, any>;
  const ts = event.time || Date.now();

  switch (event.type) {
    // ─── P3：真实用户消息已被服务端持久化（I1：早于 claim 后快照）───
    case "user/message": {
      const metadata = data.metadata ?? {};
      if (metadata.hide === true) {
        attachHiddenImageToLatestReadTool(b, data);
        return;
      }
      b.lastUserInputTs = ts;
      const requestId = typeof data.request_id === "string" && data.request_id
        ? data.request_id
        : typeof metadata.request_id === "string" ? metadata.request_id : undefined;
      if (requestId) {
        const canonical = canonicalRequestId(requestId);
        b.pendingMessages = (b.pendingMessages ?? []).filter(
          (item) => canonicalRequestId(item.request_id) !== canonical,
        );
        b.queueDepth = b.pendingMessages.length;
      }
      return;
    }

    // ─── turn 开始：dispatching → executing 入口 ───
    case "turn/start": {
      b.hasCoordinatorState = true;
      b.sessionStatus = "running";
      b.sessionActivity = "executing";
      b.clientCanSend = true;
      b.canCancel = true;
      b.error = null;
      b.retryState = null;
      b.commandName = typeof data.command_name === "string" && data.command_name
        ? data.command_name
        : null;
      b.turnStartTs = ts;
      return;
    }

    case "turn/retry": {
      b.retryState = {
        attempt: Number(data.attempt ?? 0),
        maxAttempts: Number(data.max_attempts ?? 0),
        message: String(data.message ?? ""),
      };
      return;
    }

    // ─── P4：turn 结束（outcome → idle / paused）───
    case "turn/end": {
      applyTurnEnd(b, event, data, ts);
      return;
    }

    // ─── 仅 blocked 突变进入日志（F41 §4.2）───
    case "session/status": {
      if (String(data.status ?? "") === "blocked") {
        b.hasCoordinatorState = true;
        b.sessionStatus = "blocked";
        b.blockedReason = typeof data.reason === "string" && data.reason
          ? data.reason
          : "blocked";
        b.clientCanSend = false;
        b.canCancel = false;
        return;
      }
      if (b.sessionStatus === "blocked") {
        b.sessionStatus = "idle";
        b.sessionActivity = "idle";
        b.blockedReason = null;
        b.clientCanSend = true;
      }
      return;
    }

    // ─── 压缩完成：compact 锚点消息由 fold 生成（稳定 id，与刷新后一致）；
    //     维护帧产生的瞬态 running 气泡在此退场，避免双气泡 ───
    case "compact/message": {
      dismissRunningCompact(b);
      if (!b.hasCoordinatorState) {
        b.sessionStatus = "idle";
        b.sessionActivity = "idle";
        b.clientCanSend = true;
        b.canCancel = false;
      }
      return;
    }

    default:
      return;
  }
}

function applyTurnEnd(
  b: SessionProjectionState,
  event: SessionEvent,
  data: Record<string, any>,
  ts: number,
): void {
  b.hasCoordinatorState = true;
  b.canCancel = false;
  b.clientCanSend = true;
  b.retryState = null;
  // 正常路径 fold 已按 message_id 落终态；这里兜底封口残余 streaming 气泡。
  sealStreamingTail(b);
  const outcome = String(data.outcome ?? "completed");
  if (outcome === "paused") {
    // 等待确认：输入保持可用（确认回执 "/allow …" 本身是普通输入）。
    b.sessionStatus = "idle";
    b.sessionActivity = "paused";
  } else {
    b.sessionStatus = "idle";
    b.sessionActivity = "idle";
  }

  // 计算耗时并写入本轮最后一条 assistant 消息。
  if (b.turnStartTs != null) {
    const durationSec = Math.max(0, Math.round((ts - b.turnStartTs) / 1000));
    for (let i = b.messages.length - 1; i >= 0; i--) {
      const message = b.messages[i];
      if (message.role !== "assistant" || message.external) continue;
      const next = b.messages.slice();
      next[i] = {
        ...message,
        durationSec,
        finishedAt: message.finishedAt ?? ts,
      };
      b.messages = next;
      break;
    }
    b.turnStartTs = null;
  }

  if (outcome === "error") {
    const error = data.error;
    const errorMessage = error && typeof error.message === "string"
      ? error.message
      : "Turn 执行失败";
    const errorCode = error && typeof error.code === "string" ? error.code : undefined;
    // fold 已把 error 落到 message_id 消息；仅当无消息坐标时补挂最后一条。
    if (!event.message_id) {
      attachErrorToLastAssistant(b, errorCode, errorMessage);
    }
    b.error = errorCode ? `[${errorCode}] ${errorMessage}` : errorMessage;
  }

  if (b.sessionStatus === "idle" && (b.pendingMessages?.length ?? 0) === 0) {
    b.commandName = null;
  }
}

function sealStreamingTail(b: SessionProjectionState): void {
  const tail = b.messages[b.messages.length - 1];
  if (tail?.role === "assistant" && tail.streaming) {
    const next = b.messages.slice();
    next[next.length - 1] = { ...tail, streaming: false };
    b.messages = next;
  }
}

function attachErrorToLastAssistant(
  b: SessionProjectionState,
  code: string | undefined,
  message: string,
): void {
  for (let i = b.messages.length - 1; i >= 0; i--) {
    const msg = b.messages[i];
    if (msg.role !== "assistant" || msg.external) continue;
    const next = b.messages.slice();
    next[i] = {
      ...msg,
      isError: true,
      error: msg.error ?? { code, message },
    };
    b.messages = next;
    return;
  }
  b.messages = [
    ...b.messages,
    {
      id: nextId("err"),
      role: "assistant",
      content: null,
      timestamp: Date.now(),
      isError: true,
      error: { code, message },
    },
  ];
}

/** hide 的 image_file 用户消息挂接到最近一次 read/read_file 工具结果（显示特例）。 */
function attachHiddenImageToLatestReadTool(
  b: SessionProjectionState,
  data: { content?: unknown },
): void {
  const content = Array.isArray(data.content) ? data.content : [];
  if (!content.some(
    (part) => (part as { type?: string; path?: unknown })?.type === "image_file"
      && typeof (part as { path?: unknown }).path === "string",
  )) return;

  for (let i = b.messages.length - 1; i >= 0; i--) {
    const msg = b.messages[i];
    if (!msg.blocks) continue;
    const toolCallBlock = msg.blocks.find(
      (bl) => bl.type === "toolCall" && (bl.name === "read" || bl.name === "read_file"),
    );
    if (!toolCallBlock || toolCallBlock.type !== "toolCall") continue;
    const tcId = toolCallBlock.id;
    const existingResult = msg.toolResults?.[tcId];
    if (existingResult?.result?.includes("image_file")) continue;
    const nextMessages = b.messages.slice();
    nextMessages[i] = {
      ...msg,
      toolResults: {
        ...(msg.toolResults || {}),
        [tcId]: {
          id: tcId,
          name: toolCallBlock.name,
          result: JSON.stringify(data),
          error: null,
          status: "completed" as const,
        },
      },
    };
    b.messages = nextMessages;
    return;
  }
}

// ─── session/maintenance：压缩瞬态气泡 ───────────────────────────────

export const MaintenanceName = {
  COMPACT_START: "context_compact_start",
  COMPACT_FAILED: "context_compact_failed",
  COMMAND_MESSAGE: "command_message",
} as const;

let compactBubbleSequence = 0;

export function applyMaintenanceFrame(
  b: SessionProjectionState,
  payload: SessionMaintenancePayload,
): void {
  const name = String(payload?.name ?? "");
  const value = payload?.value ?? {};
  if (name === MaintenanceName.COMPACT_START) {
    if (!b.hasCoordinatorState) {
      b.sessionStatus = "compacting";
      b.sessionActivity = "compacting";
      b.clientCanSend = false;
      b.canCancel = false;
    }
    b.messages = [
      ...b.messages,
      {
        id: `compact_${Date.now()}_${++compactBubbleSequence}`,
        role: "system" as Role,
        content: null,
        timestamp: Date.now(),
        compact: {
          status: "running" as const,
          model: typeof value.model === "string" && value.model ? value.model : undefined,
          tokensBefore: typeof value.tokens === "number" ? value.tokens : undefined,
        },
      },
    ];
    return;
  }
  if (name === MaintenanceName.COMPACT_FAILED) {
    if (!b.hasCoordinatorState) {
      b.sessionStatus = "idle";
      b.sessionActivity = "idle";
      b.clientCanSend = true;
      b.canCancel = false;
    }
    for (let i = b.messages.length - 1; i >= 0; i--) {
      if (b.messages[i].compact?.status !== "running") continue;
      const next = b.messages.slice();
      next[i] = {
        ...next[i],
        compact: {
          status: "failed" as const,
          reason: typeof value.reason === "string" ? value.reason : "未知原因",
        },
      };
      b.messages = next;
      break;
    }
  }
  // command_message 由 chat.ts 路由到通知中心（不产生聊天气泡）。
}

/**
 * 移除维护帧产生的运行中压缩气泡。压缩完成后的可见气泡由 fold 的
 * compact/message 锚点消息承担（id 稳定，与刷新后的持久化路径一致）。
 */
function dismissRunningCompact(b: SessionProjectionState): void {
  for (let i = b.messages.length - 1; i >= 0; i--) {
    if (b.messages[i].compact?.status !== "running") continue;
    const next = b.messages.slice();
    next.splice(i, 1);
    b.messages = next;
    return;
  }
}

// ─── session/projection：派生状态快照（last-wins）────────────────────

function applyProjectionFrame(
  b: SessionProjectionState,
  payload: SessionProjectionPayload,
): void {
  const key = String(payload?.key ?? "");
  if (key === "plan") {
    const value = payload.value as { goal?: unknown; steps?: unknown } | null;
    if (value && typeof value === "object" && Array.isArray(value.steps)) {
      b.plan = value as SessionProjectionState["plan"];
    } else {
      b.plan = null;
    }
  }
  // token_usage 由 chat.ts 写入顶层 useChat.tokenUsage；其余 key 忽略。
}
