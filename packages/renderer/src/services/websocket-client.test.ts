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

describe("websocket-client F12 protocol handling", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("subscribeOnly uses payload for attach/detach", async () => {
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    wsClient.subscribeOnly("ws_a");
    wsClient.subscribeOnly("ws_b");

    const frames = ws.sent.map((payload) => JSON.parse(payload));
    expect(frames.map((frame) => frame.type)).toEqual(["attach", "detach", "attach"]);
    expect(frames.map((frame) => frame.payload.session_id)).toEqual(["ws_a", "ws_a", "ws_b"]);
    expect(frames.every((frame) => !("frame_id" in frame))).toBe(true);
  });

  it("sends chat and tool confirmation as session.prompt", async () => {
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    wsClient.sendChat("hello", { session_id: "ws_a" }, undefined, "client-1");
    wsClient.sendToolConfirmation("ws_a", ["call-1", "call-2"], true);

    const chat = JSON.parse(ws.sent[0]);
    expect(chat).toMatchObject({
      request_id: "client-1",
      type: "session.prompt",
      payload: { session_id: "ws_a", mode: "queue", content: "hello" },
    });
    const confirmation = JSON.parse(ws.sent[1]);
    expect(confirmation).toMatchObject({
      type: "session.prompt",
      payload: { session_id: "ws_a", mode: "queue", content: "/allow call-1 call-2" },
    });
  });

  it("keeps the same request_id until the queue response", async () => {
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    wsClient.sendChat("hello", { session_id: "ws_a" }, undefined, "client-ack");
    ws.onopen?.();
    expect(JSON.parse(ws.sent[1]).request_id).toBe("client-ack");

    ws.onmessage?.({
      data: JSON.stringify({
        type: "session/queue",
        request_id: "client-ack",
        ok: true,
        payload: { session_id: "ws_a", revision: 1, items: [] },
      }),
    });
    ws.onopen?.();
    expect(ws.sent).toHaveLength(2);
  });

  it("parses the Inbox queue, session status, command and RPC error envelopes", async () => {
    const {
      getSessionEventPayload,
      getSessionStatusPayload,
      getSessionCommandPayload,
      getRpcErrorPayload,
    } = await loadClient();

    expect(getSessionEventPayload({
      type: "session/queue",
      metadata: {},
      payload: {
        session_id: "ws_a",
        revision: 1,
        items: [{
          id: "queued-1",
          placement: "queued",
          message: { content: [{ type: "text", text: "queued" }] },
        }],
      },
    })).toMatchObject({
      session_id: "ws_a",
      items: [{ id: "queued-1", placement: "queued" }],
    });
    expect(getSessionStatusPayload({
      type: "session/status",
      metadata: {},
      payload: { session_id: "ws_a", status: "running" },
    })).toMatchObject({ session_id: "ws_a", status: "running" });
    expect(getSessionCommandPayload({
      type: "session_event:command_message",
      metadata: { session_id: "ws_a" },
      payload: { content: "命令执行失败", level: "error" },
    })).toMatchObject({ content: "命令执行失败", level: "error" });
    expect(getRpcErrorPayload({
      request_id: "r1",
      ok: false,
      error: { code: "queue-full", message: "Inbox 已满", session_id: "ws_a" },
    })).toMatchObject({ request_id: "r1", code: "queue-full", session_id: "ws_a" });
  });

  it("rejects malformed queue payloads and cross-session routes", async () => {
    const { getSessionEventPayload, getSessionStatusPayload } = await loadClient();

    expect(getSessionEventPayload({
      type: "session/queue",
      metadata: {},
      payload: { session_id: "ws_a", items: [] },
    })).toBeNull();
    expect(getSessionEventPayload({
      type: "session/queue",
      metadata: { session_id: "ws_b" },
      payload: { session_id: "ws_a", revision: 1, items: [] },
    })).toBeNull();
    expect(getSessionEventPayload({
      type: "session/queue",
      metadata: {},
      payload: { session_id: "ws_a", revision: 1, items: [{ id: "bad", placement: "unknown", message: {} }] },
    })).toBeNull();
    expect(getSessionStatusPayload({
      type: "session/status",
      metadata: {},
      payload: { session_id: "ws_a", status: "unknown" },
    })).toBeNull();
  });

  it("sends cancellation through session.cancel and retries until its RPC ACK", async () => {
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    wsClient.sendCancel("ws_a", "delivery-1");
    const frame = JSON.parse(ws.sent[0]);
    expect(frame).toMatchObject({
      type: "session.cancel",
      payload: { session_id: "ws_a", expected_request_id: "delivery-1" },
    });
    ws.onopen?.();
    expect(JSON.parse(ws.sent[1]).request_id).toBe(frame.request_id);

    ws.onmessage?.({
      data: JSON.stringify({
        request_id: frame.request_id,
        ok: true,
        value: { accepted: true, session_id: "ws_a" },
      }),
    });
    ws.onopen?.();
    expect(ws.sent).toHaveLength(2);
  });

  it("updates the Inbox queue through session.updateQueue and resolves with its snapshot", async () => {
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    const pending = wsClient.updateQueue("ws_a", "queued-1", { kind: "remove" });
    const frame = JSON.parse(ws.sent[0]);
    expect(frame).toMatchObject({
      type: "session.updateQueue",
      payload: {
        session_id: "ws_a",
        item_id: "queued-1",
        action: { kind: "remove" },
      },
    });

    ws.onmessage?.({
      data: JSON.stringify({
        type: "session/queue",
        request_id: frame.request_id,
        ok: true,
        payload: { session_id: "ws_a", revision: 2, items: [] },
      }),
    });

    await expect(pending).resolves.toEqual({
      session_id: "ws_a",
      revision: 2,
      items: [],
    });
    ws.onopen?.();
    expect(ws.sent).toHaveLength(1);
  });

  it("promotes a queued item through the steer queue action", async () => {
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    const pending = wsClient.promoteQueueItemToSteer("ws_a", "queued-1");
    const frame = JSON.parse(ws.sent[0]);
    expect(frame.payload.action).toEqual({ kind: "steer" });
    ws.onmessage?.({
      data: JSON.stringify({
        type: "session/queue",
        request_id: frame.request_id,
        ok: true,
        payload: { session_id: "ws_a", revision: 3, items: [] },
      }),
    });
    await expect(pending).resolves.toMatchObject({ session_id: "ws_a", revision: 3, items: [] });
  });

  it("stamps reply snapshots with the current client connection epoch", async () => {
    const { wsClient } = await loadClient();
    const epochs: number[] = [];
    wsClient.onMessage((message) => {
      if (message.type === "reply_snapshot") {
        epochs.push((message.payload as any).client_connection_epoch);
      }
    });
    wsClient.connect();
    let ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({
      data: JSON.stringify({
        type: "reply_snapshot",
        payload: { session_id: "ws_a", replies: [] },
        metadata: {},
      }),
    });

    wsClient.disconnect();
    wsClient.connect();
    ws = FakeWebSocket.instances[1];
    ws.onopen?.();
    ws.onmessage?.({
      data: JSON.stringify({
        type: "reply_snapshot",
        payload: { session_id: "ws_a", replies: [] },
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
    expect(frames[0].request_id).toBe("client-0");
    expect(frames[99].request_id).toBe("client-99");
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
    expect(ws.sent.map((payload) => JSON.parse(payload).request_id)).toEqual([
      "client-first",
      "client-second",
    ]);
    error.mockRestore();
  });
});
