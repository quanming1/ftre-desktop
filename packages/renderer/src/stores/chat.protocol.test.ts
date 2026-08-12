import { describe, expect, it } from "vitest";
import {
  getSessionEventPayload,
  type ServerMessage,
} from "@/services/websocket-client";

describe("mailbox snapshot protocol", () => {
  it("accepts a flat pending-only mailbox snapshot", () => {
    const message: ServerMessage<any> = {
      frame_id: "frame-1",
      type: "session_event:mailbox_snapshot",
      metadata: { session_id: "ws_sess_1" },
      data: {
        session_id: "ws_sess_1",
        revision: 3,
        phase: "idle",
        pending: [{ request_id: "req-1", sequence: 1, content: "queued" }],
        capacity: 100,
        accepting_messages: true,
        can_cancel_active: false,
      },
    };
    expect(getSessionEventPayload(message)).toMatchObject({
      session_id: "ws_sess_1",
      pending: [{ request_id: "req-1", content: "queued" }],
    });
  });
});
