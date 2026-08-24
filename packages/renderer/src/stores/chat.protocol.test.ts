import { describe, expect, it } from "vitest";
import {
  getSessionEventPayload,
  type ServerMessage,
} from "@/services/websocket-client";

describe("Inbox queue protocol", () => {
  it("accepts a session/queue payload", () => {
    const message: ServerMessage<any> = {
      type: "session/queue",
      metadata: { session_id: "ws_sess_1" },
      payload: {
        session_id: "ws_sess_1",
        items: [{
          id: "req-1",
          placement: "queued",
          message: { content: [{ type: "text", text: "queued" }] },
        }],
      },
    };
    expect(getSessionEventPayload(message)).toMatchObject({
      session_id: "ws_sess_1",
      items: [{ id: "req-1", placement: "queued" }],
    });
  });
});
