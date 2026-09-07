import { describe, expect, it, vi } from "vitest";
import { ClientSessionProjection } from "./clientSessionProjection";
import { applyFrame } from "./chatProjection";
import type { ChatMessage } from "./chat";
import type { SessionEvent, WireFrame, WireMsg } from "@/types/wire.gen";
import { wireMsgFromSessionMessage } from "./sessionEventClient";
import type { SessionMessage } from "@/services/api";

function assistant(
  id: string,
  content: string,
  streaming = false,
  timestamp = 1_000,
): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    timestamp,
    streaming,
    blocks: [{ type: "text", text: content, blockId: `${id}-text` }],
    toolResults: {},
  };
}

function wireOf(
  id: string,
  role: "user" | "assistant",
  content: string,
  timestamp: number,
  streaming = false,
  seq = -1,
): WireMsg {
  return {
    id,
    name: "default",
    role,
    content: [
      { type: "text", id: `${id}-text`, text: content },
    ],
    metadata: {},
    created_at: new Date(timestamp).toISOString(),
    seq,
    finished_at: streaming ? null : new Date(timestamp + 1).toISOString(),
    finished_reason: streaming ? null : "completed",
  };
}

function chunkFrame(sid: string, messageId: string, blockId: string, delta: string): WireFrame {
  return {
    v: 1,
    session_id: sid,
    type: "session/event",
    payload: {
      event: {
        type: "assistant/chunk",
        seq: 0,
        time: 1_000,
        message_id: messageId,
        data: { kind: "text", block_id: blockId, delta },
      } as SessionEvent,
    },
  };
}

function freshProjection(sid: string): ClientSessionProjection {
  return new ClientSessionProjection(
    { applyFrame },
    { sessionId: sid },
  );
}

