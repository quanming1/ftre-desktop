import { describe, it, expect, vi } from "vitest";

// Mock websocket-client (chat.ts wires onMessage etc. at import)
vi.mock("@/services/websocket-client", () => ({
    wsClient: {
        onMessage: vi.fn(),
        onDisconnect: vi.fn(),
        onConnect: vi.fn(),
        onStatusChange: vi.fn(),
        sendChat: vi.fn(),
        sendCancel: vi.fn(),
        attach: vi.fn(),
        detach: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        connected: false,
        status: "disconnected",
    },
}));

import { applyEvent, type BusEvent } from "./chat";

interface Bucket {
    messages: any[];
    isBusy: boolean;
    error: string | null;
    retryState: any;
}
const fresh = (): Bucket => ({ messages: [], isBusy: false, error: null, retryState: null });
const feed = (b: Bucket, evs: BusEvent[]) => evs.forEach((e) => applyEvent(b as any, e));

describe("applyEvent — canonical streaming flow", () => {
    it("message → message → done collapses into one assistant msg with final text", () => {
        const b = fresh();
        feed(b, [
            { type: "message", data: { content: "Hello" } },
            { type: "message", data: { content: ", world" } },
            { type: "done", data: { success: true } },
        ]);
        expect(b.messages).toHaveLength(1);
        expect(b.messages[0].role).toBe("assistant");
        expect(b.messages[0].content).toBe("Hello, world");
        expect(b.messages[0].streaming).toBe(false);
        expect(b.isBusy).toBe(false);
    });

    it("message_complete after streaming repairs throttled tail", () => {
        const b = fresh();
        feed(b, [
            { type: "message", data: { content: "He" } },
            { type: "message_complete", data: { content: "Hello, world" } },
            { type: "done" },
        ]);
        expect(b.messages[0].content).toBe("Hello, world");
        expect(b.messages[0].streaming).toBe(false);
    });

    it("tool_call after message stays in the same assistant msg until done", () => {
        const b = fresh();
        feed(b, [
            { type: "message", data: { content: "before" } },
            { type: "tool_call", data: { id: "t1", name: "ls", arguments: { path: "/" } } },
            { type: "tool_result", data: { id: "t1", result: "ok" } },
            { type: "message", data: { content: "after" } },
            { type: "done" },
        ]);
        expect(b.messages).toHaveLength(1);
        const m = b.messages[0];
        expect(m.toolCalls).toHaveLength(1);
        expect(m.toolCalls[0].status).toBe("ok");
        expect(m.toolCalls[0].result).toBe("ok");
        expect(m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text).join("")).toBe("beforeafter");
    });

    it("tool_call_streaming accumulates arguments across deltas", () => {
        const b = fresh();
        feed(b, [
            { type: "tool_call_streaming", data: { tool_calls: [{ id: "t1", name: "f", arguments_delta: '{"a":' }] } },
            { type: "tool_call_streaming", data: { tool_calls: [{ id: "t1", arguments_delta: "1}" }] } },
        ]);
        expect(b.messages[0].toolCalls[0].arguments).toBe('{"a":1}');
    });

    it("error event creates a new error msg and sets bucket.error", () => {
        const b = fresh();
        feed(b, [
            { type: "message", data: { content: "trying" } },
            { type: "error", data: { message: "boom", code: "E1" } },
        ]);
        expect(b.messages).toHaveLength(2);
        expect(b.messages[0].streaming).toBe(false);
        expect(b.messages[1].isError).toBe(true);
        expect(b.error).toBe("[E1] boom");
        expect(b.isBusy).toBe(false);
    });

    it("history replay (USER_INPUT + tool_call + message_complete) builds rich messages", () => {
        const b = fresh();
        feed(b, [
            { type: "USER_INPUT", data: { content: "hi" }, ts: 1000 },
            { type: "tool_call", data: { id: "t1", name: "ls", arguments: {} }, ts: 1100 },
            { type: "tool_result", data: { id: "t1", result: "ok" }, ts: 1200 },
            { type: "message_complete", data: { content: "done" }, ts: 1300 },
        ]);
        expect(b.messages).toHaveLength(2);
        expect(b.messages[0].role).toBe("user");
        expect(b.messages[0].content).toBe("hi");
        expect(b.messages[1].role).toBe("assistant");
        expect(b.messages[1].content).toBe("done");
        expect(b.messages[1].toolCalls).toHaveLength(1);
        expect(b.messages[1].toolCalls[0].status).toBe("ok");
    });

    it("retry event populates retryState", () => {
        const b = fresh();
        feed(b, [{ type: "retry", data: { attempt: 2, max_attempts: 3, message: "rate limit" } }]);
        expect(b.retryState).toEqual({ attempt: 2, maxAttempts: 3, message: "rate limit" });
    });

    it("usage_update attaches usage to current streaming msg", () => {
        const b = fresh();
        feed(b, [
            { type: "message", data: { content: "x" } },
            { type: "usage_update", data: { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } },
            { type: "done" },
        ]);
        expect(b.messages[0].usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    });

    it("reasoning chunks accumulate", () => {
        const b = fresh();
        feed(b, [
            { type: "reasoning", data: { content: "think" } },
            { type: "reasoning", data: { content: "ing..." } },
        ]);
        expect(b.messages[0].reasoning).toBe("thinking...");
    });
});
