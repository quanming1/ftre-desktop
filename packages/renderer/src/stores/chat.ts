/**
 * Chat Store 鈥?娑堣垂 ftre gateway WebSocket 浜嬩欢娴併€? *
 * 澶?session 妯″瀷锛? *   姣忎釜 session 鏈夌嫭绔?bucket锛坢essages/isBusy/error/retryState锛夈€? *   store 椤跺眰瀛楁鏄?active bucket 鐨勯暅鍍忥紙淇濈暀鏃ф秷璐?API: useChat((s)=>s.messages) 绛夛級銆? *   鍒?session 鏃剁洿鎺?hydrate锛涜繘琛屼腑鐨勬祦涓嶈鎵撴柇銆? *
 * 事件源：ws 实时事件走 applyEvent reducer；history 加载走 historyToMessages 直接转换。 */
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { wsClient } from "@/services/websocket-client";
import {
  CompactEventName,
  UserMessageEventType,
  getMessageAckPayload,
  getSessionEventPayload,
  getSessionStatusPayload,
  getSessionCommandPayload,
  getSessionContextWarningPayload,
  getRpcErrorPayload,
  isReplySnapshotMessage,
  type AgentStreamEvent,
  type QueueItemView,
  type QueueSnapshotPayload,
  type ReplySnapshotPayload,
  type SessionActivity,
  type WsConnectionStatus,
  type ServerMessage,
} from "@/services/websocket-client";
import { createSessionRemote, API_BASE, fetchChatAgents, updateAgent } from "@/services/api";
import type { ChatAgent, MessageToken, ContextTokenUsage } from "@/services/api";
import { ClientSessionProjection, type SessionProjectionState } from "./clientSessionProjection";
export type { SessionProjectionState } from "./clientSessionProjection";

// ─── Types ───────────────────────────────────────────────────────────

export type Role = "assistant" | "user" | "system";
export type SessionStatus = "idle" | "running" | "compacting" | "blocked";
export type SendMessageResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: "empty" | "compacting" | "blocked" | "outbox_full" | "transport_failed" };

/** 协议级 content block（assistant 消息的最小内容单元） */
export type ContentBlock =
  | { type: "thinking"; thinking: string; blockId: string }
  | { type: "text"; text: string; blockId: string }
  | { type: "data"; data: string; url?: string; mediaType: string; blockId: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, any>; argumentsText?: string };

/** 工具权限确认信息（status==="asking" 时携带，供确认卡片渲染） */
export interface ToolConfirm {
  /** 命中 ASK 的原因（实时事件携带；历史恢复时无该字段，用通用文案） */
  reason?: string;
  /** 命中的权限规则 id（可选，仅溯源展示） */
  ruleId?: string;
}

/** 工具执行结果（与 toolCall block 的 id 配对） */
export interface ToolResult {
  id: string;
  name: string;
  result: string | null;
  error: string | null;
  status: "running" | "completed" | "error" | "cancelled" | "asking" | "denied";
  /** status==="asking" 时的权限确认上下文 */
  confirm?: ToolConfirm;
  /** 工具附加元数据（edit/write 携带 diff 信息） */
  metadata?: {
    file?: string;
    before?: string;
    after?: string;
    diff?: string;
    additions?: number;
    deletions?: number;
    [key: string]: any;
  };
}

export interface MessageAttachment {
  type: "image";
  url: string;
  mime?: string;
  name?: string;
  bytes?: number;
}

export interface ChatMessage {
  id: string;
  role: Role;
  /** user: 文本; assistant: 拼接文本(便利字段); system: null */
  content: string | null;
  timestamp: number;
  /** assistant: 协议 content blocks（直接存储，不做二次转换） */
  blocks?: ContentBlock[];
  /** assistant: tool 结果，按 toolCall.id 索引 */
  toolResults?: Record<string, ToolResult>;
  streaming?: boolean;
  attachments?: MessageAttachment[];
  token?: MessageToken;
  metadata?: { kind?: "block" | "final"; [k: string]: any };
  isError?: boolean;
  /** Reply 结束后的状态错误；正文仍按正常 content blocks 渲染。 */
  error?: { code?: string; message: string };
  external?: boolean;
  externalFrom?: string;
  compact?: {
    status: "running" | "done" | "failed";
    mode?: "summary" | "fast";
    /** context_compact_start 中的实际摘要模型；仅运行中的压缩使用。 */
    model?: string;
    tokensBefore?: number;
    tokensAfter?: number;
    summaryPreview?: string;
    eventsCleared?: number;
    toolResults?: number;
    reason?: string;
  };
  /** 本轮耗时（秒），turn_end 时计算写入 */
  durationSec?: number;
  /** 产生该消息的模型 ID（从 MODEL_CALL_START.model_name 提取） */
  model?: string;
  /** 本地发送或重连恢复的用户消息所对应的可靠队列生命周期。 */
}

let _defaultWsCache: string | null = null;

export interface RetryState {
  attempt: number;
  maxAttempts: number;
  message: string;
}

export interface PlanStep {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface PlanData {
  goal: string;
  steps: PlanStep[];
}

// 鈹€鈹€鈹€ Per-session buckets (module-private) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const sessionProjections = new Map<string, ClientSessionProjection>();
const STREAM_TYPES = new Set([
  "TEXT_BLOCK_DELTA",
  "DATA_BLOCK_DELTA",
  "THINKING_BLOCK_DELTA",
  "TOOL_CALL_DELTA",
  "TOOL_RESULT_TEXT_DELTA",
  "TOOL_RESULT_DATA_DELTA",
]);
const _wsFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const _wsBatches = new Map<string, BusEvent[]>();
const WS_BATCH_WINDOW_MS = 10;
/** 只保留最近一段 Event id；Projection 消费后的完整 Event 不驻留内存。 */
const MAX_SEEN_EVENT_IDS = 10_000;
const emptyBucket = (): ClientSessionProjection =>
  new ClientSessionProjection({
    applyEvent,
    applyReplySnapshot,
  });

function bucket(sid: string): ClientSessionProjection {
  let b = sessionProjections.get(sid);
  if (!b) sessionProjections.set(sid, (b = emptyBucket()));
  return b;
}

const last = <T>(arr: T[]): T | undefined => arr[arr.length - 1];

function appendBase64Chunk(current: string, incoming: string): string {
  if (!current) return incoming;
  if (!incoming) return current;
  try {
    return btoa(atob(current) + atob(incoming));
  } catch {
    // Keep the raw stream visible even if a provider sends non-base64 data.
    return current + incoming;
  }
}

/** 从内容块提取 Assistant 可检索的聚合文本。 */
function extractFromBlocks(blocks: ContentBlock[]): { text: string } {
  let text = "";
  for (const b of blocks) {
    if (b.type === "text") text += b.text;
  }
  return { text };
}

function toolOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && output.every((part) => part?.type === "text")) {
    return output.map((part) => String(part.text ?? "")).join("");
  }
  return JSON.stringify(output ?? "", null, 2);
}

/** 将 AgentEvent 的图片附件转换为聊天消息可直接渲染的地址。 */
function toMessageAttachments(raw: unknown): MessageAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): MessageAttachment[] => {
    if (!item || typeof item !== "object") return [];
    const attachment = item as Record<string, unknown>;
    if (attachment.type !== "image" || typeof attachment.mime_type !== "string") {
      return [];
    }
    const data = attachment.data;
    const path = attachment.path;
    const url = typeof data === "string"
      ? `data:${attachment.mime_type};base64,${data}`
      : typeof path === "string"
        ? `${API_BASE}/api/images/${encodeURIComponent(path.split(/[\\/]/).pop() || path)}`
        : "";
    if (!url) return [];
    return [{
      type: "image",
      url,
      mime: attachment.mime_type,
      name: typeof attachment.name === "string" ? attachment.name : undefined,
      bytes: typeof data === "string" ? Math.floor(data.length * 0.75) : undefined,
    }];
  });
}

