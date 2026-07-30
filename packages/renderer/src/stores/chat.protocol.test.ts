import { describe, expect, it, vi } from "vitest";
import { applyEvent, applyReplySnapshot, useChat, type BusEvent, type ChatMessage, type PlanData } from "./chat";
import { wsClient } from "@/services/websocket-client";

vi.mock("@/services/websocket-client", () => ({
  CompactEventName: {
    START: "context_compact_start",
    DONE: "context_compact_done",
    FAILED: "context_compact_failed",
  },
  UserMessageEventType: "USER_MESSAGE",
  wsClient: {
    onMessage: vi.fn(),
    onDisconnect: vi.fn(),
    onConnect: vi.fn(),
    onStatusChange: vi.fn(),
    connect: vi.fn(),
    sendChat: vi.fn(),
    connected: false,
    status: "disconnected",
  },
}));

function createBucket() {
  return {
    messages: [] as ChatMessage[],
    events: [] as BusEvent[],
    seenEventIds: new Set<string>(),
    earliestTs: null as number | null,
    hasMoreHistory: false,
    lastUserInputTs: null as number | null,
    sessionStatus: "idle" as const,
    isBusy: false,
    error: null as string | null,
    retryState: null,
    turnStartTs: null as number | null,
    commandName: null as string | null,
    plan: null as PlanData | null,
  };
}

function coreEvent(type: string, data: Record<string, unknown>): BusEvent {
  return {
    type,
    eventId: `${type}-${Math.random()}`,
    data: { type, reply_id: "reply-1", ...data },
    ts: 1_000,
  };
}

