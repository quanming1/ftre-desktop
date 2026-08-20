import { describe, expect, it, vi } from "vitest";
import { ClientSessionProjection, type ProjectionEvent } from "./clientSessionProjection";
import type { ChatMessage } from "./chat";

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

describe("ClientSessionProjection", () => {
  it("routes realtime events through the projection reducer", () => {
    const applyEvent = vi.fn((projection, event: ProjectionEvent) => {
      projection.messages = [assistant("reply-1", String(event.data.delta), true)];
    });
    const projection = new ClientSessionProjection({
      applyEvent,
      applyReplySnapshot: vi.fn(),
    });

    projection.apply({ type: "TEXT_BLOCK_DELTA", data: { delta: "hello" } });

    expect(applyEvent).toHaveBeenCalledOnce();
    expect(projection.messages[0]).toMatchObject({
      id: "reply-1",
      content: "hello",
      streaming: true,
    });
  });

  it("keeps a newer active Reply when HTTP history arrives after WS attach", () => {
    const projection = new ClientSessionProjection({
      applyEvent: vi.fn(),
      applyReplySnapshot: vi.fn(),
    });
    projection.messages = [assistant("reply-1", "new streamed text", true)];

    projection.hydrate({
      messages: [assistant("reply-1", "stale checkpoint", false)],
      hasMoreHistory: false,
      status: "running",
    });

    expect(projection.messages).toHaveLength(1);
    expect(projection.messages[0]).toMatchObject({
      id: "reply-1",
      content: "new streamed text",
      streaming: true,
    });
    expect(projection.isBusy).toBe(true);
  });

  it("deduplicates prepended history by Msg id", () => {
    const projection = new ClientSessionProjection({
      applyEvent: vi.fn(),
      applyReplySnapshot: vi.fn(),
    });
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
    const projection = new ClientSessionProjection({
      applyEvent: vi.fn(),
      applyReplySnapshot: vi.fn(),
    });
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

  it("preserves realtime dedup state and authoritative running status during hydrate", () => {
    const projection = new ClientSessionProjection({
      applyEvent: vi.fn(),
      applyReplySnapshot: vi.fn(),
    });
    projection.seenEventIds.add("event-live-1");

    projection.hydrate({
      messages: [
        { id: "user-1", role: "user", content: "hello", timestamp: 1_000 },
      ],
      hasMoreHistory: false,
      status: "running",
    });

    expect(projection.seenEventIds.has("event-live-1")).toBe(true);
    expect(projection.sessionStatus).toBe("running");
    expect(projection.isBusy).toBe(true);
  });


});
