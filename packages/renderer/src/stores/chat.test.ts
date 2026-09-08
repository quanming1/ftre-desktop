import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyFrame,
  applyQueueSnapshot,
  useChat,
  waitForSendAdmission,
} from "./chat";
import type { ContentBlock } from "./chat";
import { ClientSessionProjection } from "./clientSessionProjection";
import { SessionEventClient } from "./sessionEventClient";
import type { SessionEvent, WireFrame } from "@/types/wire.gen";

const wsMessageHandler = vi.hoisted(() => ({
  current: null as ((message: any) => void) | null,
}));

vi.mock("@/services/websocket-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/websocket-client")>();
  return {
    ...actual,
    wsClient: {
      onMessage: vi.fn((handler: (message: any) => void) => {
        wsMessageHandler.current = handler;
        return () => {
          if (wsMessageHandler.current === handler) wsMessageHandler.current = null;
        };
      }),
      onDisconnect: vi.fn(),
      onConnect: vi.fn(),
      onStatusChange: vi.fn(),
      sendChat: vi.fn((_content, _metadata, _attachments, frameId) => ({
        ok: true,
        queued: false,
        requestId: frameId,
      })),
      sendCancel: vi.fn(),
      attach: vi.fn(),
      subscribeOnly: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      connected: false,
      status: "disconnected",
    },
  };
});

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return {
    ...actual,
    createSessionRemote: vi.fn(),
  };
});

// ─── v4 帧构造工具 ───────────────────────────────────────────────────

/** 每 session 独立 seq 计数：新桶从 0 连续递增，避免触发 tail-page 补拉。 */
const seqCounters = new Map<string, number>();
const nextSeq = (sid: string) => {
  const seq = (seqCounters.get(sid) ?? -1) + 1;
  seqCounters.set(sid, seq);
  return seq;
};

function eventFrame(
  sid: string,
  event: Pick<SessionEvent, "type"> & Partial<SessionEvent>,
): WireFrame {
  return {
    v: 1,
    session_id: sid,
    type: "session/event",
    payload: {
      event: {
        seq: nextSeq(sid),
        time: Date.parse("2026-09-01T00:00:00Z"),
        message_id: null,
        data: {},
        ...event,
      } as SessionEvent,
    },
  };
}

function wireFrame(sid: string, type: WireFrame["type"], payload: unknown): WireFrame {
  return { v: 1, session_id: sid, type, payload };
}

function freshProjection(sid: string): ClientSessionProjection {
  return new ClientSessionProjection(
    { applyFrame },
    { sessionId: sid },
  );
}

function chunkEvent(sid: string, messageId: string, blockId: string, delta: string): WireFrame {
  return eventFrame(sid, {
    type: "assistant/chunk",
    message_id: messageId,
    data: { kind: "text", block_id: blockId, delta },
  });
}

const toolCallBlocks = (message?: { blocks?: ContentBlock[] }) =>
  message?.blocks?.filter(
    (block): block is Extract<ContentBlock, { type: "toolCall" }> => block.type === "toolCall",
  );

