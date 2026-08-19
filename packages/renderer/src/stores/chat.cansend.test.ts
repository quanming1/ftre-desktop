/**
 * 复现用户报告："发了消息之后发送按钮一直点不了，刷新 Session 才行"。
 * 按 WS 日志还原真实事件序列，断言 canSend 三条件（sessionStatus/clientCanSend/hasDraft）
 * 在每一阶段的取值。任何一步卡死即复现。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useChat, applyMailboxSnapshot, type SessionProjectionState } from "./chat";

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

function snapshot(phase: string, revision: number, pendingCount: number, accepting = true) {
  return {
    session_id: "ws_sess_A",
    revision,
    phase,
    pending: Array.from({ length: pendingCount }, (_, i) => ({
      request_id: `req-${revision}-${i}`,
      sequence: i + 1,
      content: "排队消息",
      attachments: [],
      source: "user",
    })),
    capacity: 100,
    accepting_messages: accepting,
    can_cancel_active: phase === "running",
    blocked_reason: null,
  } as any;
}

/** ChatInput 的 canSend 公式（逐字复刻） */
function canSendOf(b: { sessionStatus: string; hasCoordinatorState: boolean; clientCanSend: boolean }, hasDraft: boolean) {
  return b.sessionStatus !== "compacting" && (!b.hasCoordinatorState || b.clientCanSend) && hasDraft;
}

describe("发送按钮卡死复现（按 WS 日志事件序列）", () => {
  beforeEach(() => {
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

    // 1) 用户发消息 → 后端 admit → 快照 rev=102 phase=idle pending=1 accepting=true
    applyMailboxSnapshot(b, snapshot("idle", 102, 1));
    expect(b.hasCoordinatorState).toBe(true);
    expect(b.clientCanSend).toBe(true);
    expect(b.isBusy).toBe(true); // queueDepth=1
    expect(b.sessionStatus).toBe("running"); // isBusy → running

    // 2) take 消耗 rev=103 但无快照；turn 进行 48s——客户端保持上述状态
    // 3) 用户打字（hasDraft=true）→ 按钮必须可点（排队语义）
    expect(canSendOf(b, true)).toBe(true);

    // 4) turn 完成 → 快照 rev=104 idle pending=0
    applyMailboxSnapshot(b, snapshot("idle", 104, 0));
    expect(b.isBusy).toBe(false);
    expect(b.sessionStatus).toBe("idle");
    expect(canSendOf(b, true)).toBe(true);
  });

  it("compacting 快照禁发，完成快照恢复——一轮压缩不能留下永久禁发", () => {
    const b = freshProjection();
    applyMailboxSnapshot(b, snapshot("idle", 105, 1, true));

    // 压缩开始（修复后的 after_turn 行为：turn 完成即压缩）
    applyMailboxSnapshot(b, snapshot("compacting", 106, 1, false));
    expect(b.sessionStatus).toBe("compacting");
    expect(b.clientCanSend).toBe(false);
    expect(canSendOf(b, true)).toBe(false); // 压缩中禁发：预期

    // 压缩完成 → idle 恢复（此时 pending=1：压缩期间用户发的排队消息，
    // 状态应为 running 且可继续发送——正是"队列"语义）
    applyMailboxSnapshot(b, snapshot("idle", 107, 1, true));
    expect(b.clientCanSend).toBe(true);
    expect(canSendOf(b, true)).toBe(true);

    // 排队消息全部执行完 → 真正 idle
    applyMailboxSnapshot(b, snapshot("idle", 109, 0, true));
    expect(b.sessionStatus).toBe("idle");
  });

  it("迟到 ACK 在 idle 后到达：只置 running，不能挡住后续发送", () => {
    const b = freshProjection();
    applyMailboxSnapshot(b, snapshot("idle", 104, 0)); // turn 完成 idle

    // 迟到的 admission ack 路径（复刻 1319-1346 的直接赋值）
    b.isBusy = true;
    b.sessionStatus = "running";
    if (!b.hasCoordinatorState) b.sessionActivity = "dispatching";

    // running 期间 canSend 仍应 true（有队列语义）
    expect(canSendOf(b, true)).toBe(true);

    // 下一条快照（新 turn 完成）恢复正常
    applyMailboxSnapshot(b, snapshot("idle", 108, 0));
    expect(b.sessionStatus).toBe("idle");
  });

  it("乱序/重复快照：同 revision 或更低的 idle 快照被丢弃且不破坏状态", () => {
    const b = freshProjection();
    applyMailboxSnapshot(b, snapshot("idle", 104, 0));
    // 网络重放的低 revision compacting 快照必须被守卫拦下
    applyMailboxSnapshot(b, snapshot("compacting", 90, 0, false));
    expect(b.sessionStatus).toBe("idle"); // 未被旧快照污染
    expect(canSendOf(b, true)).toBe(true);
  });
});
