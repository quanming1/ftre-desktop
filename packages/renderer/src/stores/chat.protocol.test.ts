import { describe, expect, it } from "vitest";
import {
  getQueueSnapshotFrame,
  getRpcPayload,
  isQueueSnapshotPayload,
  parseDownstreamFrame,
} from "@/services/websocket-client";

describe("v4 wire protocol frames", () => {
  it("accepts a session/queue frame payload", () => {
    const frame = parseDownstreamFrame({
      v: 1,
      session_id: "ws_sess_1",
      type: "session/queue",
      payload: {
        session_id: "ws_sess_1",
        revision: 1,
        items: [{
          id: "req-1",
          placement: "queued",
          message: { content: [{ type: "text", text: "queued" }] },
        }],
      },
    });
    expect(frame).not.toBeNull();
    expect(getQueueSnapshotFrame(frame!)).toMatchObject({
      session_id: "ws_sess_1",
      items: [{ id: "req-1", placement: "queued" }],
    });
  });

  it("accepts a queue snapshot inside an rpc value (prompt settlement)", () => {
    const frame = parseDownstreamFrame({
      v: 1,
      session_id: "ws_sess_1",
      type: "rpc",
      payload: {
        request_id: "req-1",
        ok: true,
        value: {
          session_id: "ws_sess_1",
          revision: 2,
          items: [{
            id: "req-1",
            placement: "steering",
            message: { content: [{ type: "text", text: "steer" }] },
          }],
        },
      },
    });
    expect(frame).not.toBeNull();
    const payload = getRpcPayload(frame!);
    expect(payload).toMatchObject({ request_id: "req-1", ok: true });
    expect(isQueueSnapshotPayload(payload!.value)).toBe(true);
  });

  it("rejects an unknown envelope without v/session_id", () => {
    expect(parseDownstreamFrame({
      type: "session/queue",
      metadata: { session_id: "ws_sess_1" },
      payload: { session_id: "ws_sess_1", revision: 1, items: [] },
    })).toBeNull();
  });
});
