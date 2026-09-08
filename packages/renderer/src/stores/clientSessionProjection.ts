import type { QueueItemView, SessionActivity } from "@/services/websocket-client";
import type { WireFrame, WireMsg } from "@/types/wire.gen";
import type {
  ChatMessage,
  PlanData,
  RetryState,
  SessionStatus,
} from "./chat";
import { SessionEventClient, msgToChatMessage } from "./sessionEventClient";
import { applyLifecycleEvent } from "./chatProjection";

export interface ProjectionHistory {
  /** HTTP /messages 的 derive 结果（统一 Msg → ChatMessage 投影）。 */
  messages: ChatMessage[];
  /** 同一页的 WireMsg 种子（重建 assembler 基线，保证 tail 事件可正确配对）。 */
  wire: WireMsg[];
  /** HTTP Msg 快照覆盖到的 Session seq。 */
  seq?: number;
  hasMoreHistory: boolean;
  status: SessionStatus;
  turnStartTs?: number | null;
  plan?: PlanData | null;
  commandName?: string | null;
}

interface ProjectionReducers {
  applyFrame: (
    projection: SessionProjectionState,
    frame: WireFrame,
  ) => void;
}

export interface SessionProjectionState {
  messages: ChatMessage[];
  /** v4 事件消费客户端（seq 游标 + assembler fold + tail-page 恢复）。 */
  events: SessionEventClient;
  /** 把 assembler 脏消息投影合并进 messages（引用稳定）。 */
  projectEvents(): void;
  earliestTs: number | null;
  hasMoreHistory: boolean;
  lastUserInputTs: number | null;
  sessionStatus: SessionStatus;
  sessionActivity?: SessionActivity;
  sessionRevision?: number;
  hasCoordinatorState?: boolean;
  queueDepth?: number;
  queueCapacity?: number | null;
  /** 输入框上方横幅：服务端 Inbox items + 尚未收到响应的本地预览，不混入聊天正文。 */
  pendingMessages?: QueueItemView[];
  clientCanSend?: boolean;
  canCancel?: boolean;
  blockedReason?: string | null;
  error: string | null;
  retryState: RetryState | null;
  turnStartTs: number | null;
  commandName: string | null;
  plan: PlanData | null;
}

/**
 * 客户端某一个 session 的投影。
 *
 * v4：消息事实源是事件日志——SessionEventClient（assembler fold）产出 Msg，
 * 经 msgToChatMessage 投影合并进 messages（引用稳定：只替换脏消息）；
 * HTTP 历史仅作基线种子。React/Zustand 只读取投影结果。
 */
export class ClientSessionProjection implements SessionProjectionState {
  messages: ChatMessage[] = [];
  events: SessionEventClient;
  earliestTs: number | null = null;
  hasMoreHistory = false;
  lastUserInputTs: number | null = null;
  sessionStatus: SessionStatus = "idle";
  sessionActivity: SessionActivity = "idle";
  sessionRevision = -1;
  hasCoordinatorState = false;
  queueDepth = 0;
  queueCapacity: number | null = null;
  pendingMessages: QueueItemView[] = [];
  clientCanSend = true;
  canCancel = false;
  blockedReason: string | null = null;
  error: string | null = null;
  retryState: RetryState | null = null;
  turnStartTs: number | null = null;
  commandName: string | null = null;
  plan: PlanData | null = null;

  constructor(
    private readonly reducers: ProjectionReducers,
    options: {
      sessionId?: string;
      onEventsSettled?: () => void;
      onReset?: () => void;
      onGap?: () => void;
    } = {},
  ) {
    this.events = new SessionEventClient({
      sessionId: options.sessionId ?? "",
      onAttachEvent: (event) => {
        // attach 事件同 live 事件走同一状态机；先把 Msg fold 投影出来，
        // 再应用 turn/end 的耗时、状态和错误等派生字段。
        this.projectEvents();
        applyLifecycleEvent(this, event);
      },
      onResyncRequired: () => {
        // attach 无法提供客户端所需的旧事件时，先清理运行态，再由上层
        // 重新请求 HTTP Msg 快照建立基线。
        this.hasCoordinatorState = false;
        this.sessionStatus = "idle";
        this.sessionActivity = "idle";
        this.clientCanSend = true;
        this.canCancel = false;
        this.blockedReason = null;
        this.error = null;
        this.retryState = null;
        this.turnStartTs = null;
        this.commandName = null;
        this.pendingMessages = [];
        this.queueDepth = 0;
        options.onReset?.();
      },
      onGap: () => {
        options.onGap?.();
      },
      onSettled: () => {
        this.projectEvents();
        options.onEventsSettled?.();
      },
    });
  }

  apply(frame: WireFrame): void {
    this.reducers.applyFrame(this, frame);
  }

  /**
   * 把 assembler 自上次以来的脏消息投影合并进 messages。
   * 未触碰的消息保持引用稳定（memo 契约）；新消息按事件序追加。
   */
  projectEvents(): void {
    const dirty = this.events.assembler.takeDirty();
    if (dirty.size === 0) return;
    let next: ChatMessage[] | null = null;
    const current = () => next ?? this.messages;
    for (const id of dirty) {
      const msg = this.events.assembler.messageById(id);
      if (!msg) continue;
      const chat = msgToChatMessage(msg, this.events.assembler.askContext);
      const index = current().findIndex((message) => message.id === id);
      if (chat == null) {
        if (index >= 0) {
          next ??= [...this.messages];
          next.splice(index, 1);
        }
        continue;
      }
      if (index >= 0) {
        next ??= [...this.messages];
        next[index] = chat;
      } else {
        next ??= [...this.messages];
        next.push(chat);
      }
    }
    if (next) this.messages = next;
  }

  /**
   * 用 HTTP /messages 的 fold 结果初始化/刷新投影。
   *
   * wire 种子重建 assembler 基线（seq = HTTP 响应 seq）；服务端 Msg 快照已
   * 包含截至该 seq 的 in-flight 流式消息；paused 确认卡仍由客户端合成。
   */
  hydrate(history: ProjectionHistory): void {
    this.events.seedHistory(history.wire, history.seq ?? -1);
    this.messages = history.messages;
    this.projectEvents();

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
      this.clientCanSend = history.status !== "compacting";
      this.canCancel = history.status === "running";
    }
    this.error = null;
    this.retryState = null;
    this.turnStartTs = history.turnStartTs
      ?? this.turnStartTs
      ?? this.messages.find((message) => message.streaming)?.timestamp
      ?? null;
    this.plan = history.plan ?? null;
    this.commandName = history.commandName ?? null;
  }

  prependHistory(messages: ChatMessage[], hasMoreHistory: boolean): void {
    if (messages.length === 0) {
      this.hasMoreHistory = hasMoreHistory;
      return;
    }

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
