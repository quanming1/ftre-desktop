import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

async function loadClient() {
  vi.resetModules();
  FakeWebSocket.instances = [];
  (globalThis as any).WebSocket = FakeWebSocket;
  return import("./websocket-client");
}

describe("websocket-client protocol handling", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("subscribeOnly replaces the current session subscription", async () => {
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    wsClient.subscribeOnly("ws::a");
    wsClient.subscribeOnly("ws::b");

    const frames = ws.sent.map((payload) => JSON.parse(payload));
    expect(frames.map((frame) => frame.type)).toEqual(["attach", "detach", "attach"]);
    expect(frames.map((frame) => frame.data.session_id)).toEqual(["ws::a", "ws::a", "ws::b"]);
  });

  it("deduplicates volatile replay and live frames before dispatching", async () => {
    const { wsClient } = await loadClient();
    const received: unknown[] = [];
    wsClient.onMessage((msg) => received.push(msg));
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];

    const frame = {
      id: "msg_volatile",
      type: "agent_event",
      data: { type: "assistant_message", data: { content: "hello" } },
      metadata: {
        session_id: "ws::a",
        volatile_seq: 1,
      },
    };

    // Same session + seq → deduplicated
    ws.onmessage?.({ data: JSON.stringify(frame) });
    ws.onmessage?.({ data: JSON.stringify(frame) });

    // Different session, same seq → not deduplicated
    ws.onmessage?.({
      data: JSON.stringify({
        ...frame,
        metadata: { ...frame.metadata, session_id: "ws::b" },
      }),
    });

    expect(received).toHaveLength(2);
  });

  it("clears dedup state on reconnect", async () => {
    const { wsClient } = await loadClient();
    const received: unknown[] = [];
    wsClient.onMessage((msg) => received.push(msg));
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    const frame = {
      id: "msg_volatile",
      type: "agent_event",
      data: { type: "assistant_message", data: { content: "hello" } },
      metadata: {
        session_id: "ws::a",
        volatile_seq: 1,
      },
    };

    // First time: received
    ws.onmessage?.({ data: JSON.stringify(frame) });
    expect(received).toHaveLength(1);

    // Simulate reconnect: onopen clears dedup, same frame should be received again
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify(frame) });
    expect(received).toHaveLength(2);
  });
});