describe("ClientSessionProjection", () => {
  it("routes realtime event frames through the projection reducer", () => {
    const applyFrameMock = vi.fn((projection, frame: WireFrame) => {
      const event = (frame.payload as { event?: SessionEvent }).event;
      if (frame.type === "session/event" && event?.type === "assistant/chunk") {
        projection.messages = [assistant("reply-1", String(event.data.delta), true)];
      }
    });
    const projection = new ClientSessionProjection(
      { applyFrame: applyFrameMock },
      { sessionId: "s-live" },
    );

    projection.apply(chunkFrame("s-live", "reply-1", "b", "hello"));

    expect(applyFrameMock).toHaveBeenCalledOnce();
    expect(projection.messages[0]).toMatchObject({
      id: "reply-1",
      content: "hello",
      streaming: true,
    });
  });

  it("keeps an in-flight streaming reply when HTTP history does not contain it", () => {
    const projection = freshProjection("s-inflight");
    projection.apply(chunkFrame("s-inflight", "reply-live", "b", "still streaming"));

    projection.hydrate({
      messages: [{ id: "user-1", role: "user", content: "ask", timestamp: 900 }],
      wire: [wireOf("user-1", "user", "ask", 900, true)],
      seq: 3,
      hasMoreHistory: false,
      status: "running",
    });

    expect(projection.messages.map((message) => message.id)).toEqual([
      "user-1",
      "reply-live",
    ]);
    expect(projection.messages[1]).toMatchObject({
      id: "reply-live",
      content: "still streaming",
      streaming: true,
    });
    expect(projection.sessionStatus).toBe("running");
    expect(projection.events.lastSeq).toBe(3);
  });

  it("folds attach events into the HTTP Msg baseline", () => {
    const projection = freshProjection("s-attach");
    projection.hydrate({
      messages: [{ id: "user-1", role: "user", content: "hello", timestamp: 1_000 }],
      wire: [wireOf("user-1", "user", "hello", 1_000, false, 4)],
      seq: 4,
      hasMoreHistory: false,
      status: "running",
    });
    projection.events.applyAttach([
      {
        type: "assistant/chunk",
        seq: 5,
        time: 2_000,
        message_id: "assistant-1",
        data: { kind: "text", block_id: "text-1", delta: "继续" },
      } as SessionEvent,
    ], 5);
    projection.projectEvents();

    expect(projection.events.lastSeq).toBe(5);
    expect(projection.messages.at(-1)).toMatchObject({
      id: "assistant-1",
      content: "继续",
      streaming: true,
    });
  });

  it("applies lifecycle state for events received through attach", () => {
    const projection = freshProjection("s-attach-lifecycle");
    projection.hydrate({
      messages: [
        { id: "user-1", role: "user", content: "hello", timestamp: 1_000 },
        assistant("assistant-1", "done", true, 1_100),
      ],
      wire: [
        wireOf("user-1", "user", "hello", 1_000, false, 4),
        wireOf("assistant-1", "assistant", "done", 1_100, true, 4),
      ],
      seq: 4,
      hasMoreHistory: false,
      status: "running",
    });

    projection.events.applyAttach([
      {
        type: "turn/end",
        seq: 5,
        time: 2_000,
        message_id: "assistant-1",
        data: {
          turn_id: "turn-1",
          request_id: "request-1",
          outcome: "completed",
          reason: "completed",
          iterations: 1,
        },
      } as SessionEvent,
    ], 5);

    expect(projection.sessionStatus).toBe("idle");
    expect(projection.sessionActivity).toBe("idle");
    expect(projection.messages.at(-1)).toMatchObject({
      id: "assistant-1",
      streaming: false,
    });
  });

  it("seeds the assembler so tail events pair with history tool calls", () => {
    const projection = freshProjection("s-seed-pairing");
    const historyMessage: SessionMessage = {
      id: "m-history",
      session_id: "s-seed-pairing",
      name: "default",
      role: "assistant",
      content: [
        { type: "tool_call", id: "tc-hist", name: "read", arguments: { path: "a" } },
      ],
      metadata: {},
      created_at: "2026-09-01T00:00:00Z",
      token: null,
      finished_at: null,
      finished_reason: null,
      structured_output: null,
      error: null,
      timestamp: 1_000,
      seq: 5,
    };

    projection.hydrate({
      messages: [],
      wire: [wireMsgFromSessionMessage(historyMessage)],
      seq: 5,
      hasMoreHistory: false,
      status: "running",
    });

    // 基线之后的事件可以与历史中的 tool_call 配对。
    projection.apply({
      v: 1,
      session_id: "s-seed-pairing",
      type: "session/event",
      payload: {
        event: {
          type: "tool/result",
          seq: 6,
          time: 1_100,
          message_id: "m-history",
          data: {
            tool_call_id: "tc-hist",
            name: "read",
            output: [{ type: "text", text: "contents" }],
            state: "success",
            metadata: {},
          },
        } as SessionEvent,
      },
    });

    const message = projection.messages.find((item) => item.id === "m-history");
    expect(message?.toolResults?.["tc-hist"]).toMatchObject({
      status: "completed",
      result: "contents",
    });
  });

  it("deduplicates prepended history by Msg id", () => {
    const projection = freshProjection("s-prepend");
    projection.messages = [
      { id: "user-2", role: "user", content: "new", timestamp: 2_000 },
    ];

    projection.prependHistory([
      { id: "user-1", role: "user", content: "old", timestamp: 1_000 },
      { id: "user-2", role: "user", content: "duplicate", timestamp: 2_000 },
    ], false);

    expect(projection.messages.map((message) => message.id)).toEqual([
      "user-1",
      "user-2",
    ]);
  });

  it("prepends an earlier page while the current reply is streaming", () => {
    const projection = freshProjection("s-prepend-stream");
    projection.messages = [
      { id: "user-current", role: "user", content: "current", timestamp: 2_000 },
      assistant("reply-current", "still streaming", true, 2_500),
    ];
    projection.earliestTs = 2;
    projection.hasMoreHistory = true;

    projection.prependHistory([
      { id: "user-earlier", role: "user", content: "earlier", timestamp: 1_000 },
      { id: "reply-earlier", role: "assistant", content: "earlier reply", timestamp: 1_500 },
    ], true);

    expect(projection.messages.map((message) => message.id)).toEqual([
      "user-earlier",
      "reply-earlier",
      "user-current",
      "reply-current",
    ]);
    expect(projection.messages.at(-1)).toMatchObject({
      id: "reply-current",
      streaming: true,
    });
    expect(projection.earliestTs).toBe(1);
    expect(projection.hasMoreHistory).toBe(true);
  });

  it("preserves the cursor and skips replayed events after hydrate", () => {
    const projection = freshProjection("s-replay");
    const userEvent = (seq: number): WireFrame => ({
      v: 1,
      session_id: "s-replay",
      type: "session/event",
      payload: {
        event: {
          type: "user/message",
          seq,
          time: 1_000,
          message_id: "user-1",
          data: { content: [{ type: "text", text: "hello" }], metadata: {}, request_id: "r-1" },
        } as SessionEvent,
      },
    });

    projection.apply(userEvent(0));

    projection.hydrate({
      messages: [{ id: "user-1", role: "user", content: "hello", timestamp: 1_000 }],
      wire: [wireOf("user-1", "user", "hello", 1_000)],
      seq: 1,
      hasMoreHistory: false,
      status: "running",
    });

    expect(projection.events.lastSeq).toBe(1);
    expect(projection.sessionStatus).toBe("running");

    // 重放同 seq 事件被幂等跳过，不产生重复气泡。
    projection.apply(userEvent(0));
    projection.apply(userEvent(1));
    expect(projection.messages).toHaveLength(1);
  });
});
