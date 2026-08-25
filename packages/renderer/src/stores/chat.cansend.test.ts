/**
 * 复现用户报告："发了消息之后发送按钮一直点不了，刷新 Session 才行"。
 * 按 WS 日志还原真实事件序列，断言 canSend 三条件（sessionStatus/clientCanSend/hasDraft）
 * 在每一阶段的取值。任何一步卡死即复现。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useChat, applyQueueSnapshot, type SessionProjectionState } from "./chat";

// 复刻 emptyBucket 的默认投影状态（不依赖内部实现细节）
function freshProjection(): SessionProjectionState {
  const b = useChat.getState();
  return {
    messages: [],
    isBusy: false,
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
    commandName: null,
    turnStartTs: null,
    lastUserInputTs: null,
    plan: null,
    hasMoreHistory: true,
    earliestTs: null,
    seenEvents: new Set(),
    tokenUsage: null,
  } as unknown as SessionProjectionState;
}

let snapshotRevision = 0;

function snapshot(pendingCount: number) {
  return {
    session_id: "ws_sess_A",
    revision: ++snapshotRevision,
    items: Array.from({ length: pendingCount }, (_, i) => ({
      id: `req-${i}`,
      placement: "queued",
      message: { content: [{ type: "text", text: "排队消息" }], attachments: [] },
    })),
  } as any;
}

/** ChatInput 的 canSend 公式（逐字复刻） */
function canSendOf(
  b: Pick<SessionProjectionState, "sessionStatus" | "hasCoordinatorState" | "clientCanSend">,
  hasDraft: boolean,
) {
  const hasCoordinatorState = b.hasCoordinatorState ?? false;
  const clientCanSend = b.clientCanSend ?? true;
  return b.sessionStatus !== "compacting" && (!hasCoordinatorState || clientCanSend) && hasDraft;
}

describe("发送按钮卡死复现（按 WS 日志事件序列）", () => {
  beforeEach(() => {
    snapshotRevision = 0;
    useChat.setState({
      sessionId: "ws_sess_A",
      sessionStatus: "idle",
      sessionActivity: "idle",
      sessionRevision: -1,
      hasCoordinatorState: false,
      clientCanSend: true,
      queueDepth: 0,
      pendingMessages: [],
      isBusy: false,
    });
  });

  it("turn 运行中（仅 admit 快照，无 take 快照）打字后 canSend 必须为 true", () => {
    const b = freshProjection();

    // 1) Agent 正在运行，Inbox 只推送 pending 快照。
    b.sessionStatus = "running";
    b.sessionActivity = "executing";
    applyQueueSnapshot(b, snapshot(1));
    expect(b.hasCoordinatorState).toBe(true);
    expect(b.clientCanSend).toBe(true);
    expect(b.isBusy).toBe(true); // queueDepth=1
    expect(b.sessionStatus).toBe("running"); // isBusy → running

    // 2) take 消耗 rev=103 但无快照；turn 进行 48s——客户端保持上述状态
    // 3) 用户打字（hasDraft=true）→ 按钮必须可点（排队语义）
    expect(canSendOf(b, true)).toBe(true);

    // 4) status 先回 idle，再收到空队列快照。
    b.sessionStatus = "idle";
    b.sessionActivity = "idle";
    b.isBusy = false;
    applyQueueSnapshot(b, snapshot(0));
    expect(b.isBusy).toBe(false);
    expect(b.sessionStatus).toBe("idle");
    expect(canSendOf(b, true)).toBe(true);
  });

  it("compacting 快照禁发，完成快照恢复——一轮压缩不能留下永久禁发", () => {
    const b = freshProjection();
    b.sessionStatus = "running";
    b.sessionActivity = "executing";
    applyQueueSnapshot(b, snapshot(1));

    // 压缩状态由 session/status 维护，队列快照不覆盖它。
    b.sessionStatus = "compacting";
    b.clientCanSend = false;
    applyQueueSnapshot(b, snapshot(1));
    expect(b.sessionStatus).toBe("compacting");
    expect(b.clientCanSend).toBe(false);
    expect(canSendOf(b, true)).toBe(false); // 压缩中禁发：预期

    // 压缩完成 → idle 恢复（此时 pending=1：压缩期间用户发的排队消息，
    // 状态应为 running 且可继续发送——正是"队列"语义）
    b.sessionStatus = "running";
    b.clientCanSend = true;
    applyQueueSnapshot(b, snapshot(1));
    expect(b.clientCanSend).toBe(true);
    expect(canSendOf(b, true)).toBe(true);

    // 排队消息全部执行完 → 真正 idle
    b.sessionStatus = "idle";
    applyQueueSnapshot(b, snapshot(0));
    expect(b.sessionStatus).toBe("idle");
  });

  it("迟到状态更新在 idle 后到达：只置 running，不能挡住后续发送", () => {
    const b = freshProjection();
    applyQueueSnapshot(b, snapshot(0)); // turn 完成 idle

    // 迟到的运行状态路径：队列响应与 status 事件不应锁死输入框。
    b.isBusy = true;
    b.sessionStatus = "running";
    if (!b.hasCoordinatorState) b.sessionActivity = "dispatching";

    // running 期间 canSend 仍应 true（有队列语义）
    expect(canSendOf(b, true)).toBe(true);

    // 下一条快照（新 turn 完成）恢复正常
    b.sessionStatus = "idle";
    applyQueueSnapshot(b, snapshot(0));
    expect(b.sessionStatus).toBe("idle");
  });

  it("队列快照只替换 pending，不覆盖独立的 session/status", () => {
    const b = freshProjection();
    b.sessionStatus = "running";
    applyQueueSnapshot(b, snapshot(0));
    applyQueueSnapshot(b, snapshot(1));
    expect(b.sessionStatus).toBe("running");
    expect(b.queueDepth).toBe(1);
    expect(canSendOf(b, true)).toBe(true);
  });
});