function resetStore() {
  useChat.getState().newChat();
  useChat.setState({
    connected: false,
    wsStatus: "disconnected",
    model: null,
    provider: null,
    agentId: "default",
  });
  seqCounters.clear();
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe("chat store", () => {
  it("starts with an empty idle conversation", () => {
    const state = useChat.getState();
    expect(state.messages).toEqual([]);
    expect(state.sessionId).toBeNull();
    expect(state.sessionStatus).toBe("idle");
  });

  it("does not treat a session.cancel rpc response as a queue operation response", () => {
    useChat.setState({
      sessionId: "s-cancel-rpc",
      sessionStatus: "idle",
      sessionActivity: "idle",
      pendingMessages: [],
      queueDepth: 0,
    });

    wsMessageHandler.current?.({
      v: 1,
      session_id: "s-cancel-rpc",
      type: "rpc",
      payload: {
        request_id: "cancel-1",
        ok: true,
        value: { accepted: true, session_id: "s-cancel-rpc" },
      },
    });

    expect(useChat.getState()).toMatchObject({
      sessionStatus: "idle",
      pendingMessages: [],
    });
  });

  it("uses the rpc queue snapshot as the durable admission result", async () => {
    useChat.setState({ sessionId: "s1-admission" });
    const result = useChat.getState().sendMessage("普通排队消息");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const admission = waitForSendAdmission(result.requestId);
    wsMessageHandler.current?.({
      v: 1,
      session_id: "s1-admission",
      type: "rpc",
      payload: {
        request_id: result.requestId,
        ok: true,
        value: {
          session_id: "s1-admission",
          revision: 1,
          items: [{
            id: result.requestId,
            placement: "queued",
            message: { content: [{ type: "text", text: "普通排队消息" }] },
          }],
        },
      },
    });

    await expect(admission).resolves.toEqual({ ok: true });
    expect(useChat.getState().pendingMessages[0]).toMatchObject({
      request_id: result.requestId,
      placement: "queued",
    });
    expect(useChat.getState().pendingMessages[0]).not.toHaveProperty("optimistic", true);
  });

  it("settles a rejected prompt admission with the server reason", async () => {
    useChat.setState({ sessionId: "s-admission-error" });
    const result = useChat.getState().sendMessage("会被拒绝的消息");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const admission = waitForSendAdmission(result.requestId);
    wsMessageHandler.current?.({
      v: 1,
      session_id: "s-admission-error",
      type: "rpc",
      payload: {
        request_id: result.requestId,
        ok: false,
        error: { code: "queue-full", message: "Inbox 已满" },
      },
    });

    await expect(admission).resolves.toEqual({ ok: false, reason: "Inbox 已满" });
    // 被拒绝的本地预览必须从队列横幅移除。
    expect(useChat.getState().pendingMessages).toEqual([]);
  });

  it("clears the local queue preview when an idle session claims before the response", () => {
    useChat.setState({ sessionId: "s1-immediate-claim" });
    const result = useChat.getState().sendMessage("立即领取的消息");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(useChat.getState().pendingMessages).toHaveLength(1);

    // 空快照不是"尚未处理"：rpc request_id 表示本次 prompt 已结算，
    // 只是 Inbox 在生成响应前已经完成了 claim。
    wsMessageHandler.current?.({
      v: 1,
      session_id: "s1-immediate-claim",
      type: "rpc",
      payload: {
        request_id: result.requestId,
        ok: true,
        value: { session_id: "s1-immediate-claim", revision: 1, items: [] },
      },
    });

    expect(useChat.getState().pendingMessages).toEqual([]);
    expect(useChat.getState().queueDepth).toBe(0);
  });

  it("applies turn/end after a queue snapshot so completed turns appear immediately", () => {
    useChat.setState({
      sessionId: "s-completed-actions",
      sessionStatus: "running",
      sessionActivity: "executing",
      pendingMessages: [],
      queueDepth: 0,
    });

    // Inbox 快照先到会建立 coordinator 标记；这不应阻止后续 turn/end 推导 idle。
    wsMessageHandler.current?.(wireFrame("s-completed-actions", "session/queue", {
      session_id: "s-completed-actions",
      revision: 1,
      items: [],
    }));
    wsMessageHandler.current?.(eventFrame("s-completed-actions", {
      type: "turn/end",
      data: {
        turn_id: "t-1",
        request_id: "r-1",
        outcome: "completed",
        reason: "completed",
        iterations: 1,
      },
    }));

    expect(useChat.getState()).toMatchObject({
      hasCoordinatorState: true,
      sessionStatus: "idle",
      sessionActivity: "idle",
      canCancel: false,
    });
  });

  it("updates model, provider and agent", () => {
    const state = useChat.getState();
    state.setModel("gpt-4");
    state.setProvider("openai");
    state.setAgentId("reviewer");

    expect(useChat.getState()).toMatchObject({
      model: "gpt-4",
      provider: "openai",
      agentId: "reviewer",
    });
  });

  it("stores the actual compact model from context_compact_start", () => {
    const projection = freshProjection("s-compact-start");

    projection.apply(wireFrame("s-compact-start", "session/maintenance", {
      name: "context_compact_start",
      value: { model: "deepseek-v4-flash", tokens: 2_000 },
    }));

    expect(projection.messages).toEqual([expect.objectContaining({
      compact: expect.objectContaining({
        status: "running",
        model: "deepseek-v4-flash",
      }),
    })]);
  });

  it("dismisses the running compact bubble when compact/message lands the durable anchor", () => {
    const projection = freshProjection("s-compact-done");

    projection.apply(wireFrame("s-compact-done", "session/maintenance", {
      name: "context_compact_start",
      value: { model: "m", tokens: 100 },
    }));
    expect(projection.messages).toHaveLength(1);

    projection.apply(eventFrame("s-compact-done", {
      type: "compact/message",
      message_id: "c_anchor_1",
      data: {
        mode: "summary",
        summary_text: "压缩摘要",
        through_message_id: "m-9",
        trigger: "auto",
        tokens_before: 100,
        tokens_after: 40,
        tool_results: 0,
      },
    }));

    // 瞬态 running 气泡退场；锚点消息成为唯一可见的压缩气泡。
    expect(projection.messages).toHaveLength(1);
    expect(projection.messages[0]).toMatchObject({
      id: "c_anchor_1",
      compact: expect.objectContaining({
        status: "done",
        mode: "summary",
        summaryPreview: "压缩摘要",
        tokensBefore: 100,
        tokensAfter: 40,
      }),
    });
  });

  it("deduplicates repeated tool call starts by tool_call_id", () => {
    const projection = freshProjection("s-tool-dedupe");

    const start = (toolCallId: string, name: string) => projection.apply(
      eventFrame("s-tool-dedupe", {
        type: "tool/call-start",
        message_id: "m-tool",
        data: { tool_call_id: toolCallId, name, arguments: {} },
      }),
    );

    start("tc-duplicate", "read");
    start("tc-duplicate", "read");
    start("tc-second", "write");

    const reply = projection.messages.find((message) => message.id === "m-tool");
    const toolCalls = toolCallBlocks(reply);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls?.map((block) => block.id)).toEqual([
      "tc-duplicate",
      "tc-second",
    ]);
  });

  it("uses tool/call-start whole-value arguments as the live snapshot", () => {
    const projection = freshProjection("s-whole-args");

    projection.apply(eventFrame("s-whole-args", {
      type: "tool/call-start",
      message_id: "m-args",
      data: {
        tool_call_id: "call-final-args",
        name: "bash",
        arguments: { command: "pnpm test", timeout: 30 },
      },
    }));

    const toolCall = toolCallBlocks(
      projection.messages.find((message) => message.id === "m-args"),
    )?.[0];
    expect(toolCall).toMatchObject({
      id: "call-final-args",
      name: "bash",
      arguments: { command: "pnpm test", timeout: 30 },
    });
    expect(toolCall).not.toHaveProperty("argumentsText");
  });

  it("drops tool/call-start events without message_id", () => {
    const projection = freshProjection("s-no-message-id");

    projection.apply(eventFrame("s-no-message-id", {
      type: "tool/call-start",
      data: { tool_call_id: "tc-1", name: "read", arguments: {} },
    }));
    expect(projection.messages).toEqual([]);
  });

  it("replaces chunk aggregates with the whole-value assistant/message", () => {
    const projection = freshProjection("s-whole-value");

    projection.apply(chunkEvent("s-whole-value", "m-1", "b1", "流式部分"));
    expect(projection.messages[0]).toMatchObject({
      id: "m-1",
      streaming: true,
      content: "流式部分",
    });

    projection.apply(eventFrame("s-whole-value", {
      type: "assistant/message",
      message_id: "m-1",
      data: {
        message: {
          id: "m-1",
          name: "default",
          role: "assistant",
          content: [
            { type: "tool_call", id: "tc-snap-dup", name: "read" },
            { type: "tool_call", id: "tc-snap-dup", name: "bash" },
            { type: "tool_call", id: "tc-snap-other", name: "write" },
          ],
          metadata: {},
          created_at: "2026-08-21T00:00:00Z",
          finished_at: "2026-08-21T00:00:01Z",
          finished_reason: "completed",
        },
      },
    }));

    const message = projection.messages.find((item) => item.id === "m-1");
    // whole-value 覆盖：先前 chunk 的临时聚合被丢弃（F41 I3）。
    expect(message?.content).toBeNull();
    expect(message?.streaming).toBe(false);
    const toolCalls = toolCallBlocks(message);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls?.map((block) => block.id)).toEqual(["tc-snap-dup", "tc-snap-other"]);
    expect(toolCalls?.[0]).toMatchObject({ type: "toolCall", id: "tc-snap-dup", name: "read" });
  });

  it("folds tool results and streams their text into the owning assistant message", () => {
    const projection = freshProjection("s-tool-result");

    projection.apply(eventFrame("s-tool-result", {
      type: "tool/call-start",
      message_id: "m-tool",
      data: { tool_call_id: "tc-1", name: "bash", arguments: { command: "ls" } },
    }));
    projection.apply(eventFrame("s-tool-result", {
      type: "tool/result-start",
      message_id: "m-tool",
      data: { tool_call_id: "tc-1", name: "bash" },
    }));
    projection.apply(eventFrame("s-tool-result", {
      type: "assistant/chunk",
      message_id: "m-tool",
      data: { kind: "tool_result_text", tool_call_id: "tc-1", delta: "src\n" },
    }));
    projection.apply(eventFrame("s-tool-result", {
      type: "assistant/chunk",
      message_id: "m-tool",
      data: { kind: "tool_result_text", tool_call_id: "tc-1", delta: "tests\n" },
    }));

    let message = projection.messages.find((item) => item.id === "m-tool");
    expect(message?.toolResults?.["tc-1"]).toMatchObject({
      status: "running",
      result: "src\ntests\n",
    });

    projection.apply(eventFrame("s-tool-result", {
      type: "tool/result",
      message_id: "m-tool",
      data: {
        tool_call_id: "tc-1",
        name: "bash",
        output: [{ type: "text", text: "src\ntests\n" }],
        state: "success",
        metadata: { duration: 12 },
      },
    }));

    message = projection.messages.find((item) => item.id === "m-tool");
    expect(message?.toolResults?.["tc-1"]).toMatchObject({
      status: "completed",
      result: "src\ntests\n",
      metadata: { duration: 12 },
    });
    expect(toolCallBlocks(message)?.[0]).toMatchObject({ id: "tc-1", name: "bash" });
  });

  it("renders an asking confirm card from approval/asked and resolves it on tool/result", () => {
    const projection = freshProjection("s-approval");

    projection.apply(eventFrame("s-approval", {
      type: "tool/call-start",
      message_id: "m-ask",
      data: { tool_call_id: "tc-ask", name: "bash", arguments: { command: "rm -rf /" } },
    }));
    projection.apply(eventFrame("s-approval", {
      type: "approval/asked",
      message_id: "m-ask",
      data: {
        tool_call_id: "tc-ask",
        name: "bash",
        arguments: { command: "rm -rf /" },
        reason: "高危命令",
        rule_id: "rule-1",
      },
    }));

    let message = projection.messages.find((item) => item.id === "m-ask");
    expect(message?.toolResults?.["tc-ask"]).toMatchObject({
      status: "asking",
      confirm: { reason: "高危命令", ruleId: "rule-1" },
    });

    projection.apply(eventFrame("s-approval", {
      type: "tool/result",
      message_id: "m-ask",
      data: {
        tool_call_id: "tc-ask",
        name: "bash",
        output: [{ type: "text", text: "[USER_DENIED] 用户拒绝了工具 [bash] 的执行" }],
        state: "denied",
        metadata: {},
      },
    }));

    message = projection.messages.find((item) => item.id === "m-ask");
    expect(message?.toolResults?.["tc-ask"]).toMatchObject({ status: "denied" });
  });

  it("applies turn/end final state and token usage onto the message_id message", () => {
    const projection = freshProjection("s-turn-end");

    projection.apply(chunkEvent("s-turn-end", "m-final", "b1", "答案"));
    projection.apply(eventFrame("s-turn-end", {
      type: "turn/end",
      message_id: "m-final",
      data: {
        turn_id: "t-9",
        request_id: "r-9",
        outcome: "completed",
        reason: "completed",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        iterations: 2,
      },
    }));

    const message = projection.messages.find((item) => item.id === "m-final");
    expect(message).toMatchObject({
      streaming: false,
      token: { usage: { total_tokens: 15 } },
    });
    expect(message?.finishedAt).toBe(Date.parse("2026-09-01T00:00:00Z"));

    // error outcome 落到消息 error 字段。
    projection.apply(chunkEvent("s-turn-end", "m-err", "b2", "出错了"));
    projection.apply(eventFrame("s-turn-end", {
      type: "turn/end",
      message_id: "m-err",
      data: {
        turn_id: "t-10",
        request_id: "r-10",
        outcome: "error",
        reason: "error",
        error: { code: "llm_error", message: "provider 500" },
        iterations: 1,
      },
    }));
    const errored = projection.messages.find((item) => item.id === "m-err");
    expect(errored).toMatchObject({
      isError: true,
      error: { code: "llm_error", message: "provider 500" },
    });
  });

  it("normalizes cancelled and crashed turn outcomes like the server derive", () => {
    const projection = freshProjection("s-finished-reason");
    projection.apply(eventFrame("s-finished-reason", {
      type: "assistant/chunk",
      message_id: "m-cancelled",
      data: { kind: "text", block_id: "b", delta: "partial" },
    }));
    projection.apply(eventFrame("s-finished-reason", {
      type: "turn/end",
      message_id: "m-cancelled",
      data: { outcome: "cancelled", reason: "cancelled" },
    }));
    expect(projection.events.assembler.messageById("m-cancelled")?.finished_reason)
      .toBe("completed");

    projection.apply(eventFrame("s-finished-reason", {
      type: "assistant/chunk",
      message_id: "m-crashed",
      data: { kind: "text", block_id: "b2", delta: "partial" },
    }));
    projection.apply(eventFrame("s-finished-reason", {
      type: "turn/end",
      message_id: "m-crashed",
      data: { outcome: "error", reason: "crashed" },
    }));
    expect(projection.events.assembler.messageById("m-crashed")?.finished_reason)
      .toBe("interrupted");
  });

  it("only session/status blocked transitions flip the blocked state", () => {
    const projection = freshProjection("s-blocked");

    projection.apply(eventFrame("s-blocked", {
      type: "session/status",
      data: { status: "blocked", reason: "inbox" },
    }));
    expect(projection).toMatchObject({
      sessionStatus: "blocked",
      blockedReason: "inbox",
      clientCanSend: false,
    });

    projection.apply(eventFrame("s-blocked", {
      type: "session/status",
      data: { status: "idle", reason: "unblocked" },
    }));
    expect(projection).toMatchObject({
      sessionStatus: "idle",
      blockedReason: null,
      clientCanSend: true,
    });
  });

  it("turn/retry drives the retry banner state", () => {
    const projection = freshProjection("s-retry");

    projection.apply(eventFrame("s-retry", {
      type: "turn/retry",
      data: { turn_id: "t-1", code: "rate_limited", message: "限流", attempt: 1, max_attempts: 3 },
    }));

    expect(projection.retryState).toEqual({
      attempt: 1,
      maxAttempts: 3,
      message: "限流",
    });
  });

  it("replaying the same event is idempotent by seq", () => {
    const projection = freshProjection("s-idempotent");

    const frame = eventFrame("s-idempotent", {
      type: "user/message",
      message_id: "message-claimed",
      data: { content: [{ type: "text", text: "hello" }], metadata: {}, request_id: "request-claimed" },
    });
    projection.apply(frame);
    projection.apply(frame);

    expect(projection.messages).toHaveLength(1);
    expect(projection.events.lastSeq).toBe(0);
  });

  it("counts unknown event types without breaking the cursor", () => {
    const projection = freshProjection("s-unknown");

    projection.apply(eventFrame("s-unknown", {
      type: "user/message",
      message_id: "u-1",
      data: { content: [{ type: "text", text: "hi" }], metadata: {}, request_id: "r-1" },
    }));
    projection.apply(eventFrame("s-unknown", {
      type: "future/x",
      data: { anything: true },
    }));

    expect(projection.messages).toHaveLength(1);
    expect(projection.events.assembler.unknownEventCount).toBe(1);
    expect(projection.events.lastSeq).toBe(1);
  });

  it("folds attach events after the HTTP Msg baseline", async () => {
    const sid = "s-wire-attach";
    useChat.getState().clearSessionCache(sid);
    useChat.setState({ sessionId: sid });

    wsMessageHandler.current?.(wireFrame(sid, "session/subscribed", {
      seq: 1,
      events: [
        {
          type: "assistant/chunk",
          seq: 0,
          time: 2_000,
          message_id: "a-new",
          data: { kind: "text", block_id: "b-new", delta: "新" },
        },
        {
          type: "assistant/chunk",
          seq: 1,
          time: 2_001,
          message_id: "a-new",
          data: { kind: "text", block_id: "b-new", delta: "回复" },
        },
      ],
      status: "idle",
      has_more: false,
      resync_required: false,
    }));
    seqCounters.set(sid, 1);
    wsMessageHandler.current?.(eventFrame(sid, {
      type: "assistant/chunk",
      message_id: "a-new",
      data: { kind: "text", block_id: "b-new", delta: "!" },
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(useChat.getState().messages.map((message) => message.id)).toEqual([
      "a-new",
    ]);
    expect(useChat.getState().messages.at(-1)?.content).toBe("新回复!");
  });

  it("newChat resets the active conversation", async () => {
    const { wsClient } = await import("@/services/websocket-client");
    useChat.setState({
      sessionId: "s1",
      messages: [{ id: "u1", role: "user", content: "hello", timestamp: 1 }],
      sessionStatus: "running",
    });

    useChat.getState().newChat();

    expect(useChat.getState()).toMatchObject({
      sessionId: null,
      messages: [],
      sessionStatus: "idle",
    });
    expect(wsClient.subscribeOnly).toHaveBeenCalledWith(null);
  });

  it("sends non-empty content through the active session", async () => {
    const { wsClient } = await import("@/services/websocket-client");
    useChat.setState({ sessionId: "s1" });

    const result = useChat.getState().sendMessage(" hello ");

    expect(result).toMatchObject({ ok: true, requestId: expect.any(String) });

    expect(wsClient.sendChat).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({ session_id: "s1", agent_id: "default" }),
      undefined,
      expect.any(String),
    );
    expect(useChat.getState().messages).toEqual([]);
    expect(useChat.getState().pendingMessages).toEqual([expect.objectContaining({
      content: "hello",
      request_id: expect.stringMatching(/^local:/),
      optimistic: true,
    })]);
  });

  it("allows another message while the current turn is running", async () => {
    const { wsClient } = await import("@/services/websocket-client");
    useChat.setState({
      sessionId: "s-running",
      sessionStatus: "running",
      sessionActivity: "executing",
      clientCanSend: true,
      canCancel: true,
    });

    const result = useChat.getState().sendMessage("next message");

    expect(result.ok).toBe(true);
    expect(wsClient.sendChat).toHaveBeenCalledOnce();
    expect(useChat.getState().messages).toEqual([]);
    expect(useChat.getState().pendingMessages).toEqual([expect.objectContaining({
      content: "next message",
      optimistic: true,
    })]);
  });

  it("uses the authoritative pending queue without creating a chat bubble", () => {
    const projection = freshProjection("s-pending-authoritative");
    projection.sessionRevision = 3;

    applyQueueSnapshot(projection, {
      session_id: "s-pending-authoritative",
      revision: 4,
      items: [{
        id: "request-pending",
        placement: "queued",
        message: { content: [{ type: "text", text: "/compress-fast 0" }] },
      }],
    });

    expect(projection.messages).toEqual([]);
    expect(projection.pendingMessages).toEqual([expect.objectContaining({
      request_id: "request-pending",
      content: "/compress-fast 0",
      placement: "queued",
    })]);
    expect(projection.sessionStatus).toBe("idle");
  });

  it("keeps the steering placement from the queue snapshot", () => {
    const projection = freshProjection("s-steer-placement");

    applyQueueSnapshot(projection, {
      session_id: "s-steer-placement",
      revision: 1,
      items: [{
        id: "request-steer",
        placement: "steering",
        message: { content: [{ type: "text", text: "插入下一轮" }] },
      }],
    });

    expect(projection.pendingMessages[0]).toMatchObject({
      request_id: "request-steer",
      placement: "steering",
    });
  });

  it("uses server placement and ignores an older queue snapshot", () => {
    const projection = freshProjection("s-stale-snapshot");

    applyQueueSnapshot(projection, {
      session_id: "s-stale-snapshot",
      revision: 2,
      items: [{
        id: "request-steer",
        placement: "steering",
        message: { content: [{ type: "text", text: "插入下一轮" }] },
      }],
    });
    applyQueueSnapshot(projection, {
      session_id: "s-stale-snapshot",
      revision: 1,
      items: [{
        id: "request-steer",
        placement: "queued",
        message: { content: [{ type: "text", text: "插入下一轮" }] },
      }],
    });

    expect(projection.pendingMessages[0]).toMatchObject({ placement: "steering" });
  });

  it("keeps an unacknowledged local queue item when an unrelated snapshot arrives", () => {
    const projection = freshProjection("s-local-preview");
    projection.sessionRevision = 3;
    projection.pendingMessages = [{
      request_id: "local:client-B",
      sequence: 0,
      content: "B",
      optimistic: true,
    }];

    applyQueueSnapshot(projection, {
      session_id: "s-local-preview",
      revision: 4,
      items: [{
        id: "request-A",
        placement: "queued",
        message: { content: [{ type: "text", text: "A" }] },
      }],
    });

    expect(projection.pendingMessages.map((item) => item.content)).toEqual(["A", "B"]);
    expect(projection.queueDepth).toBe(2);
  });

  it("removes an optimistic item when its operation response already claims it", () => {
    const projection = freshProjection("s-claimed-before-response");
    projection.pendingMessages = [{
      request_id: "local:request-claimed-before-response",
      sequence: 0,
      content: "已被立即领取",
      optimistic: true,
    }];

    // Inbox 在 session.prompt 响应前已经完成 claim，所以权威快照为空。
    // rpc request_id 证明这是该发送操作的结算响应，不能继续显示本地项。
    applyQueueSnapshot(
      projection,
      { session_id: "s-claimed-before-response", revision: 1, items: [] },
      "request-claimed-before-response",
    );

    expect(projection.pendingMessages).toEqual([]);
    expect(projection.queueDepth).toBe(0);
  });

  it("settles an older operation response after a newer background snapshot", () => {
    const projection = freshProjection("s-out-of-order");
    projection.sessionRevision = 5;
    projection.hasCoordinatorState = true;
    projection.sessionStatus = "running";
    projection.sessionActivity = "executing";
    projection.pendingMessages = [{
      request_id: "local:request-out-of-order",
      sequence: 0,
      content: "乱序消息",
      optimistic: true,
    }];

    // 更高 revision 的后台广播先到，旧响应随后到达时仍需结算本地预览。
    applyQueueSnapshot(projection, {
      session_id: "s-out-of-order",
      revision: 6,
      items: [],
    });
    expect(projection.pendingMessages).toHaveLength(1);

    applyQueueSnapshot(
      projection,
      { session_id: "s-out-of-order", revision: 5, items: [] },
      "request-out-of-order",
    );

    expect(projection.pendingMessages).toEqual([]);
    expect(projection.queueDepth).toBe(0);
    expect(projection.sessionRevision).toBe(6);
  });

  it("removes a pending item when user/message proves it was claimed", () => {
    const projection = freshProjection("s-handoff");
    projection.hasCoordinatorState = true;
    projection.sessionStatus = "running";
    projection.sessionActivity = "executing";
    projection.pendingMessages = [{
      request_id: "request-handoff",
      sequence: 1,
      content: "hello",
      optimistic: false,
    }];

    projection.apply(eventFrame("s-handoff", {
      type: "user/message",
      message_id: "message-handoff",
      data: {
        content: [{ type: "text", text: "hello" }],
        metadata: {},
        request_id: "request-handoff",
      },
    }));

    // user/message 只会在 Inbox 完成 DB-first claim 前持久化，因此它到达时
    // 队列项已经消费，不能继续留在待执行横幅。
    expect(projection.pendingMessages).toEqual([]);
    expect(projection.messages).toEqual([expect.objectContaining({
      id: "message-handoff",
      role: "user",
      content: "hello",
    })]);

    applyQueueSnapshot(projection, { session_id: "s-handoff", revision: 5, items: [] });
    expect(projection.pendingMessages).toEqual([]);
  });

  it("routes the next assistant by server message_id without client-side splitting", () => {
    const projection = freshProjection("s-steering-split");

    projection.apply(chunkEvent("s-steering-split", "assistant-A", "before", "前半段"));
    projection.apply(eventFrame("s-steering-split", {
      type: "user/message",
      message_id: "message-steer",
      data: {
        content: [{ type: "text", text: "插入下一步" }],
        metadata: {},
        request_id: "request-steer",
      },
    }));

    expect(projection.messages.map((message) => message.role)).toEqual(["assistant", "user"]);
    expect(projection.messages[0]).toMatchObject({
      id: "assistant-A",
      streaming: false,
      content: "前半段",
    });

    projection.apply(chunkEvent("s-steering-split", "assistant-B", "after", "后半段"));

    expect(projection.messages.map((message) => message.role)).toEqual([
      "assistant", "user", "assistant",
    ]);
    expect(projection.messages[2]).toMatchObject({
      id: "assistant-B",
      streaming: true,
      content: "后半段",
    });
  });

  it("removes a claimed item immediately when queue snapshot beats the user echo", () => {
    const projection = freshProjection("s-claimed");
    projection.hasCoordinatorState = true;
    projection.sessionStatus = "running";
    projection.sessionActivity = "executing";

    // 先收到 rpc 结算对应的服务端 pending 快照：本地 optimistic 项目被接纳。
    projection.pendingMessages = [{
      request_id: "request-claimed",
      sequence: 0,
      content: "hello",
      optimistic: true,
    }];
    applyQueueSnapshot(projection, {
      session_id: "s-claimed",
      revision: 5,
      items: [{
        id: "request-claimed",
        placement: "queued",
        message: { content: [{ type: "text", text: "hello" }] },
      }],
    });

    // worker 已经 claim，权威 pending 为空；即使 user/message 尚未到达，
    // 已消费项也不能继续显示在消息队列中。
    applyQueueSnapshot(projection, { session_id: "s-claimed", revision: 6, items: [] });
    expect(projection.pendingMessages).toEqual([]);
    expect(projection.queueDepth).toBe(0);

    projection.apply(eventFrame("s-claimed", {
      type: "user/message",
      message_id: "message-claimed",
      data: { content: [{ type: "text", text: "hello" }], metadata: {}, request_id: "request-claimed" },
    }));
    expect(projection.pendingMessages).toEqual([]);
    expect(projection.messages).toEqual([expect.objectContaining({
      id: "message-claimed",
      content: "hello",
    })]);
  });

  it("does not send empty content", async () => {
    const { wsClient } = await import("@/services/websocket-client");
    useChat.setState({ sessionId: "s1" });

    useChat.getState().sendMessage("   ");

    expect(wsClient.sendChat).not.toHaveBeenCalled();
  });

  it("does not create an optimistic bubble when the transport outbox is full", async () => {
    const { wsClient } = await import("@/services/websocket-client");
    vi.mocked(wsClient.sendChat).mockReturnValueOnce({
      ok: false,
      reason: "outbox_full",
      requestId: "client-full",
    });
    useChat.getState().clearSessionCache("s-full");
    useChat.setState({ sessionId: "s-full", messages: [] });

    const result = useChat.getState().sendMessage("keep this draft");

    expect(result).toEqual({ ok: false, reason: "outbox_full" });
    expect(useChat.getState().messages).toEqual([]);
  });

  it("uses one session creation request and flushes all temporary messages", async () => {
    const { createSessionRemote } = await import("@/services/api");
    const { wsClient } = await import("@/services/websocket-client");
    let resolveSession!: (value: { session_id: string }) => void;
    vi.mocked(createSessionRemote).mockReturnValueOnce(new Promise((resolve) => {
      resolveSession = resolve;
    }));
    useChat.setState({ sessionId: null, messages: [] });

    const first = useChat.getState().sendMessage("first");
    const second = useChat.getState().sendMessage("second");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(createSessionRemote).toHaveBeenCalledOnce();
    expect(useChat.getState().messages).toEqual([]);
    expect(useChat.getState().pendingMessages.map((message) => message.content)).toEqual([
      "first",
      "second",
    ]);

    resolveSession({ session_id: "s-created" });
    await vi.waitFor(() => {
      expect(useChat.getState().sessionId).toBe("s-created");
      expect(wsClient.sendChat).toHaveBeenCalledTimes(2);
    });
    expect(wsClient.subscribeOnly).toHaveBeenCalledWith("s-created");
    expect(useChat.getState().messages).toEqual([]);
    expect(useChat.getState().pendingMessages.map((message) => message.content)).toEqual([
      "first",
      "second",
    ]);
  });
});

// ─── SessionEventClient：seq attach 恢复 ─────────────────────────────

describe("SessionEventClient recovery", () => {
  const ev = (seq: number, type: string, data: Record<string, unknown> = {}, messageId: string | null = null): SessionEvent => ({
    type,
    seq,
    time: 1_000,
    message_id: messageId,
    data,
  });

  it("buffers live events on seq gaps until attach returns the missing events", () => {
    const attach = vi.fn();
    const client = new SessionEventClient({
      sessionId: "s-gap",
      onGap: attach,
    });

    client.ingest(ev(0, "user/message", { content: [], metadata: {}, request_id: "r0" }, "u0"));
    // 跳号 1、2：直播帧 3 先到 → 入缓冲并要求重新 attach。
    client.ingest(ev(3, "assistant/chunk", { kind: "text", block_id: "b", delta: "tail" }, "m1"));
    expect(client.assembler.lastSeq).toBe(0);
    expect(attach).toHaveBeenCalledOnce();

    client.applyAttach([
      ev(1, "assistant/chunk", { kind: "text", block_id: "b", delta: "head " }, "m1"),
      ev(2, "assistant/chunk", { kind: "text", block_id: "b", delta: "mid " }, "m1"),
    ], 3);

    expect(client.assembler.lastSeq).toBe(3);
    const message = client.assembler.messageById("m1");
    const text = (message?.content ?? []).find((block) => block.type === "text") as { text?: string };
    expect(text?.text).toBe("head mid tail");
  });

  it("requests HTTP resync when attach cannot provide the old events", () => {
    const resync = vi.fn();
    const client = new SessionEventClient({
      sessionId: "s-ahead",
      onResyncRequired: resync,
    });
    client.seedHistory([], 7);
    client.applyAttach([], 7, true);
    expect(resync).toHaveBeenCalledOnce();
  });
});
