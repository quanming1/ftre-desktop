import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyEvent,
  applyQueueSnapshot,
  applyReplySnapshot,
  useChat,
} from "./chat";
import type { ContentBlock } from "./chat";
import { ClientSessionProjection } from "./clientSessionProjection";
import { UserMessageEventType } from "@/services/websocket-client";

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

function resetStore() {
  useChat.getState().newChat();
  useChat.setState({
    connected: false,
    wsStatus: "disconnected",
    model: null,
    provider: null,
    agentId: "default",
  });
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

  it("does not treat a session.cancel response as a queue operation response", () => {
    useChat.setState({
      sessionId: "s1",
      sessionStatus: "idle",
      sessionActivity: "idle",
      isBusy: false,
      pendingMessages: [],
      queueDepth: 0,
    });

    wsMessageHandler.current?.({
      request_id: "cancel-1",
      ok: true,
      value: { accepted: true, session_id: "s1" },
    });

    expect(useChat.getState()).toMatchObject({
      sessionStatus: "idle",
      isBusy: false,
      pendingMessages: [],
    });
  });

  it("uses the queue response as the durable admission result", () => {
    useChat.setState({ sessionId: "s1-admission" });
    const result = useChat.getState().sendMessage("普通排队消息");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    wsMessageHandler.current?.({
      type: "session/queue",
      request_id: result.requestId,
      ok: true,
      payload: {
        session_id: "s1-admission",
        revision: 1,
        items: [{
          id: result.requestId,
          placement: "queued",
          message: { content: [{ type: "text", text: "普通排队消息" }] },
        }],
      },
    });

    expect(useChat.getState().pendingMessages[0]).toMatchObject({
      request_id: result.requestId,
      placement: "queued",
    });
    expect(useChat.getState().pendingMessages[0]).not.toHaveProperty("optimistic", true);
    expect(useChat.getState().pendingMessages[0]).not.toHaveProperty("awaitingEcho", true);
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
    const projection = new ClientSessionProjection({
      applyEvent,
      applyReplySnapshot,
    });

    projection.apply({
      type: "CUSTOM",
      eventId: "compact-start",
      data: {
        name: "context_compact_start",
        value: { model: "deepseek-v4-flash", tokens: 2_000 },
      },
    });

    expect(projection.messages).toEqual([expect.objectContaining({
      compact: expect.objectContaining({
        status: "running",
        model: "deepseek-v4-flash",
      }),
    })]);
  });

  it("deduplicates repeated tool call starts by tool_call_id", () => {
    const projection = new ClientSessionProjection({
      applyEvent,
      applyReplySnapshot,
    });

    const start = (eventId: string, toolCallId: string, name: string) => applyEvent(projection, {
      type: "TOOL_CALL_START",
      eventId,
      data: {
        reply_id: "reply-tool-dedupe",
        message_id: "reply-tool-dedupe",
        tool_call_id: toolCallId,
        tool_call_name: name,
      },
    });

    applyEvent(projection, {
      type: "REPLY_START",
      eventId: "reply-start",
      data: { reply_id: "reply-tool-dedupe", message_id: "reply-tool-dedupe" },
    });
    start("tool-start-1", "tc-duplicate", "read");
    start("tool-start-2", "tc-duplicate", "read");
    start("tool-start-3", "tc-second", "write");
    applyEvent(projection, {
      type: "TOOL_CALL_DELTA",
      eventId: "tool-delta",
      data: {
        reply_id: "reply-tool-dedupe",
        message_id: "reply-tool-dedupe",
        tool_call_id: "tc-duplicate",
        delta: '{"path":"README.md"}',
      },
    });
    applyEvent(projection, {
      type: "TOOL_CALL_END",
      eventId: "tool-end",
      data: {
        reply_id: "reply-tool-dedupe",
        message_id: "reply-tool-dedupe",
        tool_call_id: "tc-duplicate",
      },
    });

    const reply = projection.messages.find((message) => message.id === "reply-tool-dedupe");
    const toolCalls = reply?.blocks?.filter(
      (block): block is Extract<ContentBlock, { type: "toolCall" }> => block.type === "toolCall",
    );
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls?.map((block) => block.type === "toolCall" && block.id)).toEqual([
      "tc-duplicate",
      "tc-second",
    ]);
    expect(toolCalls?.[0]).toMatchObject({
      type: "toolCall",
      id: "tc-duplicate",
      name: "read",
      arguments: { path: "README.md" },
    });
  });

  it("drops old assistant events without message_id", () => {
    const projection = new ClientSessionProjection({ applyEvent, applyReplySnapshot });
    applyEvent(projection, {
      type: "REPLY_START",
      eventId: "old-reply-start",
      data: { reply_id: "old-reply" },
    });
    expect(projection.messages).toEqual([]);
  });

  it("deduplicates tool_call blocks inside a reply snapshot by id", () => {
    const projection = new ClientSessionProjection({
      applyEvent,
      applyReplySnapshot,
    });

    projection.applySnapshot({
      session_id: "s-snapshot",
      client_connection_epoch: 1,
      replies: [{
        reply_id: "reply-snapshot-dedupe",
        message_id: "reply-snapshot-dedupe",
        revision: 2,
        message: {
          id: "reply-snapshot-dedupe",
          role: "assistant",
          created_at: "2026-08-21T00:00:00Z",
          finished_at: "2026-08-21T00:00:01Z",
          content: [
            { type: "tool_call", id: "tc-snap-dup", name: "read" },
            { type: "tool_call", id: "tc-snap-dup", name: "bash" },
            { type: "tool_call", id: "tc-snap-other", name: "write" },
          ],
        },
      }],
    });

    const reply = projection.messages.find((message) => message.id === "reply-snapshot-dedupe");
    const toolCalls = reply?.blocks?.filter(
      (block): block is Extract<ContentBlock, { type: "toolCall" }> => block.type === "toolCall",
    );
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls?.map((block) => block.id)).toEqual(["tc-snap-dup", "tc-snap-other"]);
    expect(toolCalls?.[0]).toMatchObject({ type: "toolCall", id: "tc-snap-dup", name: "read" });
  });

  it("newChat resets the active conversation", async () => {
    const { wsClient } = await import("@/services/websocket-client");
    useChat.setState({
      sessionId: "s1",
      messages: [{ id: "u1", role: "user", content: "hello", timestamp: 1 }],
      isBusy: true,
      sessionStatus: "running",
    });

    useChat.getState().newChat();

    expect(useChat.getState()).toMatchObject({
      sessionId: null,
      messages: [],
      isBusy: false,
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
      isBusy: true,
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
    const requestId = "request-pending";
    const projection = {
      messages: [],
      seenEventIds: new Set<string>(),
      earliestTs: null,
      hasMoreHistory: true,
      lastUserInputTs: null,
      sessionRevision: 3,
      hasCoordinatorState: false,
      sessionActivity: "idle" as const,
      queueDepth: 0,
      queueCapacity: null,
      pendingMessages: [],
      clientCanSend: true,
      canCancel: false,
      blockedReason: null,
      isBusy: false,
      sessionStatus: "idle" as const,
      retryState: null,
      commandName: null,
      turnStartTs: null,
      error: null,
      plan: null,
    };

    applyQueueSnapshot(projection, {
      session_id: "s1",
      revision: 4,
      items: [{
        id: "request-pending",
        placement: "queued",
        message: { content: [{ type: "text", text: "/compress-fast 0" }] },
      }],
    });

    expect(projection.messages).toEqual([]);
    expect(projection.pendingMessages).toEqual([expect.objectContaining({
      request_id: requestId,
      content: "/compress-fast 0",
      placement: "queued",
    })]);
    expect(projection.sessionStatus).toBe("idle");
  });

  it("keeps the steering placement from the queue snapshot", () => {
    const projection = {
      messages: [],
      seenEventIds: new Set<string>(),
      earliestTs: null,
      hasMoreHistory: true,
      lastUserInputTs: null,
      sessionRevision: 0,
      hasCoordinatorState: true,
      sessionActivity: "executing" as const,
      queueDepth: 1,
      queueCapacity: null,
      pendingMessages: [],
      clientCanSend: true,
      canCancel: true,
      blockedReason: null,
      isBusy: true,
      sessionStatus: "running" as const,
      retryState: null,
      commandName: null,
      turnStartTs: null,
      error: null,
      plan: null,
    };

    applyQueueSnapshot(projection, {
      session_id: "s1",
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
    const projection = {
      messages: [],
      seenEventIds: new Set<string>(),
      earliestTs: null,
      hasMoreHistory: true,
      lastUserInputTs: null,
      sessionRevision: -1,
      hasCoordinatorState: true,
      sessionActivity: "executing" as const,
      queueDepth: 1,
      queueCapacity: null,
      pendingMessages: [],
      clientCanSend: true,
      canCancel: true,
      blockedReason: null,
      isBusy: true,
      sessionStatus: "running" as const,
      retryState: null,
      commandName: null,
      turnStartTs: null,
      error: null,
      plan: null,
    };

    applyQueueSnapshot(projection, {
      session_id: "s1",
      revision: 2,
      items: [{
        id: "request-steer",
        placement: "steering",
        message: { content: [{ type: "text", text: "插入下一轮" }] },
      }],
    });
    applyQueueSnapshot(projection, {
      session_id: "s1",
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
    const projection = {
      messages: [],
      seenEventIds: new Set<string>(),
      earliestTs: null,
      hasMoreHistory: true,
      lastUserInputTs: null,
      sessionRevision: 3,
      hasCoordinatorState: false,
      sessionActivity: "idle" as const,
      queueDepth: 1,
      queueCapacity: null,
      pendingMessages: [{
        request_id: "local:client-B",
        sequence: 0,
        content: "B",
        optimistic: true,
      }],
      clientCanSend: true,
      canCancel: false,
      blockedReason: null,
      isBusy: true,
      sessionStatus: "running" as const,
      retryState: null,
      commandName: null,
      turnStartTs: null,
      error: null,
      plan: null,
    };

    applyQueueSnapshot(projection, {
      session_id: "s1",
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

  it("keeps a pending item until the claim snapshot, even after USER_MESSAGE", () => {
    const requestId = "request-handoff";
    const projection = {
      messages: [],
      seenEventIds: new Set<string>(),
      earliestTs: null,
      hasMoreHistory: true,
      lastUserInputTs: null,
      sessionRevision: 4,
      hasCoordinatorState: true,
      sessionActivity: "executing" as const,
      queueDepth: 1,
      queueCapacity: 100,
      pendingMessages: [{
        request_id: "request-handoff",
        sequence: 1,
        content: "hello",
        optimistic: false,
      }],
      clientCanSend: true,
      canCancel: true,
      blockedReason: null,
      isBusy: true,
      sessionStatus: "running" as const,
      retryState: null,
      commandName: null,
      turnStartTs: null,
      error: null,
      plan: null,
    };

    applyEvent(projection, {
      type: UserMessageEventType,
      eventId: "event-handoff",
      metadata: { request_id: requestId },
      data: {
        id: "message-handoff",
        data: {
          content: "hello",
        },
      },
    });

    // UserMessage 回显只证明已落库，不代表 Inbox 已 claim；队列项先保持可见。
    expect(projection.pendingMessages).toEqual([expect.objectContaining({
      request_id: requestId,
    })]);
    expect(projection.messages).toEqual([expect.objectContaining({
      id: "message-handoff",
      role: "user",
      content: "hello",
    })]);

    applyQueueSnapshot(projection, { session_id: "s1", revision: 5, items: [] });
    expect(projection.pendingMessages).toEqual([]);
  });

  it("routes the next assistant by server message_id without client-side splitting", () => {
    const projection = new ClientSessionProjection({ applyEvent, applyReplySnapshot });
    projection.messages = [{
      id: "assistant-A",
      role: "assistant",
      content: "前半段",
      timestamp: 1,
      streaming: true,
      blocks: [{ type: "text", text: "前半段", blockId: "before" }],
      toolResults: {},
      metadata: { reply_id: "reply-live" },
    }];

    applyEvent(projection, {
      type: UserMessageEventType,
      eventId: "user-steer-event",
      metadata: { request_id: "request-steer" },
      data: {
        id: "message-steer",
        data: { content: "插入下一步", request_id: "request-steer" },
      },
    });

    expect(projection.messages.map((message) => message.role)).toEqual(["assistant", "user"]);
    expect(projection.messages[0]).toMatchObject({
      id: "assistant-A",
      streaming: true,
      content: "前半段",
    });

    applyEvent(projection, {
      type: "TEXT_BLOCK_START",
      eventId: "after-start",
      data: { reply_id: "reply-live", message_id: "assistant-B", block_id: "after" },
    });
    applyEvent(projection, {
      type: "TEXT_BLOCK_DELTA",
      eventId: "after-delta",
      data: {
        reply_id: "reply-live", message_id: "assistant-B", block_id: "after", delta: "后半段",
      },
    });

    expect(projection.messages.map((message) => message.role)).toEqual([
      "assistant", "user", "assistant",
    ]);
    expect(projection.messages[2]).toMatchObject({
      id: "assistant-B",
      streaming: true,
      content: "后半段",
    });
    expect(projection.messages[0]).toMatchObject({
      id: "assistant-A",
      streaming: false,
    });
  });

  it("keeps an admitted item visible when claim snapshot beats USER_MESSAGE echo", () => {
    const requestId = "request-claimed";
    const projection = {
      messages: [],
      seenEventIds: new Set<string>(),
      earliestTs: null,
      hasMoreHistory: true,
      lastUserInputTs: null,
      sessionRevision: 4,
      hasCoordinatorState: true,
      sessionActivity: "executing" as const,
      queueDepth: 1,
      queueCapacity: 100,
      pendingMessages: [{
        request_id: requestId,
        sequence: 1,
        content: "hello",
        optimistic: false,
        awaitingEcho: true,
      }],
      clientCanSend: true,
      canCancel: true,
      blockedReason: null,
      isBusy: true,
      sessionStatus: "running" as const,
      retryState: null,
      commandName: null,
      turnStartTs: null,
      error: null,
      plan: null,
    };

    // 先收到 Queue Response 对应的服务端 pending 快照：本地 optimistic 项目被接纳，
    // 仍在 Inbox 中等待消费，不能误显示为“正在消费”。
    projection.pendingMessages = [{
      request_id: requestId,
      sequence: 0,
      content: "hello",
      optimistic: true,
      awaitingEcho: false,
    }];
    applyQueueSnapshot(projection, {
      session_id: "s1",
      revision: 5,
      items: [{
        id: requestId,
        placement: "queued",
        message: { content: [{ type: "text", text: "hello" }] },
      }],
    });
    expect(projection.pendingMessages[0]).not.toHaveProperty("awaitingEcho", true);

    // worker 已经 claim，权威 pending 为空，但 USER_MESSAGE 还没到。
    applyQueueSnapshot(projection, { session_id: "s1", revision: 6, items: [] });
    expect(projection.pendingMessages).toEqual([expect.objectContaining({
      request_id: requestId,
      content: "hello",
      awaitingEcho: true,
    })]);

    applyEvent(projection, {
      type: UserMessageEventType,
      eventId: "event-claimed",
      metadata: { request_id: requestId },
      data: { id: "message-claimed", data: { content: "hello" } },
    });
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
