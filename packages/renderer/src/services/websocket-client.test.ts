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

  it("uses the frame id as the stable request id", async () => {
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    wsClient.sendChat("hello", { session_id: "ws_a" }, undefined, "client-1");

    const frame = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(frame).toMatchObject({
      frame_id: "client-1",
      type: "user_message",
      metadata: {
        session_id: "ws_a",
      },
    });
  });

  it("resends chat until the gateway confirms durable admission", async () => {
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    wsClient.sendChat("hello", { session_id: "ws_a" }, undefined, "client-ack");
    expect(ws.sent).toHaveLength(1);

    // A reconnect before ACK resends the same idempotency key.
    ws.onopen?.();
    expect(ws.sent).toHaveLength(2);
    expect(JSON.parse(ws.sent[1]).frame_id).toBe("client-ack");

    ws.onmessage?.({
      data: JSON.stringify({
        frame_id: "server-ack",
        type: "message_ack",
        metadata: {},
        data: {
          session_id: "ws_a",
          request_id: "client-ack",
          queue_position: 1,
          created: true,
        },
      }),
    });
    ws.onopen?.();
    expect(ws.sent).toHaveLength(2);
  });

  it("normalizes the backend mailbox snapshot topic", async () => {
    const {
      getSessionEventPayload,
      getSessionStatusPayload,
      getSessionCommandPayload,
    } = await loadClient();

    expect(getSessionEventPayload({
      frame_id: "mailbox",
      type: "session_event:mailbox_snapshot",
      metadata: {},
      data: {
        session_id: "ws_a",
        revision: 4,
        phase: "compacting",
        pending: [],
        capacity: 100,
        accepting_messages: false,
        can_cancel_active: false,
      },
    })).toMatchObject({
      type: "mailbox_snapshot",
      session_id: "ws_a",
      phase: "compacting",
    });

    expect(getSessionStatusPayload({
      frame_id: "flat-status",
      type: "global_event:session_status",
      metadata: {},
      data: { session_id: "ws_a", status: "running", revision: 6 },
    })).toMatchObject({ session_id: "ws_a", status: "running" });

    expect(getSessionCommandPayload({
      frame_id: "flat-command",
      type: "session_event:command_message",
      metadata: { session_id: "ws_a" },
      data: { content: "命令执行失败", level: "error" },
    })).toMatchObject({ content: "命令执行失败", level: "error" });
  });

  it("rejects malformed mailbox payloads and cross-session routes", async () => {
    const { getSessionEventPayload, getSessionStatusPayload } = await loadClient();

    expect(getSessionEventPayload({
      frame_id: "wrong-session",
      type: "session_event:mailbox_snapshot",
      metadata: { session_id: "ws_b" },
      data: {
        session_id: "ws_a",
        revision: 1,
        phase: "running",
        pending: [],
        capacity: 100,
        accepting_messages: true,
        can_cancel_active: true,
      },
    })).toBeNull();

    expect(getSessionEventPayload({
      frame_id: "bad-status",
      type: "session_event:mailbox_snapshot",
      metadata: { session_id: "ws_a" },
      data: {
        session_id: "ws_a",
        revision: 1,
        phase: "not-a-phase",
        pending: [],
        capacity: 100,
        accepting_messages: true,
        can_cancel_active: true,
      },
    })).toBeNull();

    expect(getSessionEventPayload({
      frame_id: "bad-activity",
      type: "session_event:mailbox_snapshot",
      metadata: {},
      data: {
        session_id: "ws_a",
        revision: 1,
        phase: "not-a-phase",
        pending: [],
        capacity: 100,
        accepting_messages: true,
        can_cancel_active: true,
      },
    })).toBeNull();

    expect(getSessionStatusPayload({
      frame_id: "bad-status-topic",
      type: "global_event:session_status",
      metadata: {},
      data: { session_id: "ws_a", status: "unknown" },
    })).toBeNull();
  });

  it("sends cancellation through the high-priority control frame", async () => {
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    wsClient.sendCancel("ws_a", "delivery-1");

    const frame = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(frame).toMatchObject({
      type: "cancel",
      data: {
        session_id: "ws_a",
        scope: "active",
        expected_request_id: "delivery-1",
      },
    });
  });

  it("retries cancellation until the server returns control_ack", async () => {
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    wsClient.sendCancel("ws_a", "delivery-1");
    const frame = JSON.parse(ws.sent[0]);
    ws.onopen?.();
    expect(ws.sent).toHaveLength(2);
    expect(JSON.parse(ws.sent[1]).frame_id).toBe(frame.frame_id);

    ws.onmessage?.({
      data: JSON.stringify({
        frame_id: frame.frame_id,
        type: "control_ack",
        metadata: { session_id: "ws_a" },
        data: {
          request_id: frame.frame_id,
          session_id: "ws_a",
          status: "control",
        },
      }),
    });
    ws.onopen?.();
    expect(ws.sent).toHaveLength(2);
  });

  it("stamps attach snapshots with the current client connection epoch", async () => {
    const { wsClient } = await loadClient();
    const epochs: number[] = [];
    wsClient.onMessage((message) => {
      if (message.type === "reply_snapshot") {
        epochs.push((message.data as any).client_connection_epoch);
      }
    });
    wsClient.connect();
    let ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({
      data: JSON.stringify({
        frame_id: "sync-a",
        type: "reply_snapshot",
        data: { session_id: "ws_a", replies: [] },
        metadata: {},
      }),
    });

    wsClient.disconnect();
    wsClient.connect();
    ws = FakeWebSocket.instances[1];
    ws.onopen?.();
    ws.onmessage?.({
      data: JSON.stringify({
        frame_id: "sync-a",
        type: "reply_snapshot",
        data: { session_id: "ws_a", replies: [] },
        metadata: {},
      }),
    });

    expect(epochs).toEqual([1, 2]);
  });

  it("rejects a full disconnected outbox without dropping its oldest frame", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.readyState = 0;

    for (let index = 0; index < 100; index += 1) {
      expect(wsClient.sendChat(`message ${index}`, {}, undefined, `client-${index}`).ok)
        .toBe(true);
    }
    expect(wsClient.sendChat("overflow", {}, undefined, "client-overflow"))
      .toMatchObject({ ok: false, reason: "outbox_full" });

    ws.readyState = FakeWebSocket.OPEN;
    ws.onopen?.();
    const frames = ws.sent.map((payload) => JSON.parse(payload));
    expect(frames).toHaveLength(100);
    expect(frames[0].frame_id).toBe("client-0");
    expect(frames[99].frame_id).toBe("client-99");
    warn.mockRestore();
    error.mockRestore();
  });

  it("retains the current outbox frame when flushing throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.readyState = 0;
    wsClient.sendChat("first", {}, undefined, "client-first");
    wsClient.sendChat("second", {}, undefined, "client-second");

    const realSend = ws.send.bind(ws);
    let shouldFail = true;
    ws.send = (payload: string) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("socket write failed");
      }
      realSend(payload);
    };
    ws.readyState = FakeWebSocket.OPEN;
    ws.onopen?.();
    expect(ws.sent).toEqual([]);

    ws.onopen?.();
    expect(ws.sent.map((payload) => JSON.parse(payload).frame_id)).toEqual([
      "client-first",
      "client-second",
    ]);
    error.mockRestore();
  });

});
