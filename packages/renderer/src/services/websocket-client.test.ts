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

const rpcFrame = (sessionId: string, payload: Record<string, unknown>) => JSON.stringify({
  v: 1,
  session_id: sessionId,
  type: "rpc",
  payload,
});

describe("websocket-client v4 wire protocol handling", () => {
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

  it("keeps the same request_id until the rpc queue settlement", async () => {
    const { wsClient } = await loadClient();
    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();

    wsClient.sendChat("hello", { session_id: "ws_a" }, undefined, "client-ack");
    ws.onopen?.();
    expect(JSON.parse(ws.sent[1]).request_id).toBe("client-ack");

    ws.onmessage?.({
      data: rpcFrame("ws_a", {
        request_id: "client-ack",
        ok: true,
        value: { session_id: "ws_a", revision: 1, items: [] },
      }),
    });
    ws.onopen?.();
    expect(ws.sent).toHaveLength(2);
  });

  it("parses the frame envelope, queue snapshots and rpc errors", async () => {
    const {
      parseDownstreamFrame,
      getQueueSnapshotFrame,
      getRpcErrorPayload,
      getRpcPayload,
      isQueueSnapshotPayload,
    } = await loadClient();

    const queueFrame = parseDownstreamFrame({
      v: 1,
      session_id: "ws_a",
      type: "session/queue",
      payload: {
        session_id: "ws_a",
        revision: 1,
        items: [{
          id: "queued-1",
          placement: "queued",
          message: { content: [{ type: "text", text: "queued" }] },
        }],
      },
    });
    expect(queueFrame).not.toBeNull();
    expect(getQueueSnapshotFrame(queueFrame!)).toMatchObject({
      session_id: "ws_a",
      items: [{ id: "queued-1", placement: "queued" }],
    });

    const errorFrame = parseDownstreamFrame({
      v: 1,
      session_id: "ws_a",
      type: "rpc",
      payload: {
        request_id: "r1",
        ok: false,
        error: { code: "queue-full", message: "Inbox 已满" },
      },
    });
    expect(getRpcPayload(errorFrame!)).toMatchObject({ request_id: "r1", ok: false });
    expect(getRpcErrorPayload(errorFrame!)).toMatchObject({
      request_id: "r1",
      code: "queue-full",
      session_id: "ws_a",
    });

    const promptSettlement = parseDownstreamFrame({
      v: 1,
      session_id: "ws_a",
      type: "rpc",
      payload: {
        request_id: "r2",
        ok: true,
        value: { session_id: "ws_a", revision: 2, items: [] },
      },
    });
    expect(isQueueSnapshotPayload(getRpcPayload(promptSettlement!)!.value)).toBe(true);
  });

  it("rejects malformed envelopes and queue payloads", async () => {
    const { parseDownstreamFrame, getQueueSnapshotFrame, getRpcPayload } = await loadClient();

    expect(parseDownstreamFrame({ v: 2, session_id: "ws_a", type: "session/queue" })).toBeNull();
    expect(parseDownstreamFrame({ v: 1, type: "session/queue" })).toBeNull();
    expect(parseDownstreamFrame({ v: 1, session_id: "ws_a" })).toBeNull();
    expect(parseDownstreamFrame("junk")).toBeNull();

    expect(getQueueSnapshotFrame({
      v: 1,
      session_id: "ws_a",
      type: "session/queue",
      payload: { session_id: "ws_a", items: [] },
    })).toBeNull();
    expect(getQueueSnapshotFrame({
      v: 1,
      session_id: "ws_a",
      type: "session/queue",
      payload: {
        session_id: "ws_a",
        revision: 1,
        items: [{ id: "bad", placement: "unknown", message: {} }],
      },
    })).toBeNull();
    expect(getRpcPayload({
      v: 1,
      session_id: "ws_a",
      type: "rpc",
      payload: { request_id: "r1" },
    })).toBeNull();
  });

  it("delivers parsed v4 frames to message handlers and skips invalid ones", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { wsClient } = await loadClient();
    const seen: Array<{ type: string; sessionId: string }> = [];
    wsClient.onMessage((frame) => seen.push({ type: frame.type, sessionId: frame.session_id }));

    wsClient.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({
      data: JSON.stringify({
        v: 1,
        session_id: "ws_a",
        type: "session/subscribed",
        payload: { last_seq: 3, status: "idle" },
      }),
    });
    ws.onmessage?.({ data: "not json" });
    ws.onmessage?.({ data: JSON.stringify({ type: "unknown_without_envelope" }) });
    ws.onmessage?.({
      data: JSON.stringify({
        v: 1,
        session_id: "ws_a",
        type: "session/event",
        payload: {
          event: { type: "turn/end", seq: 3, time: 1, message_id: null, data: {} },
        },
      }),
    });

    expect(seen).toEqual([
      { type: "session/subscribed", sessionId: "ws_a" },
      { type: "session/event", sessionId: "ws_a" },
    ]);
    error.mockRestore();
  });

  it("sends cancellation through session.cancel and retries until its rpc ACK", async () => {
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
      data: rpcFrame("ws_a", {
        request_id: frame.request_id,
        ok: true,
        value: { accepted: true, session_id: "ws_a" },
      }),
    });
    ws.onopen?.();
    expect(ws.sent).toHaveLength(2);
  });

  it("updates the Inbox queue through session.updateQueue and resolves with its rpc value", async () => {
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
      data: rpcFrame("ws_a", {
        request_id: frame.request_id,
        ok: true,
        value: { session_id: "ws_a", revision: 2, items: [] },
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
      data: rpcFrame("ws_a", {
        request_id: frame.request_id,
        ok: true,
        value: { session_id: "ws_a", revision: 3, items: [] },
      }),
    });
    await expect(pending).resolves.toMatchObject({ session_id: "ws_a", revision: 3, items: [] });
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