describe("AgentStreamEvent reducer", () => {
  it("does not create or send a user message while compacting", () => {
    useChat.setState({
      sessionId: "ws_sess_compacting",
      sessionStatus: "compacting",
      isBusy: false,
      messages: [],
    });

    useChat.getState().sendMessage("should be dropped");

    expect(useChat.getState().messages).toEqual([]);
    expect(wsClient.sendChat).not.toHaveBeenCalled();
  });

  it("renders a core USER_MESSAGE event", () => {
    const bucket = createBucket();
    applyEvent(bucket, coreEvent("USER_MESSAGE", {
      id: "user-msg-1",
      data: { content: "hello" },
    }));

    expect(bucket.messages).toHaveLength(1);
    expect(bucket.messages[0]).toMatchObject({
      id: "user-msg-1",
      role: "user",
      content: "hello",
    });
  });

  it("assembles text, tool calls, tool results and reply lifecycle", () => {
    const bucket = createBucket();

    applyEvent(bucket, coreEvent("REPLY_START", { name: "assistant" }));
    applyEvent(bucket, coreEvent("MODEL_CALL_START", { model_name: "gpt-test" }));
    applyEvent(bucket, coreEvent("TEXT_BLOCK_START", { block_id: "text-1" }));
    applyEvent(bucket, coreEvent("TEXT_BLOCK_DELTA", { block_id: "text-1", delta: "Hello " }));
    applyEvent(bucket, coreEvent("TEXT_BLOCK_DELTA", { block_id: "text-1", delta: "world" }));
    applyEvent(bucket, coreEvent("TOOL_CALL_START", {
      tool_call_id: "call-1",
      tool_call_name: "read",
    }));
    applyEvent(bucket, coreEvent("TOOL_CALL_DELTA", {
      tool_call_id: "call-1",
      delta: "{\"path\":\"README.md\"}",
    }));
    applyEvent(bucket, coreEvent("TOOL_CALL_END", { tool_call_id: "call-1" }));
    applyEvent(bucket, coreEvent("TOOL_RESULT_START", {
      tool_call_id: "call-1",
      tool_call_name: "read",
    }));
    applyEvent(bucket, coreEvent("TOOL_RESULT_TEXT_DELTA", {
      tool_call_id: "call-1",
      delta: "file contents",
    }));
    applyEvent(bucket, coreEvent("TOOL_RESULT_END", {
      tool_call_id: "call-1",
      state: "success",
      metadata: { file: "README.md" },
    }));
    applyEvent(bucket, coreEvent("MODEL_CALL_END", {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    }));
    applyEvent(bucket, coreEvent("REPLY_END", { finished_reason: "completed" }));

    expect(bucket.messages).toHaveLength(1);
    const message = bucket.messages[0];
    expect(message.content).toBe("Hello world");
    expect(message.streaming).toBe(false);
    expect(message.model).toBe("gpt-test");
    expect(message.token?.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
    expect(message.token?.last_call_usage).toEqual(message.token?.usage);
    expect(message.blocks?.find((block) => block.type === "toolCall")).toMatchObject({
      id: "call-1",
      name: "read",
      arguments: { path: "README.md" },
    });
    expect(message.toolResults?.["call-1"]).toMatchObject({
      result: "file contents",
      status: "completed",
      metadata: { file: "README.md" },
    });
  });

  it("uses CUSTOM events for turn lifecycle state", () => {
    const bucket = createBucket();

    applyEvent(bucket, coreEvent("CUSTOM", {
      name: "TURN_START",
      value: {},
    }));
    expect(bucket.isBusy).toBe(true);

    applyEvent(bucket, coreEvent("CUSTOM", {
      name: "TURN_END",
      value: {},
    }));
    expect(bucket.isBusy).toBe(false);
    expect(bucket.sessionStatus).toBe("idle");
  });

  it("accumulates Reply usage and keeps the last model call separately", () => {
    const bucket = createBucket();

    applyEvent(bucket, coreEvent("REPLY_START", { name: "assistant" }));
    applyEvent(bucket, coreEvent("MODEL_CALL_END", {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
    }));
    applyEvent(bucket, coreEvent("MODEL_CALL_END", {
      prompt_tokens: 150,
      completion_tokens: 30,
      total_tokens: 180,
    }));

    expect(bucket.messages[0].token).toEqual({
      usage: {
        prompt_tokens: 250,
        completion_tokens: 50,
        total_tokens: 300,
      },
      last_call_usage: {
        prompt_tokens: 150,
        completion_tokens: 30,
        total_tokens: 180,
      },
    });
  });

  it("replaces an open Reply with an attach snapshot then continues by reply_id", () => {
    const bucket = createBucket();
    applyReplySnapshot(bucket, {
      session_id: "ws_sess_test",
      replies: [{
        reply_id: "reply-1",
        revision: 4,
        message: {
          id: "reply-1",
          role: "assistant",
          content: [{ type: "text", id: "text-1", text: "already persisted" }],
          metadata: {},
          created_at: "2026-07-28T10:00:00Z",
          finished_at: null,
          finished_reason: null,
          token: null,
        },
      }],
    });

    applyEvent(bucket, coreEvent("TEXT_BLOCK_DELTA", {
      block_id: "text-1",
      delta: " + live",
    }));

    expect(bucket.messages).toHaveLength(1);
    expect(bucket.messages[0]).toMatchObject({
      id: "reply-1",
      content: "already persisted + live",
      streaming: true,
    });
  });

  it("restores an active compact event from attach snapshot", () => {
    const bucket = createBucket();
    applyReplySnapshot(bucket, {
      session_id: "ws_sess_test",
      replies: [],
      events: [{
        type: "CUSTOM",
        id: "compact-start-1",
        created_at: "2026-07-28T10:00:00Z",
        name: "context_compact_start",
        value: { tokens: 2000 },
      }],
    });

    expect(bucket.sessionStatus).toBe("compacting");
    expect(bucket.messages).toHaveLength(1);
    expect(bucket.messages[0].compact).toMatchObject({
      status: "running",
      tokensBefore: 2000,
    });
  });

  it("does not let an older snapshot overwrite a newer one", () => {
    const bucket = createBucket();
    const snapshot = (revision: number, text: string) => ({
      session_id: "ws_sess_test",
      replies: [{
        reply_id: "reply-1",
        revision,
        message: {
          id: "reply-1", role: "assistant",
          content: [{ type: "text", id: "text-1", text }],
          metadata: {}, created_at: "2026-07-28T10:00:00Z",
          finished_at: null, finished_reason: null, token: null,
        },
      }],
    });
    applyReplySnapshot(bucket, snapshot(5, "new"));
    applyReplySnapshot(bucket, snapshot(4, "old"));
    expect(bucket.messages[0].content).toBe("new");
  });

  it("does not let an equal-revision snapshot erase a later live delta", () => {
    const bucket = createBucket();
    const payload = {
      session_id: "ws_sess_test",
      replies: [{
        reply_id: "reply-1",
        revision: 5,
        message: {
          id: "reply-1",
          role: "assistant",
          content: [{ type: "text", id: "text-1", text: "checkpoint" }],
          metadata: { model: "gpt-test" },
          created_at: "2026-07-28T10:00:00Z",
          finished_at: null,
          finished_reason: null,
          token: null,
        },
      }],
    };

    applyReplySnapshot(bucket, payload);
    applyEvent(bucket, coreEvent("TEXT_BLOCK_DELTA", {
      block_id: "text-1",
      delta: " + live",
    }));
    applyReplySnapshot(bucket, payload);

    expect(bucket.messages[0].content).toBe("checkpoint + live");
    expect(bucket.messages[0].model).toBe("gpt-test");
    expect(bucket.turnStartTs).toBe(Date.parse("2026-07-28T10:00:00Z"));
  });

  it("attaches a reply error to the original Assistant message", () => {
    const bucket = createBucket();
    applyEvent(bucket, coreEvent("REPLY_START", { name: "assistant" }));
    applyEvent(bucket, coreEvent("TEXT_BLOCK_START", { block_id: "text-1" }));
    applyEvent(bucket, coreEvent("TEXT_BLOCK_DELTA", {
      block_id: "text-1",
      delta: "partial answer",
    }));
    applyEvent(bucket, coreEvent("REPLY_END", {
      finished_reason: "error",
      error: { code: "bad_request", message: "request failed" },
    }));

    expect(bucket.messages).toHaveLength(1);
    expect(bucket.messages[0]).toMatchObject({
      content: "partial answer",
      streaming: false,
      isError: true,
      error: { code: "bad_request", message: "request failed" },
    });
  });
});
