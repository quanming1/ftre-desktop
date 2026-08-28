/**
 * Chat Store：消费 ftre gateway WebSocket 事件流。
 * 每个 session 使用独立 bucket；顶层字段只是当前 bucket 的镜像。
 * 运行态 UI 直接读取 session、activity、queue 和 streaming 等窄语义字段。
 * 事件源：ws 实时事件走 applyEvent reducer；history 加载走 historyToMessages 直接转换。
 */
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { wsClient } from "@/services/websocket-client";
import {
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
import { createSessionRemote, fetchChatAgents, updateAgent } from "@/services/api";
import type { ChatAgent, ContextTokenUsage } from "@/services/api";
import { ClientSessionProjection, type SessionProjectionState } from "./clientSessionProjection";
import {
  applyEvent,
  applyQueueSnapshot,
  applyReplySnapshot,
  hasSeenEvent,
  type BusEvent,
} from "./chatProjection";
import { hasActiveTurn, hasPendingWork, hasStreamingAssistant } from "./runtimeState";
export { applyEvent, applyQueueSnapshot, applyReplySnapshot, type BusEvent } from "./chatProjection";
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

// 鈹€鈹€鈹€ Per-session buckets (module-private) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const sessionProjections = new Map<string, ClientSessionProjection>();
const STREAM_TYPES = new Set([
  "TEXT_BLOCK_DELTA",
  "THINKING_BLOCK_DELTA",
  "TOOL_CALL_DELTA",
  "TOOL_RESULT_TEXT_DELTA",
]);
const _wsFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const _wsBatches = new Map<string, BusEvent[]>();
const WS_BATCH_WINDOW_MS = 10;
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

function mirror(sid: string): void {
  if (useChat.getState().sessionId !== sid) return;
  const b = sessionProjections.get(sid);
  if (!b) return;
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

// 鈹€鈹€鈹€ Event Reducer 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
//
// 鍚屾椂鏈嶅姟浜?ws 瀹炴椂浜嬩欢 鍜?history 鍥炴斁銆?// 璋冪敤鏂圭害鏉燂細姣忔鍙鐞嗕竴涓?event锛涜皟鐢ㄥ悗 bucket 瀛楁鏄柊寮曠敤锛堟暟缁勭骇 immutable锛夈€?
// Projection reducer implementation lives in chatProjection.ts; this file owns
// session buckets, WebSocket wiring and Zustand actions only.
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
      applyQueueSnapshot(
        b,
        sessionEvent,
        typeof msg.request_id === "string" ? msg.request_id : undefined,
      );
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
      // Queue snapshot 和 session/status 是两条独立事实流：前者只说明
      // Inbox 中还有哪些 pending，后者才说明 Agent 是否仍在执行。不能因为
      // 先收到 queue snapshot 就跳过 status，否则 idle 永远不会落到投影，
      const status = sessionStatus.status;
      b.hasCoordinatorState = true;
      b.sessionStatus = status;
      b.sessionActivity = status === "idle"
        ? "idle"
        : status === "compacting" ? "compacting" : "executing";
      // 队列仍有 pending 时保留 busy 横幅；但没有 pending 的 idle 必须立即
      // 结束当前 Turn，不能等待历史刷新来推导完成态。
      b.clientCanSend = status !== "compacting";
      b.canCancel = status === "running";
      b.error = null;
      b.retryState = null;
      mirror(sid);
      import("../stores/session")
        .then(({ useSession }) => useSession.getState().loadAllSessions())
        .catch(() => void 0);
      return;
    }

    if (msg.type !== "agent_event" && msg.type !== "session_event") return;
    const ev = msg.payload as AgentStreamEvent;
    if (!ev?.type) return;


    const sid = msg.metadata?.session_id as string | undefined;
    if (!sid) return;

    const isCoreEvent =
      ev.type === "retry" ||
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
        ev.type === "PIPELINE_EVENT" ||
        ev.type === "SESSION_MAINTENANCE" ||
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
    // session 创建期间先显示派发态和 pending 预览，避免 WelcomeView 闪回。
    // 鐢ㄦ埛鐪嬩笉鍒拌嚜宸卞垰鍙戠殑娑堟伅锛屼篃鐪嬩笉鍒?ftre..."鍗犱綅銆?
    // 这里先把派发态和 pending 预览写入 store top-level，让 UI 立即切换到对话视图。
    // fetch 杩斿洖鍚?send() 鈫?bucket.push(userMsg) 鈫?mirror() 浼氬啀娆″啓鍥炲悓涓€浠?messages锛?
    // 鍐呭涓€鑷达紝涓嶄細闂儊涔熶笉浼氶噸澶嶃€?
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
    // 保留 asking 卡片，直到收到后端 USER_CONFIRM_RESULT 确认事件。
    // 这样发送失败、校验失败时仍能超时解锁并重试。
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