/** 将 ftre-inbox 的权威 session/queue 投影为队列横幅数据。 */
export function applyQueueSnapshot(
  b: SessionProjectionState,
  payload: QueueSnapshotPayload,
): void {
  const revision = (b.sessionRevision ?? -1) + 1;
  const previousByRequestId = new Map(
    (b.pendingMessages ?? []).map((item) => [canonicalRequestId(item.request_id), item]),
  );
  const pending = payload.items.map((item, index): QueueItemView => ({
    request_id: item.id,
    sequence: index + 1,
    content: item.message.content.map((part) => part.text).join(""),
    attachments: item.message.attachments,
    source: item.placement === "context" ? "plugin" : "user",
    // 如果这条服务端队列项是本地刚发出的消息，保留“等待持久回显”标记。
    // 它下一张快照可能已经不在 pending（已被 worker claim），但 USER_MESSAGE
    // 事件尚未到达前仍必须留在横幅，避免“消失→突然出现”的视觉空窗。
    ...(previousByRequestId.get(canonicalRequestId(item.id))?.optimistic
      || previousByRequestId.get(canonicalRequestId(item.id))?.awaitingEcho
      ? { awaitingEcho: true }
      : {}),
  }));
  // 网络上可能先到达旧快照，而刚点发送的本地请求尚未收到 durable ACK。
  // 只保留尚未确认的本地 request_id，已确认项目完全以后端 pending 为准。
  const serverRequestIds = new Set(
    pending
       .map((item) => canonicalRequestId(item.request_id))
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const awaitingAdmission = (b.pendingMessages ?? []).filter((item) => (
    (item.optimistic || item.awaitingEcho)
    && !serverRequestIds.has(canonicalRequestId(item.request_id))
  ));
  const pendingMessages = [...pending, ...awaitingAdmission];
  const queueDepth = pendingMessages.length;
  b.hasCoordinatorState = true;
  b.sessionRevision = revision;
  b.queueDepth = queueDepth;
  // Inbox snapshot 不包含容量和 active 状态；这些字段由本地配置和 session/status
  // 分别维护，队列事件只能替换 pending 事实。
  b.queueCapacity = b.queueCapacity ?? null;
  // 已接纳项目完全以后端 Inbox items 为准；尚未 ACK 的本地预览仅暂存于
  // 横幅，直到被同 request_id 的服务端项替换。它们绝不进入聊天 messages。
  b.pendingMessages = pendingMessages;
  b.clientCanSend = b.clientCanSend ?? true;
  b.canCancel = b.canCancel ?? false;
  b.blockedReason = b.blockedReason ?? null;
  b.isBusy = b.isBusy || queueDepth > 0;
  if (b.sessionStatus === "idle" && queueDepth === 0) {
    b.isBusy = false;
    b.commandName = null;
    b.turnStartTs = null;
  }
}
function replySnapshotToChatMessage(raw: any): ChatMessage | null {
  if (!raw || raw.role !== "assistant" || !Array.isArray(raw.content) || !raw.id) {
    return null;
  }
  const blocks: ContentBlock[] = [];
  const toolResults: Record<string, ToolResult> = {};
  for (const block of raw.content) {
    if (block?.type === "text") {
      blocks.push({ type: "text", text: String(block.text ?? ""), blockId: String(block.id ?? "") });
    } else if (block?.type === "thinking") {
      blocks.push({ type: "thinking", thinking: String(block.thinking ?? ""), blockId: String(block.id ?? "") });
    } else if (block?.type === "data" && block.source) {
      blocks.push({
        type: "data",
        data: String(block.source.data ?? ""),
        url: block.source.type === "url" ? block.source.url : undefined,
        mediaType: block.source.media_type ?? "application/octet-stream",
        blockId: String(block.id ?? ""),
      });
    } else if (block?.type === "tool_call") {
      const id = String(block.id ?? "");
      const existingIndex = id
        ? blocks.findIndex((item) => item.type === "toolCall" && item.id === id)
        : -1;
      if (existingIndex >= 0) {
        const existing = blocks[existingIndex];
        if (existing.type === "toolCall" && !existing.name && block.name) {
          blocks[existingIndex] = { ...existing, name: String(block.name) };
        }
      } else {
        blocks.push({
          type: "toolCall",
          id,
          name: String(block.name ?? ""),
          arguments: block.arguments && typeof block.arguments === "object" ? block.arguments : {},
        });
      }
      // 待确认工具调用（state==="asking"）在快照里没有配对 tool_result，
      // 合成一个 asking ToolResult，让确认卡片在刷新/重连后仍可渲染。
      // reason 未持久化，卡片用通用文案。
      if (block.state === "asking" && id) {
        toolResults[id] = {
          id,
          name: String(block.name ?? ""),
          result: null,
          error: null,
          status: "asking",
          confirm: {},
        };
      } else if (block.state === "finished" && id) {
        // 批量确认尚未全部完成时，已拒绝调用只有 finished 状态，
        // 配对的 denied 结果要等最后一个确认后才生成。
        toolResults[id] = {
          id,
          name: String(block.name ?? ""),
          result: null,
          error: null,
          status: "denied",
        };
      }
    } else if (block?.type === "tool_result") {
      const state = String(block.state ?? "success");
      const failed = ["error", "interrupted"].includes(state);
      const denied = state === "denied";
      const id = String(block.id ?? "");
      toolResults[id] = {
        id,
        name: String(block.name ?? ""),
        result: failed || denied ? null : toolOutputText(block.output),
        error: failed ? toolOutputText(block.output) : null,
        status: denied
          ? "denied"
          : state === "interrupted"
          ? "cancelled"
          : failed ? "error" : "completed",
        metadata: block.metadata,
      };
    }
  }
  const { text } = extractFromBlocks(blocks);
  const parsedTimestamp = typeof raw.created_at === "string" ? Date.parse(raw.created_at) : NaN;
  const metadata = raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
  return {
    id: String(raw.id),
    role: "assistant",
    content: text || null,
    timestamp: Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now(),
    blocks,
    toolResults,
    streaming: raw.finished_at == null,
    metadata,
    model: typeof metadata.model === "string" ? metadata.model : undefined,
    token: raw.token ?? undefined,
    isError: raw.finished_reason === "error" || !!raw.error,
    error: raw.error && typeof raw.error === "object" && typeof raw.error.message === "string"
      ? { code: typeof raw.error.code === "string" ? raw.error.code : undefined, message: raw.error.message }
      : undefined,
  };
}

/** 应用 attach/reconnect 的完整进行中 Msg 快照。 */
export function applyReplySnapshot(b: SessionProjectionState, payload: ReplySnapshotPayload): void {
  // 每次 WebSocket 重连都开始一个新的权威 revision 世代。Gateway 重启会重建
  // 内存计数，因此新连接快照不能继续与旧连接的 revision 比较；但同一连接内
  // 的重复快照仍然保持单调递增。
  const connectionEpoch = payload.client_connection_epoch;
  if (
    typeof connectionEpoch === "number"
    && connectionEpoch !== b.snapshotConnectionEpoch
  ) {
    b.snapshotConnectionEpoch = connectionEpoch;
    b.replyRevisions = new Map<string, number>();
    b.sessionRevision = -1;
  }

  const replies = payload.replies;
  const revisions = b.replyRevisions ?? (b.replyRevisions = new Map<string, number>());
  for (const reply of replies) {
    const replyId = reply.reply_id;
    const revision = reply.revision;
    const message = replySnapshotToChatMessage(reply.message);
    if (!replyId || !message || !Number.isFinite(revision)) continue;
    // 后端使用 reply_id 作为 assistant Msg id；客户端保持相同约束，后续流式
    // Event 才能稳定找到并继续更新这条快照消息。
    message.id = replyId;
    const previousRevision = revisions.get(replyId);
    if (previousRevision != null && revision <= previousRevision) continue;
    revisions.set(replyId, revision);

    const index = b.messages.findIndex((item) => item.id === replyId);
    if (index >= 0) {
      const next = b.messages.slice();
      next[index] = message;
      b.messages = next;
    } else {
      b.messages = [...b.messages, message].sort((a, z) => a.timestamp - z.timestamp);
    }
    if (!b.hasCoordinatorState) {
      b.isBusy = message.streaming || b.isBusy;
    }
    if (message.streaming) {
      if (!b.hasCoordinatorState) {
        b.sessionStatus = "running";
        b.sessionActivity = "executing";
        b.clientCanSend = true;
        b.canCancel = true;
      }
      if (b.turnStartTs == null) b.turnStartTs = message.timestamp;
    }
  }

  // session 级 active Event（例如 context_compact_start）同样由 Projection
  // 快照恢复。使用原 Event id 走正常 reducer，保证与实时帧使用相同去重语义。
  for (const event of payload.events ?? []) {
    if (!event?.type) continue;
    const snapshotEvent: BusEvent = {
      type: event.type,
      eventId: typeof event.id === "string" ? event.id : undefined,
      data: event,
      ts: typeof event.created_at === "string" ? Date.parse(event.created_at) : undefined,
    };
    if (hasSeenEvent(b, snapshotEvent)) continue;
    applyEvent(b, snapshotEvent);
  }

}



/** 褰?sid === activeId 鏃讹紝鎶?bucket 瀛楁闀滃儚鍒?store 椤跺眰銆?*/
function mirror(sid: string): void {
  if (useChat.getState().sessionId !== sid) return;
  const b = sessionProjections.get(sid);
  if (!b) return;
  useChat.setState({
    messages: b.messages,
    isBusy: b.isBusy,
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

// 鈹€鈹€鈹€ ID gen 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

let _idc = 0;
const nextId = (p = "msg") => `${p}_${Date.now()}_${++_idc}`;

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

/** 将前端已发出、尚未收到服务器快照的消息投影为队列横幅项。 */
function pendingPreview(item: PendingNewSessionSend): QueueItemView {
  return {
    request_id: `local:${item.frameId}`,
    sequence: 0,
    content: item.displayText,
    attachments: item.attachments?.map((attachment) => ({ ...attachment })),
    source: "user",
    optimistic: true,
  };
}

function canonicalRequestId(requestId: string): string {
  return requestId.startsWith("local:") ? requestId.slice("local:".length) : requestId;
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

// 鈹€鈹€鈹€ Event Reducer 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
//
// 鍚屾椂鏈嶅姟浜?ws 瀹炴椂浜嬩欢 鍜?history 鍥炴斁銆?// 璋冪敤鏂圭害鏉燂細姣忔鍙鐞嗕竴涓?event锛涜皟鐢ㄥ悗 bucket 瀛楁鏄柊寮曠敤锛堟暟缁勭骇 immutable锛夈€?
export interface BusEvent {
  type: string;
  data?: any;
  ts?: number;
  eventId?: string;
  /** ws 实时下行帧的帧 ID（BusMessage.id），用于回放去重 */
  frameId?: string;
  /** ws 实时下行帧的 metadata；request_id 用于请求相关性和去重。 */
  metadata?: Record<string, any>;
}

function eventDedupKey(ev: BusEvent): string | null {
  const topLevel = ev.eventId;
  if (typeof topLevel === "string" && topLevel) return topLevel;
  return typeof ev.frameId === "string" && ev.frameId ? ev.frameId : null;
}

function seenEventIds(b: SessionProjectionState): Set<string> {
  if (!b.seenEventIds) b.seenEventIds = new Set<string>();
  return b.seenEventIds;
}

function hasSeenEvent(b: SessionProjectionState, ev: BusEvent): boolean {
  const key = eventDedupKey(ev);
  return !!key && seenEventIds(b).has(key);
}

function rememberEvent(b: SessionProjectionState, ev: BusEvent): boolean {
  const key = eventDedupKey(ev);
  if (!key) return true;
  const seen = seenEventIds(b);
  if (seen.has(key)) return false;
  seen.add(key);
  if (seen.size > MAX_SEEN_EVENT_IDS) {
    const oldest = seen.values().next().value;
    if (typeof oldest === "string") seen.delete(oldest);
  }
  return true;
}

export function applyEvent(b: SessionProjectionState, ev: BusEvent): void {
  if (!rememberEvent(b, ev)) return;
  const d = ev.data || {};
  const ts = ev.ts ?? Date.now();
  const replyId = typeof d.reply_id === "string" && d.reply_id ? d.reply_id : null;

  /** 褰撳墠 streaming 灏鹃儴 assistant锛堣嫢瀛樺湪锛?*/
  const tail = (): ChatMessage | null => {
    const m = last(b.messages);
    return m && m.role === "assistant" && m.streaming && !m.isError ? m : null;
  };

  /** 鏇挎崲 tail锛堜繚鐣欏紩鐢ㄨ涔夛細mutator 鎷垮埌鐨勬槸鏂板璞★紝澶嶅埗鍘熷瓧娈碉級 */
  const replaceTail = (mut: (m: ChatMessage) => ChatMessage): void => {
    const i = b.messages.length - 1;
    if (i < 0) return;
    const next = b.messages.slice();
    next[i] = mut(next[i]);
    b.messages = next;
  };

  const replyIndex = (): number => replyId == null
    ? -1
    : b.messages.findIndex((message) => message.id === replyId && message.role === "assistant");

  const replaceReply = (mut: (m: ChatMessage) => ChatMessage): void => {
    const index = replyIndex();
    if (index < 0) return;
    const next = b.messages.slice();
    next[index] = mut(next[index]);
    b.messages = next;
  };

  /** 确保尾部存在可写的流式 assistant；不存在或已经封口时创建一条。 */
  const ensure = (): void => {
    const index = replyIndex();
    if (index >= 0) return;
    b.messages = [
      ...b.messages,
      {
        id: replyId ?? ev.eventId ?? ev.frameId ?? nextId("ast"),
        role: "assistant",
        content: null,
        timestamp: ts,
        streaming: true,
        blocks: [],
        toolResults: {},
      },
    ];
  };

  const appendTextBlock = (
    kind: "text" | "thinking",
    blockId: string,
    delta = "",
  ): void => {
    ensure();
    replaceReply((message) => {
      const blocks = [...(message.blocks || [])];
      const index = blocks.findIndex(
        (block) => block.type === kind && block.blockId === blockId,
      );
      if (index < 0) {
        blocks.push(
          kind === "text"
            ? { type: "text", text: delta, blockId }
            : { type: "thinking", thinking: delta, blockId },
        );
      } else {
        const block = blocks[index];
        blocks[index] = block.type === "text"
          ? { ...block, text: block.text + delta }
          : block.type === "thinking"
            ? { ...block, thinking: block.thinking + delta }
            : block;
      }
      const { text } = extractFromBlocks(blocks);
      return { ...message, blocks, content: text || null };
    });
  };

  const appendDataBlock = (
    blockId: string,
    mediaType: string,
    delta = "",
  ): void => {
    ensure();
    replaceReply((message) => {
      const blocks = [...(message.blocks || [])];
      const index = blocks.findIndex(
        (block) => block.type === "data" && block.blockId === blockId,
      );
      if (index < 0) {
        blocks.push({ type: "data", data: delta, mediaType, blockId });
      } else {
        const block = blocks[index];
        if (block.type === "data") {
          blocks[index] = {
            ...block,
            data: appendBase64Chunk(block.data, delta),
            mediaType: mediaType || block.mediaType,
          };
        }
      }
      const { text } = extractFromBlocks(blocks);
      return { ...message, blocks, content: text || null };
    });
  };

  const updateToolResult = (
    toolCallId: string,
    mutate: (current: ToolResult) => ToolResult,
  ): void => {
    for (let index = b.messages.length - 1; index >= 0; index--) {
      const message = b.messages[index];
      const toolCall = message.blocks?.find(
        (block) => block.type === "toolCall" && block.id === toolCallId,
      );
      if (!toolCall || toolCall.type !== "toolCall") continue;
      const current = message.toolResults?.[toolCallId] ?? {
        id: toolCallId,
        name: toolCall.name,
        result: "",
        error: null,
        status: "running" as const,
      };
      const messages = [...b.messages];
      messages[index] = {
        ...message,
        toolResults: {
          ...(message.toolResults || {}),
          [toolCallId]: mutate(current),
        },
      };
      b.messages = messages;
      return;
    }
  };

  const attachHiddenImageToLatestReadTool = (): void => {
    if (!d.metadata?.hide || !Array.isArray(d.content)) return;
    if (!d.content.some((p: any) => p?.type === "image_file" && typeof p.path === "string")) return;

    for (let i = b.messages.length - 1; i >= 0; i--) {
      const msg = b.messages[i];
      if (!msg.blocks) continue;
      const toolCallBlock = msg.blocks.find(
        (bl) => bl.type === "toolCall" && (bl.name === "read" || bl.name === "read_file")
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
            result: JSON.stringify(d),
            error: null,
            status: "completed" as const,
          },
        },
      };
      b.messages = nextMessages;
      return;
    }
  };

  switch (ev.type) {
    // ─── 实时 echo：后端保存 UserMsg 后回推给客户端 ───
    case UserMessageEventType: {
      // UserMessageEvent 是消息真正写入 messages 后的回显；队列中的请求不在此处造气泡。
      const input = d.data && typeof d.data === "object" ? d.data : {};
      if (input.metadata?.hide) {
        attachHiddenImageToLatestReadTool();
        return;
      }
      b.lastUserInputTs = ts;
      const content = typeof input.content === "string"
        ? input.content
        : Array.isArray(input.content)
          ? input.content
              .filter((part: any) => part?.type === "text" || part?.type === "skill")
              .map((part: any) => String(part.text ?? part.data ?? "").trim())
              .join("\n")
              .trim()
          : "";
      const attachments = toMessageAttachments(input.attachments);
      if (!content && attachments.length === 0) return;

      const messageId = typeof d.id === "string" && d.id
        ? d.id
        : ev.frameId || nextId("user");
      const requestId = typeof ev.metadata?.request_id === "string"
        ? ev.metadata.request_id
        : typeof input.request_id === "string"
          ? input.request_id
          : undefined;
      // 用户消息已经由后端持久化并开始实时回显；此刻才是从横幅移入聊天记录的
      // 唯一交接点。先移除同一 request_id 的队列项，避免重复展示。
      if (requestId) {
        const canonical = canonicalRequestId(requestId);
        b.pendingMessages = (b.pendingMessages ?? []).filter(
          (item) => canonicalRequestId(item.request_id) !== canonical,
        );
        b.queueDepth = b.pendingMessages.length;
      }
      const nextMessage: ChatMessage = {
        id: messageId,
        role: "user",
        content,
        timestamp: ts,
        ...(attachments.length > 0 ? { attachments } : {}),
        metadata: input.metadata && typeof input.metadata === "object"
          ? input.metadata
          : undefined,
      };
      if (b.messages.some((message) => message.id === messageId)) return;
      b.messages = [
        ...b.messages,
        nextMessage,
      ];
      return;
    }
    case "REPLY_START": {
      ensure();
      if (!b.hasCoordinatorState) {
        b.isBusy = true;
        b.sessionStatus = "running";
        b.sessionActivity = "executing";
        b.clientCanSend = true;
        b.canCancel = true;
      }
      b.retryState = null;
      return;
    }

    case "REPLY_END": {
      ensure();
      const replyError = d.error;
      const replyErrorMessage = replyError
        ? typeof replyError === "string"
          ? replyError
          : String(replyError.message || replyError.code || "Agent reply failed")
        : null;
      replaceReply((message) => ({
        ...message,
        id: d.reply_id || message.id,
        streaming: false,
        isError: d.finished_reason === "error" || !!replyError,
        error: replyErrorMessage
          ? {
              code: typeof replyError?.code === "string" ? replyError.code : undefined,
              message: replyErrorMessage,
            }
          : message.error,
      }));
      b.retryState = null;
      if (replyErrorMessage) b.error = replyErrorMessage;
      return;
    }

    case "TEXT_BLOCK_START":
      appendTextBlock("text", d.block_id);
      return;

    case "TEXT_BLOCK_DELTA":
      appendTextBlock("text", d.block_id, d.delta || "");
      return;

    case "TEXT_BLOCK_END":
      return;

    case "DATA_BLOCK_START":
      appendDataBlock(d.block_id, d.media_type || "application/octet-stream");
      return;

    case "DATA_BLOCK_DELTA":
      appendDataBlock(
        d.block_id,
        d.media_type || "application/octet-stream",
        d.data || "",
      );
      return;

    case "DATA_BLOCK_END":
      return;

    case "THINKING_BLOCK_START":
      appendTextBlock("thinking", d.block_id);
      return;

    case "THINKING_BLOCK_DELTA":
      appendTextBlock("thinking", d.block_id, d.delta || "");
      return;

    case "THINKING_BLOCK_END":
      return;

    case "HINT_BLOCK":
      // HintBlock 是 Agent 内部续跑/调度提示，会进入下一次模型上下文，
      // 但不属于面向用户的 assistant 输出。
      return;

    case "MODEL_CALL_START":
      ensure();
      if (typeof d.model_name === "string" && d.model_name) {
        replaceReply((message) => ({ ...message, model: d.model_name }));
      }
      return;

    case "MODEL_CALL_END":
      ensure();
      replaceReply((message) => {
        const current = {
          prompt_tokens: d.prompt_tokens || 0,
          completion_tokens: d.completion_tokens || 0,
          total_tokens: d.total_tokens || 0,
        };
        const previous = message.token?.usage;
        return {
          ...message,
          token: {
            usage: previous
              ? {
                  prompt_tokens: previous.prompt_tokens + current.prompt_tokens,
                  completion_tokens: previous.completion_tokens + current.completion_tokens,
                  total_tokens: previous.total_tokens + current.total_tokens,
                }
              : { ...current },
            last_call_usage: { ...current },
          },
        };
      });
      return;

    case "TOOL_CALL_START":
      ensure();
      replaceReply((message) => {
        const blocks = [...(message.blocks || [])];
        const existing = blocks.find(
          (block) => block.type === "toolCall" && block.id === d.tool_call_id,
        );
        if (existing?.type === "toolCall") {
          // TOOL_CALL_START 可能在重试/回放时重复到达；tool_call_id 是调用身份，
          // 同一 reply 内必须保持一个 block，后续 DELTA/END 继续更新它。
          if (existing.name || !d.tool_call_name) return message;
          return {
            ...message,
            blocks: blocks.map((block) => block === existing
              ? { ...block, name: d.tool_call_name }
              : block),
          };
        }
        blocks.push({
          type: "toolCall",
          id: d.tool_call_id,
          name: d.tool_call_name || "",
          arguments: {},
          argumentsText: "",
        });
        return { ...message, blocks };
      });
      return;

    case "TOOL_CALL_DELTA":
      ensure();
      replaceReply((message) => ({
        ...message,
        blocks: (message.blocks || []).map((block) => {
          if (block.type !== "toolCall" || block.id !== d.tool_call_id) return block;
          const argumentsText = (block.argumentsText || "") + (d.delta || "");
          let args = block.arguments;
          try {
            const parsed = JSON.parse(argumentsText);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
          } catch {
            // Partial JSON is expected while arguments are streaming.
          }
          return { ...block, arguments: args, argumentsText };
        }),
      }));
      return;

    case "TOOL_CALL_END":
      ensure();
      replaceReply((message) => ({
        ...message,
        blocks: (message.blocks || []).map((block) => {
          if (block.type !== "toolCall" || block.id !== d.tool_call_id) return block;
          const { argumentsText: _argumentsText, ...finished } = block;
          return finished;
        }),
      }));
      return;

    case "TOOL_RESULT_START":
      return;

    case "TOOL_RESULT_TEXT_DELTA":
      updateToolResult(d.tool_call_id, (current) => ({
        ...current,
        result: (current.result || "") + (d.delta || ""),
      }));
      return;

    case "TOOL_RESULT_DATA_DELTA": {
      const payload = d.data ?? d.url;
      if (payload != null) {
        updateToolResult(d.tool_call_id, (current) => ({
          ...current,
          result: (current.result || "") + String(payload),
        }));
      }
      return;
    }

    case "TOOL_RESULT_END":
      updateToolResult(d.tool_call_id, (current) => {
        const isError = d.state === "error";
        const isCancelled = d.state === "interrupted";
        const isDenied = d.state === "denied";
        const metadata = d.metadata || {};
        return {
          ...current,
          error: isError
            ? String(metadata.error || metadata.message || current.result || "Tool execution failed")
            : null,
          status: isDenied ? "denied" : isCancelled ? "cancelled" : isError ? "error" : "completed",
          metadata,
        };
      });
      return;

    // ─── 工具权限确认：命中 ASK，等待用户批准/拒绝 ───
    // 后端已把对应 ToolCallBlock.state 置为 asking 并持久化；这里在客户端
    // 合成一个 status="asking" 的 ToolResult 承载确认上下文，供卡片渲染按钮。
    case "REQUIRE_USER_CONFIRM": {
      const toolCallId = typeof d.tool_call_id === "string" ? d.tool_call_id : "";
      if (!toolCallId || !replyId) return;
      updateToolResult(toolCallId, (current) => ({
        ...current,
        result: null,
        error: null,
        status: "asking",
        confirm: {
          reason: typeof d.reason === "string" ? d.reason : undefined,
          ruleId: typeof d.rule_id === "string" ? d.rule_id : undefined,
        },
      }));
      return;
    }

    // 后端已接受并持久化本次决定后再更新卡片，避免发送失败时乐观状态
    // 吞掉确认按钮。多 ASK 场景下，其他卡片仍保持 asking。
    case "USER_CONFIRM_RESULT": {
      const toolCallId = typeof d.tool_call_id === "string" ? d.tool_call_id : "";
      if (!toolCallId) return;
      updateToolResult(toolCallId, (current) => ({
        ...current,
        result: d.approved ? "" : current.result,
        error: null,
        status: d.approved ? "running" : "denied",
        confirm: undefined,
      }));
      return;
    }

    case "EXCEED_MAX_ITERS": {
      const message = "Agent exceeded the maximum number of iterations";
      b.messages = [
        ...b.messages,
        { id: ev.eventId ?? nextId("err"), role: "assistant", content: message, timestamp: ts, isError: true },
      ];
      b.error = message;
      return;
    }

    case "external_message": {
      const text = typeof d.content === "string" ? d.content : "";
      const fromCh = typeof d.from_channel === "string" ? d.from_channel : "";
      const fromSid = typeof d.from_session === "string" ? d.from_session : "";
      const inserted: ChatMessage = {
        id: ev.frameId ?? nextId("ext"),
        role: "assistant",
        content: text,
        timestamp: ts,
        blocks: text ? [{ type: "text", text, blockId: ev.eventId ?? ev.frameId ?? nextId("ext-block") }] : [],
        toolResults: {},
        external: true,
        externalFrom: fromCh || fromSid ? `${fromCh}::${fromSid}` : undefined,
      };
      const i = b.messages.length - 1;
      const tailMsg = i >= 0 ? b.messages[i] : null;
      b.messages = tailMsg?.streaming
        ? [...b.messages.slice(0, i), inserted, tailMsg]
        : [...b.messages, inserted];
      return;
    }


    // 鈹€鈹€鈹€ 宸ュ叿缁撴灉锛氫粠灏鹃儴寰€鍓嶆壘鍒板搴?tc 鍐欏叆 鈹€鈹€鈹€
    case "CUSTOM": {
      const phase = d.name;
      const phaseData = d.value || {};
      if (phase === "PIPELINE_START") {
        // pipeline 开始：立即标记忙
        if (!b.hasCoordinatorState) {
          b.isBusy = true;
          b.sessionStatus = "running";
          b.sessionActivity = "dispatching";
          b.clientCanSend = true;
          b.canCancel = true;
        }
        b.error = null;
        return;
      }
      if (phase === "PIPELINE_END") {
        // pipeline 结束：恢复空闲，清除 Turn 级临时状态
        if (!b.hasCoordinatorState) {
          b.isBusy = false;
          b.sessionStatus = "idle";
          b.sessionActivity = "idle";
          b.canCancel = false;
        }
        b.commandName = null;
        return;
      }
      if (phase === "COMMAND_MATCHED") {
        // 指令命中：状态栏更新为"执行指令..."
        if (!b.hasCoordinatorState) {
          b.isBusy = true;
          b.sessionStatus = "running";
          b.sessionActivity = "dispatching";
          b.canCancel = true;
        }
        b.commandName = phaseData.command_name ?? null;
        return;
      }
      if (phase === "TURN_START") {
        if (!b.hasCoordinatorState) {
          b.isBusy = true;
          b.sessionStatus = "running";
          b.sessionActivity = "executing";
          b.clientCanSend = true;
          b.canCancel = true;
        }
        b.error = null;
        b.retryState = null;
        b.commandName = null; // 进入 agent 执行，清除指令标记
        b.turnStartTs = ts ?? null;
        return;
      }
      // ── 上下文压缩事件（CustomEvent，与后端 compact done 投影的 Msg 同 id）──
      if (phase === CompactEventName.START) {
        if (!b.hasCoordinatorState) {
          b.isBusy = true;
          b.sessionStatus = "compacting";
          b.sessionActivity = "compacting";
          b.clientCanSend = false;
          b.canCancel = false;
        }
        b.messages = [
          ...b.messages,
          {
            id: ev.eventId ?? nextId("compact"),
            role: "system" as Role,
            content: null,
            timestamp: ts,
            compact: {
              status: "running",
              model: typeof phaseData.model === "string" && phaseData.model
                ? phaseData.model
                : undefined,
              tokensBefore: typeof phaseData.tokens === "number" ? phaseData.tokens : undefined,
            },
          },
        ];
        return;
      }
      if (phase === CompactEventName.DONE) {
        if (!b.hasCoordinatorState) {
          b.isBusy = false;
          b.sessionStatus = "idle";
          b.sessionActivity = "idle";
          b.clientCanSend = true;
          b.canCancel = false;
        }
        // 用 event id 作为气泡 id，与后端投影的 compact Msg id 一致
        const compactId = ev.eventId ?? nextId("compact");
        const doneCompact = {
          status: "done" as const,
          mode: typeof phaseData.mode === "string" ? phaseData.mode : "summary",
          tokensBefore: typeof phaseData.tokens_before === "number" ? phaseData.tokens_before : undefined,
          tokensAfter: typeof phaseData.tokens_after === "number" ? phaseData.tokens_after : undefined,
          summaryPreview: typeof phaseData.summary_text === "string" ? phaseData.summary_text : undefined,
          eventsCleared: typeof phaseData.tool_results === "number" ? phaseData.tool_results : undefined,
          toolResults: typeof phaseData.tool_results === "number" ? phaseData.tool_results : undefined,
        };
        let foundRunning = false;
        for (let i = b.messages.length - 1; i >= 0; i--) {
          const m = b.messages[i];
          if (m.compact?.status === "running") {
            b.messages = [
              ...b.messages.slice(0, i),
              { ...m, id: compactId, compact: doneCompact },
              ...b.messages.slice(i + 1),
            ];
            foundRunning = true;
            break;
          }
        }
        if (!foundRunning) {
          b.messages = [
            ...b.messages,
            {
              id: compactId,
              role: "system" as Role,
              content: null,
              timestamp: ts,
              compact: doneCompact,
            },
          ];
        }
        return;
      }
      if (phase === CompactEventName.FAILED) {
        if (!b.hasCoordinatorState) {
          b.isBusy = false;
          b.sessionStatus = "idle";
          b.sessionActivity = "idle";
          b.clientCanSend = true;
          b.canCancel = false;
        }
        for (let i = b.messages.length - 1; i >= 0; i--) {
          const m = b.messages[i];
          if (m.compact?.status === "running") {
            b.messages = [
              ...b.messages.slice(0, i),
              {
                ...m,
                compact: {
                  status: "failed" as const,
                  reason: typeof phaseData.reason === "string" ? phaseData.reason : "未知原因",
                },
              },
              ...b.messages.slice(i + 1),
            ];
            break;
          }
        }
        return;
      }
      if (phase !== "TURN_END") return;

      replaceTail((m) => m.streaming ? { ...m, streaming: false } : m);
      if (!b.hasCoordinatorState) {
        b.isBusy = false;
        b.sessionStatus = "idle";
        b.sessionActivity = "idle";
        b.canCancel = false;
      }
      b.retryState = null;

      // 计算耗时并写入本轮最后一条 assistant 消息
      if (b.turnStartTs != null && ts != null) {
        const durationSec = Math.round((ts - b.turnStartTs) / 1000);
        for (let i = b.messages.length - 1; i >= 0; i--) {
          if (b.messages[i].role === "assistant" && !b.messages[i].streaming) {
            b.messages[i] = { ...b.messages[i], durationSec };
            break;
          }
        }
        b.turnStartTs = null;
      }

      if (phaseData.reason === "error" && phaseData.error_message) {
        const msg: string = phaseData.error_message;
        const code = phaseData.error_code;
        let attached = false;
        for (let index = b.messages.length - 1; index >= 0; index--) {
          const message = b.messages[index];
          if (message.role !== "assistant" || message.external) continue;
          const next = b.messages.slice();
          next[index] = {
            ...message,
            isError: true,
            error: message.error ?? {
              code: typeof code === "string" ? code : undefined,
              message: msg,
            },
          };
          b.messages = next;
          attached = true;
          break;
        }
        if (!attached) {
          b.messages = [
            ...b.messages,
            {
              id: ev.frameId ?? nextId("err"),
              role: "assistant",
              content: null,
              timestamp: ts,
              isError: true,
              error: {
                code: typeof code === "string" ? code : undefined,
                message: msg,
              },
            },
          ];
        }
        b.error = code ? `[${code}] ${msg}` : msg;
      }
      return;
    }

    case "retry": {
      b.retryState = { attempt: d.attempt, maxAttempts: d.max_attempts, message: d.message };
      return;
    }

  }
}

// 鈹€鈹€鈹€ WS Wiring 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
//
// 妯″潡绾ф敞鍐岀殑 handler 鍦?dev hmr 閲嶆柊鎵ц妯″潡鏃朵細琚噸澶?push銆?// 鐢?guard 淇濊瘉鍏ㄧ敓鍛藉懆鏈熷彧娉ㄥ唽涓€娆★紝閬垮厤姣忔潯 ws 浜嬩欢琚鐞嗗娆★紙鍏稿瀷鐥囩姸锛?// 娴佸紡鏂囨湰鐪嬭捣鏉?閲嶅杈撳嚭"锛屽疄闄呮槸 reducer 璺戜簡涓ら亶锛夈€?//
// 鍚庡彴鑺傛祦锛歐indows 涓嬪垏鍒板悗鍙版椂 Chromium 浼氳妭娴?timer锛?
// 浣?WebSocket 娑堟伅涓嶅彈褰卞搷鎸佺画娑屽叆 鈫?mirror() 鏀掔Н澶ч噺 React setState銆?
// 鐢?Page Visibility API锛氬悗鍙版椂鍙叆妗朵笉 mirror锛屽洖鍓嶅彴涓€鎶婂埛鏂般€?
const __wsBoundFlag = "__ftreChatWsBound__";
if (!(globalThis as any)[__wsBoundFlag]) {
  (globalThis as any)[__wsBoundFlag] = true;

  let pageHidden = typeof document !== "undefined" ? document.hidden : false;

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      const wasHidden = pageHidden;
      pageHidden = document.hidden;
      if (wasHidden && !pageHidden) {
        // 鍒囧洖鍓嶅彴锛歠lush 鎵€鏈夋湭瀹屾垚鐨勬壒澶勭悊锛岄伩鍏嶆畫鐣?
        for (const sid of _wsBatches.keys()) {
          _flushWsBatch(sid);
        }
        const sid = useChat.getState().sessionId;
        if (sid) mirror(sid);
      }
    });
  }

  // 鈹€鈹€ WS 浜嬩欢寰壒澶勭悊锛氬悓涓€ session 鐨勮繛缁祦寮忎簨浠跺湪绐楀彛鍐呮敹闆嗭紝
  //    涓€鎶?apply + 涓€娆?mirror锛岄伩鍏?replay 鎵撳瓧鏈哄洖鏀?鈹€鈹€
  function _flushWsBatch(sid: string) {
    const timer = _wsFlushTimers.get(sid);
    if (timer) { clearTimeout(timer); _wsFlushTimers.delete(sid); }
    const events = _wsBatches.get(sid);
    if (!events || events.length === 0) return;
    _wsBatches.delete(sid);
    const b = bucket(sid);
    for (const ev of events) {
      b.apply(ev);
    }
    mirror(sid);
  }

  function _enqueueWsEvent(sid: string, b: ReturnType<typeof bucket>, busEvent: BusEvent) {
    const evType = busEvent.type;
    if (STREAM_TYPES.has(evType)) {
      let batch = _wsBatches.get(sid);
      if (!batch) { batch = []; _wsBatches.set(sid, batch); }
      batch.push(busEvent);
      const existing = _wsFlushTimers.get(sid);
      if (existing) clearTimeout(existing);
      _wsFlushTimers.set(sid, setTimeout(() => _flushWsBatch(sid), WS_BATCH_WINDOW_MS));
      return;
    }
    _flushWsBatch(sid);
    b.apply(busEvent);
    mirror(sid);
  }

  wsClient.onMessage((msg: ServerMessage) => {
    // 持久化接纳 ACK：补齐横幅本地占位的服务端 request_id。
    // ACK 不创建聊天气泡；USER_MESSAGE 回显才是进入聊天记录的唯一入口。
    const admissionAck = getMessageAckPayload(msg);
    if (admissionAck) {
      const sid = admissionAck.session_id || msg.metadata?.session_id;
      if (typeof sid === "string" && sid) {
        const b = bucket(sid);
        // Admission ACK 与 session.cancel 共用 RPC envelope；只有仍存在对应的
        // optimistic chat item 时才是本地聊天的 ACK。控制 ACK 不应把 Session
        // 错误地重新标记为 running。
        const hasPendingChat = (b.pendingMessages ?? []).some((item) => (
          item.optimistic
          && canonicalRequestId(item.request_id) === admissionAck.request_id
        ));
        if (!hasPendingChat) return;
        // sendMessage 已经把横幅项本地预显示；收到 durable ACK 后只补齐
        // 服务端 request_id，仍由下一张 session/queue 覆盖为最终事实。
        const transportRequestId = msg.request_id || "";
        b.pendingMessages = (b.pendingMessages ?? []).map((item) => (
          item.optimistic && (
            canonicalRequestId(item.request_id) === admissionAck.request_id
            || canonicalRequestId(item.request_id) === transportRequestId
          )
            ? {
              ...item,
              request_id: admissionAck.request_id,
              sequence: admissionAck.queue_position ?? item.sequence ?? 0,
              optimistic: false,
              awaitingEcho: true,
            }
            : item
        ));
        b.queueDepth = b.pendingMessages.length;
        // ACK 只证明请求已落盘；横幅项目仍以后续完整 pending 快照为准。
        b.isBusy = true;
        b.sessionStatus = "running";
        if (!b.hasCoordinatorState) b.sessionActivity = "dispatching";
        mirror(sid);
      }
      return;
    }
    const rpcError = getRpcErrorPayload(msg);
    if (rpcError) {
      const reason = rpcError.message || rpcError.code || "Request rejected";
      // 鍏虫帀瀵瑰簲 session 鐨?busy 鐘舵€?
      const sid = rpcError.session_id || msg.metadata?.session_id;
      if (typeof sid === "string" && sid) {
        const b = bucket(sid);
        const requestId = rpcError.request_id || msg.request_id || msg.metadata?.request_id;
        // 被服务端拒绝的本地队列项不能一直留在横幅；没有 request_id 的
        // 通用错误则不猜测删除哪一项。
        if (typeof requestId === "string" && requestId) {
        b.pendingMessages = (b.pendingMessages ?? []).filter(
            (item) => item.request_id !== requestId && item.request_id !== `local:${requestId}`,
          );
          b.queueDepth = b.pendingMessages.length;
        }
        if (!b.hasCoordinatorState) {
          b.isBusy = false;
          b.sessionStatus = "idle";
          b.sessionActivity = "idle";
          b.canCancel = false;
        }
        mirror(sid);
      }
      // 寮傛寮曞叆閬垮厤寰幆渚濊禆锛坣otification 鈫?chat 涓嶅簲璇ヨ缁戞锛?
      import("./notification")
        .then(({ useNotification }) => {
          useNotification.getState().addNotification({
            level: "error",
            message: reason,
          });
        })
        .catch(() => void 0);
      return;
    }

    const warningPayload = getSessionContextWarningPayload(msg);
    if (warningPayload) {
      import("./notification")
        .then(({ useNotification }) => {
          useNotification.getState().addNotification({
            level: "warning",
            message: warningPayload.message,
          });
        })
        .catch(() => void 0);
      return;
    }

    const commandPayload = getSessionCommandPayload(msg);
    if (commandPayload) {
      const sid = commandPayload.session_id || msg.metadata?.session_id;
      if (typeof sid === "string" && sid) {
        import("./notification")
          .then(({ useNotification }) => {
            useNotification.getState().addNotification({
              level: commandPayload.level === "error"
                ? "error"
                : commandPayload.level === "warning" ? "warning" : "info",
              message: commandPayload.content,
            });
          })
          .catch(() => void 0);
      }
      return;
    }

    const sessionEvent = getSessionEventPayload(msg);
    if (sessionEvent) {
      const sid = sessionEvent.session_id || msg.metadata?.session_id;
      if (typeof sid !== "string" || !sid) return;
      const b = bucket(sid);
      applyQueueSnapshot(b, sessionEvent);
      mirror(sid);
      return;
    }

    // attach/reconnect 同步进行中的完整 Msg；不是 AgentStreamEvent。
    if (isReplySnapshotMessage(msg)) {
      const payload = msg.payload as ReplySnapshotPayload;
      const sid = payload.session_id || msg.metadata?.session_id;
      if (typeof sid !== "string" || !sid) return;
      const b = bucket(sid);
      b.applySnapshot(payload);
      mirror(sid);
      return;
    }

    // 鍚庣鍦ㄩ鏉＄敤鎴锋秷鎭悗寮傛鐢熸垚鏍囬锛涘墠绔湁鑷繁鐨勪細璇濆垪琛ㄨ疆璇紝
    // 鎷垮埌鏂?title 鏄繜鏃╃殑浜嬶紝涓嶉渶瑕佷笓闂ㄧ殑 push 閫氱煡銆?
    // global_event锛氬叏灞€鎺у埗淇″彿锛坰ession 杩愯鎬佺瓑锛夛紝涓嶈繘 agent 浜嬩欢娴?
    const sessionStatus = getSessionStatusPayload(msg);
    if (sessionStatus) {
      const sid = sessionStatus.session_id || msg.metadata?.session_id;
      if (typeof sid !== "string" || !sid) return;
      const b = bucket(sid);
      if (!b.hasCoordinatorState) {
        const status = sessionStatus.status;
        b.sessionStatus = status;
        b.sessionActivity = status === "idle"
          ? "idle"
          : status === "compacting" ? "compacting" : "executing";
        b.isBusy = status !== "idle";
        b.clientCanSend = status !== "compacting";
        b.canCancel = status === "running";
        b.error = null;
        b.retryState = null;
      }
      mirror(sid);
      import("../stores/session")
        .then(({ useSession }) => useSession.getState().loadAllSessions())
        .catch(() => void 0);
      return;
    }

    if (msg.type !== "agent_event") return;
    const ev = msg.payload as AgentStreamEvent;
    if (!ev?.type) return;


    const sid = msg.metadata?.session_id as string | undefined;
    if (!sid) return;

    const isCoreEvent =
      ev.type === "retry" ||
      ev.type === "CUSTOM" ||
      /^[A-Z]+(?:_[A-Z]+)+$/.test(ev.type);
    const b = bucket(sid);
    const busEvent: BusEvent = {
      type: ev.type,
      eventId: ev.id,
      data: isCoreEvent ? ev : ((ev.data as Record<string, unknown> | undefined) || {}),
      ts: typeof ev.created_at === "string"
        ? Date.parse(ev.created_at)
        : typeof ev.timestamp === "number"
          ? ev.timestamp * 1000
          : undefined,
      frameId: msg.request_id,
      metadata: msg.metadata,
    };
    if (hasSeenEvent(b, busEvent)) return;
    // 鍏ユ《浜嬩欢缂撳瓨锛氬垎椤?/ refresh 閲嶆斁鏃惰鍥炲埌杩欐潯浜嬩欢娴?
    if (pageHidden) {
      b.apply(busEvent);
    } else {
      _enqueueWsEvent(sid, b, busEvent);
    }
    if (ev.type === "MODEL_CALL_END" && useChat.getState().sessionId === sid) {
      const promptTokens = Number(ev.prompt_tokens || 0);
      const completionTokens = Number(ev.completion_tokens || 0);
      const totalTokens = Number(ev.total_tokens || (promptTokens + completionTokens));
      if (promptTokens || completionTokens) {
        const last_call_usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
        };
        const pending_estimated = 0;
        const total = totalTokens + pending_estimated;
        useChat.setState({
          tokenUsage: {
            last_call_usage,
            pending_estimated,
            total,
          },
        });
      }
    }
    // 鍏朵粬浜嬩欢锛氶渶瑕侀噸绠?pending_estimated 绛夛紝璋?API
    if (
      (
        ev.type === "CUSTOM" ||
        ev.type === "REPLY_END" ||
        ev.type === "external_message"
      ) &&
      useChat.getState().sessionId === sid
    ) {
      useChat.getState().refreshTokenUsage(sid);
    }
  });

  wsClient.onConnect(() => {
    useChat.setState({ connected: true, wsStatus: "connected" });
    // 重连后重新拉取当前 session 的全量历史，保证断线期间的消息不丢失。
    // WS client 的 onopen 已经重发了 attach 帧，这里只需 HTTP 补数据 + 重建去重窗口。
    const { sessionId } = useChat.getState();
    if (sessionId) {
      import("../stores/session").then(({ useSession }) =>
        useSession.getState().reconnectSession(sessionId),
      );
    }
  });
  wsClient.onStatusChange((s) => useChat.setState({ wsStatus: s, connected: s === "connected" }));
  wsClient.onDisconnect(() => {
    // 鏂嚎锛氬叧鎺夋墍鏈?bucket 鐨?streaming 鐘舵€侊紝淇濈暀娑堟伅
    for (const [sid, b] of sessionProjections) {
      if (!b.hasCoordinatorState) {
        b.isBusy = false;
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

// 鈹€鈹€鈹€ Store 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
  isBusy: boolean;
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
  /** 褰撳墠浼氳瘽鐨勬€?token 鐢ㄩ噺鏄庣粏銆?   *  鐢卞悗绔?GET /api/sessions/{id}/token_usage 鎻愪緵锛屽湪鍒囨崲 session銆佹祦寮?done
   *  鍜?external_message 鍒拌揪鏃跺埛鏂般€?   *  - anchor: 鏈€杩戜竴娆?LLM 瀹炵畻鐨?usage锛堟棤鍒?null锛?   *  - pending_estimated: 閿氱偣涔嬪悗鏈疄绠楃殑浜嬩欢浼扮畻
   *  - total: anchor.total_tokens + pending_estimated */
  tokenUsage: ContextTokenUsage | null;
  /** 褰撳墠閫変腑妯″瀷鐨勪笂涓嬫枃绐楀彛澶у皬锛坱oken 鏁帮級銆?   *  鐢?ModelSelector 鍦ㄩ€夋嫨妯″瀷 / 鍔犺浇榛樿鍊兼椂鍚屾杩涙潵锛涚敤浜?TokenRing 璁＄畻鐢ㄩ噺姣斾緥銆?   *  null 琛ㄧず灏氭湭閫夋嫨鎴栨ā鍨嬫湭閰嶇疆 context_window銆?*/
  contextWindow: number | null;
  /** 杩樻病鏈?sessionId 鏃讹紙娆㈣繋椤?/ 鏂板璇濓級鐢ㄦ埛棰勮鐨勫伐浣滃尯銆?   *  鍙戝嚭绗竴鏉℃秷鎭垱寤?session 鏃朵細浣滀负 query param 涓€璧蜂紶缁欏悗绔紝
   *  钀藉埌 sessions.workspace 瀛楁锛涙鍚?sessionId 灏辨垚浜嗙湡鍊硷紝pending 涓嶅啀浣跨敤銆?*/
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
  /** 鍒囧埌鎸囧畾 session锛堜笉鍙栨秷鍚庡彴鐢熸垚锛涚寮€鐨?session 闈犲巻鍙?+ WS replay 鎭㈠锛夈€?*/
  switchTo: (sessionId: string) => void;
  /** 浠呭綋妗朵负绌烘椂濉厖锛堥娆¤繘鍏?session 鐢級 */
  clearSessionCache: (sessionId: string) => void;
  setSessionStatus: (sessionId: string, status: SessionStatus) => void;
  /** Put ChatMessage[] into the specified session bucket (history loader). */
  loadSessionMessages: (
    sessionId: string,
    messages: ChatMessage[],
    hasMoreHistory: boolean,
    status: SessionStatus,
    turnStartTs?: number | null,
    plan?: PlanData | null,
    commandName?: string | null,
    queue?: QueueSnapshotPayload | null,
  ) => void;
  /**
   * Prepend earlier ChatMessage[] to the session, deduping by message id.
   * Used for "load earlier messages" pagination.
   */
  prependSessionMessages: (
    sessionId: string,
    earlierMessages: ChatMessage[],
    hasMoreHistory: boolean,
  ) => void;
  /** 鍙栬 session 宸茬煡鏈€鏃╀簨浠剁殑 timestamp锛堢敤浣?鍔犺浇鏇存棭"鐨?before_ts锛?*/
  getEarliestEventTs: (sessionId: string) => number | null;
  /** 璇?session 鐨勫巻鍙叉槸鍚﹁繕鏈夋洿鏃╃殑椤靛彲鎷?*/
  hasMoreHistory: (sessionId: string) => boolean;
  setModel: (model: string | null) => void;
  setProvider: (provider: string | null) => void;
  setAgentId: (id: string) => void;
  /** 鍚屾褰撳墠妯″瀷鐨勪笂涓嬫枃绐楀彛澶у皬锛堢敱 ModelSelector 鍐欏叆锛?*/
  setContextWindow: (n: number | null) => void;
  /** 璁剧疆娆㈣繋椤?鏂板璇濈殑寰呯敤宸ヤ綔鍖恒€備細鍦ㄥ垱寤?session 鏃堕€忎紶缁欏悗绔€?*/
  setPendingWorkspace: (path: string | null) => void;
  /** 浠庡悗绔?config 棰勫姞杞介粯璁ゅ伐浣滃尯锛堝惎鍔ㄦ椂璋冪敤涓€娆★級 */
  initDefaultWorkspace: () => Promise<void>;
  /** 涓诲姩鍒锋柊褰撳墠 session 鐨?token 浼扮畻锛堝紓姝ワ紝澶辫触闈欓粯锛?*/
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
  isBusy: false,
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

    // 鏈湴鍥炴樉鐢細鎶婂悗绔崗璁舰鎬佺殑 attachments 杞垚甯?data URL 鐨勫舰鎬?
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
          // 每条用户输入都先显示在队列横幅，绝不在聊天区创建本地 UserMessage。
          // 只有服务端领取、落盘并回显后，消息才会进入聊天记录。
          b.pendingMessages = [...b.pendingMessages, pendingPreview(item)];
          b.queueDepth = b.pendingMessages.length;
        }
        b.lastUserInputTs = null;
        b.isBusy = true;
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

    // 棣栨鍙戞秷鎭細fetch 鍒涘缓 session 鏈熼棿浼氭湁 100~500ms 缃戠粶寰€杩旓紝
    // 杩欐鏃堕棿濡傛灉浠€涔堥兘涓嶅仛锛孋hatView 浼氬洜涓?(!sessionId && !isBusy) 浠嶅仠鐣欏湪 WelcomeView锛?
    // 鐢ㄦ埛鐪嬩笉鍒拌嚜宸卞垰鍙戠殑娑堟伅锛屼篃鐪嬩笉鍒?ftre..."鍗犱綅銆?
    // 杩欓噷鍏堝悓姝ユ妸 isBusy 鍜?userMsg 椤跺埌 store top-level锛岃 UI 绔嬪嵆鍒囧埌瀵硅瘽瑙嗗浘銆?
    // fetch 杩斿洖鍚?send() 鈫?bucket.push(userMsg) 鈫?mirror() 浼氬啀娆″啓鍥炲悓涓€浠?messages锛?
    // 鍐呭涓€鑷达紝涓嶄細闂儊涔熶笉浼氶噸澶嶃€?
    if (pendingNewSessionSends.length >= MAX_PENDING_NEW_SESSION_SENDS) {
      return { ok: false, reason: "outbox_full" };
    }
    pendingNewSessionSends.push(outbound);
    set({
      isBusy: true,
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
            isBusy: false,
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
    b.isBusy = true;
    b.sessionStatus = "running";
    b.canCancel = false;
    mirror(sid);
    // /cancel 使用独立的 session.cancel 控制帧，在 Session lock 外处理。
    wsClient.sendCancel(sid);
  },

  confirmToolCall: (toolCallId, approved) => {
    const sid = get().sessionId;
    if (!sid || !toolCallId) return;
    // 保留 asking 卡片，直到收到后端 USER_CONFIRM_RESULT 确认事件。
    // 这样发送失败、校验失败时仍能超时解锁并重试。
    const b = bucket(sid);
    if (!b.hasCoordinatorState) {
      b.isBusy = true;
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
      isBusy: false,
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
      isBusy: b.isBusy,
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
    sessionProjections.set(sessionId, emptyBucket());
    mirror(sessionId);
  },

  setSessionStatus: (sessionId, status) => {
    const b = bucket(sessionId);
    if (b.hasCoordinatorState) return;
    b.sessionStatus = status;
    b.sessionActivity = status === "idle"
      ? "idle"
      : status === "compacting"
        ? "compacting"
        : "executing";
    b.isBusy = status !== "idle";
    b.clientCanSend = status !== "compacting";
    b.canCancel = status === "running";
    if (status === "running") {
      b.error = null;
      b.retryState = null;
    } else {
      b.retryState = null;
    }
    mirror(sessionId);
  },

  loadSessionMessages: (sessionId, messages, hasMoreHistory, status, turnStartTs, plan, commandName, queue) => {
    const b = bucket(sessionId);
    b.hydrate({
      messages,
      hasMoreHistory,
      status,
      turnStartTs,
      plan,
      commandName,
    });
    if (queue) {
      // HTTP 返回的 queue 是刷新后的权威快照，直接复用实时事件的投影 reducer。
      applyQueueSnapshot(b, queue);
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
    } catch { /* 闈欓粯澶辫触 */ }
  },

  refreshTokenUsage: async (sessionId) => {
    const sid = sessionId ?? get().sessionId;
    if (!sid) {
      set({ tokenUsage: null });
      return;
    }
    try {
      // 鍔ㄦ€?import 鎵撶牬 chat 鈫?api 涔嬮棿鐨勫惊鐜紙api 涔熶細 import chat store锛?
      const { fetchTokenUsage } = await import("@/services/api");
      const usage = await fetchTokenUsage(sid);
      // 鍒锋柊杩囩▼涓鏋滅敤鎴峰凡缁忓垏璧颁簡 session锛屼涪寮冭繖娆＄粨鏋?
      if (get().sessionId !== sid) return;
      set({ tokenUsage: usage });
    } catch (e) {
      // HTTP/缃戠粶澶辫触锛氫繚鐣欎笂涓€娆″€硷紝閬垮厤 UI 闂埌 0
      console.error("[chat] refreshTokenUsage failed:", e);
    }
  },
}));

// 鈹€鈹€鈹€ Selectors 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export const useMessageIds = () => useChat(useShallow((s) => s.messages.map((m) => m.id)));
export const useMessageById = (id: string) => useChat((s) => s.messages.find((m) => m.id === id));
export const useIsBusy = () => useChat((s) => s.isBusy);
export const useIsStreaming = () => useChat((s) => s.isBusy);
export const useModel = () => useChat((s) => s.model);
export const useProvider = () => useChat((s) => s.provider);
export const useSessionId = () => useChat((s) => s.sessionId);
export const useAgentId = () => useChat((s) => s.agentId);
export const useWsStatus = () => useChat((s) => s.wsStatus);
export const useStreamingMessageId = () =>
  useChat((s) => s.messages.find((m) => m.streaming)?.id ?? null);
