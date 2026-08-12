import type {
  MailboxItemPayload,
  ReplySnapshotPayload,
  SessionActivity,
} from "@/services/websocket-client";
import type {
  ChatMessage,
  PlanData,
  RetryState,
  SessionStatus,
} from "./chat";

/** ClientSessionProjection 可以消费的统一事件信封。 */
export interface ProjectionEvent {
  type: string;
  data?: any;
  ts?: number;
  eventId?: string;
  /** WebSocket 下行 BusMessage 的 frame id，用作 Event 缺少 id 时的去重键。 */
  frameId?: string;
  metadata?: Record<string, any>;
}

export interface ProjectionHistory {
  messages: ChatMessage[];
  hasMoreHistory: boolean;
  status: SessionStatus;
  turnStartTs?: number | null;
  plan?: PlanData | null;
  commandName?: string | null;
}

interface ProjectionReducers {
  applyEvent: (
    projection: SessionProjectionState,
    event: ProjectionEvent,
  ) => void;
  applyReplySnapshot: (
    projection: SessionProjectionState,
    snapshot: ReplySnapshotPayload,
  ) => void;
}

export interface SessionProjectionState {
  messages: ChatMessage[];
  seenEventIds: Set<string>;
  earliestTs: number | null;
  hasMoreHistory: boolean;
  lastUserInputTs: number | null;
  sessionStatus: SessionStatus;
  sessionActivity?: SessionActivity;
  sessionRevision?: number;
  snapshotConnectionEpoch?: number;
  hasCoordinatorState?: boolean;
  queueDepth?: number;
  queueCapacity?: number | null;
  /** 输入框上方横幅：服务端 mailbox.pending + 尚未 ACK 的本地发送预览，不混入聊天正文。 */
  pendingMessages?: MailboxItemPayload[];
  clientCanSend?: boolean;
  canCancel?: boolean;
  blockedReason?: string | null;
  isBusy: boolean;
  error: string | null;
  retryState: RetryState | null;
  turnStartTs: number | null;
  commandName: string | null;
  plan: PlanData | null;
  replyRevisions?: Map<string, number>;
}

/**
 * 客户端某一个 session 的投影。
 *
 * 后端 Msg 快照、进行中的 Reply Snapshot 和实时 Event 都必须先进入这里，
 * React/Zustand 只读取投影结果，不再各自维护另一套消息合并规则。
 */
export class ClientSessionProjection implements SessionProjectionState {
  messages: ChatMessage[] = [];
  seenEventIds = new Set<string>();
  earliestTs: number | null = null;
  hasMoreHistory = false;
  lastUserInputTs: number | null = null;
  sessionStatus: SessionStatus = "idle";
  sessionActivity: SessionActivity = "idle";
  sessionRevision = -1;
  snapshotConnectionEpoch = -1;
  hasCoordinatorState = false;
  queueDepth = 0;
  queueCapacity: number | null = null;
  pendingMessages: MailboxItemPayload[] = [];
  clientCanSend = true;
  canCancel = false;
  blockedReason: string | null = null;
  isBusy = false;
  error: string | null = null;
  retryState: RetryState | null = null;
  turnStartTs: number | null = null;
  commandName: string | null = null;
  plan: PlanData | null = null;
  /** Reply Snapshot 的单调版本，防止旧快照覆盖较新的流式状态。 */
  replyRevisions = new Map<string, number>();

  constructor(private readonly reducers: ProjectionReducers) {}

  apply(event: ProjectionEvent): void {
    this.reducers.applyEvent(this, event);
  }

  applySnapshot(snapshot: ReplySnapshotPayload): void {
    this.reducers.applyReplySnapshot(this, snapshot);
  }

  /**
   * 用持久化 Msg 初始化/刷新投影，同时保留 WS 已经恢复的瞬态 Reply。
   * HTTP 历史和 WS attach 是并行返回的，不能让较晚到达的 HTTP 覆盖进行中状态。
   */
  hydrate(history: ProjectionHistory): void {
    const effectiveStatus = this.hasCoordinatorState
      ? this.sessionStatus
      : history.status;
    // HTTP 历史与 WS attach 并行返回。队列请求不合成为聊天气泡，
    // 只保留正在流式输出的 Assistant 回复。
    const activeTransient = this.messages.filter((message) =>
      (effectiveStatus === "running" && message.streaming === true)
      || (
        effectiveStatus === "compacting"
        && message.compact?.status === "running"
      ),
    );
    const transientIds = new Set(activeTransient.map((message) => message.id));
    this.messages = [
      ...history.messages.filter((message) => !transientIds.has(message.id)),
      ...activeTransient,
    ].sort((left, right) => left.timestamp - right.timestamp);
    const firstUser = history.messages.find((message) => message.role === "user");
    this.earliestTs = firstUser ? firstUser.timestamp / 1000 : null;
    this.hasMoreHistory = history.hasMoreHistory;
    this.lastUserInputTs = [...history.messages]
      .reverse()
      .find((message) => message.role === "user")?.timestamp ?? null;
    if (!this.hasCoordinatorState) {
      this.sessionStatus = history.status;
      this.sessionActivity = history.status === "idle"
        ? "idle"
        : history.status === "compacting"
          ? "compacting"
          : "executing";
      this.isBusy = history.status !== "idle";
      this.clientCanSend = history.status !== "compacting";
      this.canCancel = history.status === "running";
    }
    this.error = null;
    this.retryState = null;
    const activeReply = activeTransient.find((message) => message.streaming);
    this.turnStartTs = history.turnStartTs
      ?? this.turnStartTs
      ?? activeReply?.timestamp
      ?? null;
    this.plan = history.plan ?? null;
    this.commandName = history.commandName ?? null;

  }

  prependHistory(messages: ChatMessage[], hasMoreHistory: boolean): void {
    if (messages.length === 0) {
      this.hasMoreHistory = hasMoreHistory;
      return;
    }
    if (this.messages[this.messages.length - 1]?.streaming) return;

    const incomingIds = new Set(messages.map((message) => message.id));
    this.messages = [
      ...messages,
      ...this.messages.filter((message) => !incomingIds.has(message.id)),
    ];
    const firstUser = messages.find((message) => message.role === "user");
    if (firstUser) this.earliestTs = firstUser.timestamp / 1000;
    this.hasMoreHistory = hasMoreHistory;
  }
}
