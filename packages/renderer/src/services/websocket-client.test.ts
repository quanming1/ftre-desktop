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

    wsClient.subscribeOnly("ws_a");
    wsClient.subscribeOnly("ws_b");

    const frames = ws.sent.map((payload) => JSON.parse(payload));
    expect(frames.map((frame) => frame.type)).toEqual(["attach", "detach", "attach"]);
    expect(frames.map((frame) => frame.data.session_id)).toEqual(["ws_a", "ws_a", "ws_b"]);
  });

  it("工具确认发送不持久化的控制指令", async () => {
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    wsClient.sendToolConfirmation("ws_a", ["call-1", "call-2"], true);

    const frame = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(frame.type).toBe("user_message");
    expect(typeof frame.frame_id).toBe("string");
    expect(frame.data).toMatchObject({
      session_id: "ws_a",
      content: "/allow call-1 call-2",
    });
  });

  it("forwards agent events without metadata-level deduplication", async () => {
    const { wsClient } = await loadClient();
    const received: unknown[] = [];
    wsClient.onMessage((msg) => received.push(msg));
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];

    const frame = {
      id: "msg_volatile",
      type: "agent_event",
      data: { type: "assistant_message", event_id: "evt_1", data: { content: "hello" } },
      metadata: {
        session_id: "ws_a",
      },
    };

    // Same session + seq → deduplicated
    ws.onmessage?.({ data: JSON.stringify(frame) });
    ws.onmessage?.({ data: JSON.stringify(frame) });

    // Different session, same seq → not deduplicated
    ws.onmessage?.({
      data: JSON.stringify({
        ...frame,
        metadata: { ...frame.metadata, session_id: "ws_b" },
      }),
    });

    expect(received).toHaveLength(3);
  });

});
