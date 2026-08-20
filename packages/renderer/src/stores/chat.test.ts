import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyEvent, applyMailboxSnapshot, applyReplySnapshot, useChat } from "./chat";
import { ClientSessionProjection } from "./clientSessionProjection";
import { UserMessageEventType } from "@/services/websocket-client";

vi.mock("@/services/websocket-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/websocket-client")>();
  return {
    ...actual,
    wsClient: {
      onMessage: vi.fn(),
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
    };

    applyMailboxSnapshot(projection, {
      session_id: "s1",
      revision: 4,
      phase: "compacting",
      pending: [{
        request_id: "request-pending",
        sequence: 1,
        content: "/compress-fast 0",
      }],
      capacity: 100,
      accepting_messages: true,
      can_cancel_active: false,
    });

    expect(projection.messages).toEqual([]);
    expect(projection.pendingMessages).toEqual([expect.objectContaining({
      request_id: requestId,
      content: "/compress-fast 0",
    })]);
    expect(projection.sessionStatus).toBe("compacting");
  });

  it("keeps an unacknowledged local queue item when an unrelated snapshot arrives", () => {
    const projection = {
      messages: [],
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
    };

    applyMailboxSnapshot(projection, {
      session_id: "s1",
      revision: 4,
      phase: "running",
      pending: [{
        request_id: "request-A",
        sequence: 1,
        content: "A",
      }],
      capacity: 100,
      accepting_messages: true,
      can_cancel_active: true,
    });

    expect(projection.pendingMessages.map((item) => item.content)).toEqual(["A", "B"]);
    expect(projection.queueDepth).toBe(2);
  });

  it("moves an item from the queue to history only on the persisted USER_MESSAGE echo", () => {
    const requestId = "request-handoff";
    const projection = {
      messages: [],
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

    expect(projection.pendingMessages).toEqual([]);
    expect(projection.messages).toEqual([expect.objectContaining({
      id: "message-handoff",
      role: "user",
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
