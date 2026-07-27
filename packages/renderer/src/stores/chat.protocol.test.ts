import { describe, expect, it, vi } from "vitest";
import { applyEvent, type BusEvent, type ChatMessage, type PlanData } from "./chat";

vi.mock("@/services/websocket-client", () => ({
  wsClient: {
    onMessage: vi.fn(),
    onDisconnect: vi.fn(),
    onConnect: vi.fn(),
    onStatusChange: vi.fn(),
    connect: vi.fn(),
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
      input_tokens: 10,
      output_tokens: 5,
    }));
    applyEvent(bucket, coreEvent("REPLY_END", { finished_reason: "completed" }));

    expect(bucket.messages).toHaveLength(1);
    const message = bucket.messages[0];
    expect(message.content).toBe("Hello world");
    expect(message.streaming).toBe(false);
    expect(message.model).toBe("gpt-test");
    expect(message.usage?.total_tokens).toBe(15);
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
});
