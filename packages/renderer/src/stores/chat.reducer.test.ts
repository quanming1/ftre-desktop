import { beforeEach, describe, it, expect, vi } from "vitest";

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
        subscribeOnly: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        connected: false,
        status: "disconnected",
    },
}));

import { wsClient } from "@/services/websocket-client";
import { applyEvent, useChat, type BusEvent } from "./chat";

interface Bucket {
    messages: any[];
    sessionStatus: "idle" | "running" | "compacting";
    isBusy: boolean;
    error: string | null;
    retryState: any;
}
const fresh = (): Bucket => ({ messages: [], sessionStatus: "idle", isBusy: false, error: null, retryState: null });
const feed = (b: Bucket, evs: BusEvent[]) => evs.forEach((e) => applyEvent(b as any, e));

describe("applyEvent — canonical streaming flow", () => {
    it("message → message → done collapses into one assistant msg with final text", () => {
        const b = fresh();
        feed(b, [
            { type: "assistant_message", data: { content: "Hello" } },
            { type: "assistant_message", data: { content: ", world" } },
            { type: "done", data: { success: true } },
        ]);
        expect(b.messages).toHaveLength(1);
        expect(b.messages[0].role).toBe("assistant");
        expect(b.messages[0].content).toBe("Hello, world");
        expect(b.messages[0].streaming).toBe(false);
        expect(b.isBusy).toBe(false);
    });

    it("assistant_message_complete after streaming repairs throttled tail", () => {
        const b = fresh();
        feed(b, [
            { type: "assistant_message", data: { content: "He" } },
            { type: "assistant_message_complete", data: { content: "Hello, world" } },
            { type: "done" },
        ]);
        expect(b.messages[0].content).toBe("Hello, world");
        expect(b.messages[0].streaming).toBe(false);
    });

    it("tool_call after message stays in the same assistant msg until done", () => {
        const b = fresh();
        feed(b, [
            { type: "assistant_message", data: { content: "before" } },
            { type: "tool_call", data: { id: "t1", name: "ls", arguments: { path: "/" } } },
            { type: "tool_result", data: { id: "t1", result: "ok" } },
            { type: "assistant_message", data: { content: "after" } },
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
            { type: "assistant_message", data: { content: "trying" } },
            { type: "error", data: { message: "boom", code: "E1" } },
        ]);
        expect(b.messages).toHaveLength(2);
        expect(b.messages[0].streaming).toBe(false);
        expect(b.messages[1].isError).toBe(true);
        expect(b.error).toBe("[E1] boom");
        expect(b.isBusy).toBe(false);
    });

    it("history replay (user_message + tool_call + assistant_message_complete) builds rich messages", () => {
        const b = fresh();
        feed(b, [
            { type: "user_message", data: { metadata: { hide: false }, content: "hi" }, ts: 1000 },
            { type: "tool_call", data: { id: "t1", name: "ls", arguments: {} }, ts: 1100 },
            { type: "tool_result", data: { id: "t1", result: "ok" }, ts: 1200 },
            { type: "assistant_message_complete", data: { content: "done" }, ts: 1300 },
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

    it("retry event seals streaming tail so retry indicator can render", () => {
        const b = fresh();
        feed(b, [
            { type: "assistant_message", data: { content: "partial" } },
            { type: "retry", data: { attempt: 1, max_attempts: 5, message: "api error" } },
        ]);
        expect(b.retryState).toEqual({ attempt: 1, maxAttempts: 5, message: "api error" });
        expect(b.messages[0].streaming).toBe(false);
        expect(b.messages.some((m) => m.streaming)).toBe(false);
    });

    it("usage_update attaches usage to current streaming msg", () => {
        const b = fresh();
        feed(b, [
            { type: "assistant_message", data: { content: "x" } },
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

describe("chat websocket replay", () => {
    beforeEach(() => {
        vi.mocked(wsClient.attach).mockClear();
        vi.mocked(wsClient.detach).mockClear();
        vi.mocked(wsClient.subscribeOnly).mockClear();
        useChat.setState({
            sessionId: null,
            messages: [],
            isBusy: false,
            error: null,
            retryState: null,
        });
    });

    it("switchTo does not call subscribeOnly (moved to switchSession)", () => {
        const subscribeOnly = vi.mocked(wsClient.subscribeOnly);
        const firstSessionId = `ws::switch-first-${Date.now()}`;
        const secondSessionId = `ws::switch-second-${Date.now()}`;

        useChat.getState().switchTo(firstSessionId);
        useChat.getState().switchTo(secondSessionId);

        // subscribeOnly is now called by switchSession after HTTP fetch,
        // not by switchTo. Verify it was NOT called.
        expect(subscribeOnly).not.toHaveBeenCalled();
    });

    it("clears the active websocket subscription when starting a new chat", () => {
        const subscribeOnly = vi.mocked(wsClient.subscribeOnly);
        const sessionId = `ws::new-chat-${Date.now()}`;

        useChat.getState().switchTo(sessionId);
        subscribeOnly.mockClear();

        useChat.getState().newChat();

        expect(subscribeOnly).toHaveBeenCalledWith(null);
        expect(useChat.getState().sessionId).toBeNull();
    });
});

describe("applyEvent — history replay across multiple ReAct rounds", () => {
    // 后端持久化只存 *_complete + tool_call + tool_result，没有流式 chunks。
    // 多轮 ReAct 回放时，必须保持 tool 与 text 的相对顺序，不能把后面轮次的
    // text/reasoning 倒灌到第一轮覆盖掉，也不能把 tool 全部堆到末尾。
    it("two rounds: text → tool → text keeps interleaved part order", () => {
        const b = fresh();
        feed(b, [
            { type: "user_message", data: { metadata: { hide: false }, content: "hi" }, ts: 1000 },
            // round 1
            { type: "assistant_message_complete", data: { content: "round1" }, ts: 1100 },
            { type: "tool_call", data: { id: "t1", name: "ls", arguments: {} }, ts: 1110 },
            { type: "tool_result", data: { id: "t1", result: "ok1" }, ts: 1120 },
            // round 2
            { type: "assistant_message_complete", data: { content: "round2" }, ts: 1200 },
            { type: "tool_call", data: { id: "t2", name: "cat", arguments: {} }, ts: 1210 },
            { type: "tool_result", data: { id: "t2", result: "ok2" }, ts: 1220 },
            // round 3 — final answer
            { type: "assistant_message_complete", data: { content: "final" }, ts: 1300 },
            { type: "done", data: { success: true }, ts: 1310 },
        ]);

        expect(b.messages).toHaveLength(2);
        const m = b.messages[1];
        expect(m.role).toBe("assistant");
        const partTypes = m.parts.map((p: any) => p.type);
        // 顺序必须是 text → tool → text → tool → text
        expect(partTypes).toEqual(["text", "tool_call", "text", "tool_call", "text"]);

        const texts = m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text);
        expect(texts).toEqual(["round1", "round2", "final"]);

        // tools 顺序与 parts 一致（不能"集体跑到最后"）
        const toolIdsInParts = m.parts
            .filter((p: any) => p.type === "tool_call")
            .map((p: any) => p.toolCallId);
        expect(toolIdsInParts).toEqual(["t1", "t2"]);
        expect(m.toolCalls.map((t: any) => t.id)).toEqual(["t1", "t2"]);
        expect(m.toolCalls.every((t: any) => t.status === "ok")).toBe(true);

        // content 拼起来是各轮 text 顺序连接
        expect(m.content).toBe("round1round2final");
    });

    it("reasoning across rounds: complete events do not overwrite prior round", () => {
        const b = fresh();
        feed(b, [
            { type: "user_message", data: { metadata: { hide: false }, content: "hi" }, ts: 1000 },
            // round 1
            { type: "reasoning_complete", data: { content: "thinking-1" }, ts: 1100 },
            { type: "assistant_message_complete", data: { content: "say-1" }, ts: 1110 },
            { type: "tool_call", data: { id: "t1", name: "x", arguments: {} }, ts: 1120 },
            { type: "tool_result", data: { id: "t1", result: "ok" }, ts: 1130 },
            // round 2
            { type: "reasoning_complete", data: { content: "thinking-2" }, ts: 1200 },
            { type: "assistant_message_complete", data: { content: "say-2" }, ts: 1210 },
            { type: "done", data: { success: true }, ts: 1220 },
        ]);

        const m = b.messages[1];
        const reasonings = m.parts
            .filter((p: any) => p.type === "reasoning")
            .map((p: any) => p.text);
        expect(reasonings).toEqual(["thinking-1", "thinking-2"]);

        const partTypes = m.parts.map((p: any) => p.type);
        expect(partTypes).toEqual([
            "reasoning",
            "text",
            "tool_call",
            "reasoning",
            "text",
        ]);
    });

    it("realtime streaming still folds chunks within a single round", () => {
        // 实时场景：chunks 先到、complete 后到，必须落到当轮已累积的 part 上。
        const b = fresh();
        feed(b, [
            { type: "assistant_message", data: { content: "He" } },
            { type: "assistant_message", data: { content: "llo" } },
            { type: "assistant_message_complete", data: { content: "Hello" } },
            { type: "tool_call", data: { id: "t1", name: "ls", arguments: {} } },
            { type: "tool_result", data: { id: "t1", result: "ok" } },
            { type: "assistant_message", data: { content: "Wo" } },
            { type: "assistant_message", data: { content: "rld" } },
            { type: "assistant_message_complete", data: { content: "World" } },
            { type: "done", data: { success: true } },
        ]);

        const m = b.messages[0];
        const texts = m.parts
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text);
        expect(texts).toEqual(["Hello", "World"]);
        expect(m.parts.map((p: any) => p.type)).toEqual([
            "text",
            "tool_call",
            "text",
        ]);
        expect(m.content).toBe("HelloWorld");
    });

    it("tool_call_streaming arriving before assistant_message_complete must not duplicate the text", () => {
        // 真实路径：LLM 边吐字边 emit tool_call_streaming（args 分片）
        // 整个一轮的事件顺序：message chunks → tool_call_streaming x N
        // → assistant_message_complete → tool_call(确认) → tool_result
        // 这是用户截图复现的 bug：以前 tool_call_streaming 里把流式 text 封口了，
        // assistant_message_complete 看末尾不是 streaming text，又 push 一段，导致重复。
        const b = fresh();
        feed(b, [
            { type: "assistant_message", data: { content: "Cargo " } },
            { type: "assistant_message", data: { content: "可用了！" } },
            { type: "tool_call_streaming", data: { tool_calls: [{ id: "t1", name: "bash", arguments_delta: '{"command":' }] } },
            { type: "tool_call_streaming", data: { tool_calls: [{ id: "t1", arguments_delta: '"cargo build"}' }] } },
            { type: "assistant_message_complete", data: { content: "Cargo 可用了！" } },
            { type: "tool_call", data: { id: "t1", name: "bash", arguments: { command: "cargo build" } } },
            { type: "tool_result", data: { id: "t1", result: "ok" } },
            { type: "done", data: { success: true } },
        ]);

        const m = b.messages[0];
        const texts = m.parts
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text);
        // 关键断言：只能有一段 text，不能重复
        expect(texts).toEqual(["Cargo 可用了！"]);
        // 顺序应为 [text, tool]，不能在末尾再多一段 text
        expect(m.parts.map((p: any) => p.type)).toEqual(["text", "tool_call"]);
        expect(m.toolCalls).toHaveLength(1);
        expect(m.toolCalls[0].status).toBe("ok");
        // content 也只该出现一次
        expect(m.content).toBe("Cargo 可用了！");
    });
});


describe("applyEvent — context_compact silent 静默（无感）", () => {
    it("context_compact_start silent=true 不渲染气泡", () => {
        const b = fresh();
        feed(b, [
            { type: "context_compact_start", data: { events: 10, tokens: 50000, silent: true } },
        ]);
        expect(b.messages).toHaveLength(0);
    });

    it("context_compact_start 默认（无 silent）渲染气泡", () => {
        const b = fresh();
        feed(b, [
            { type: "context_compact_start", data: { events: 10, tokens: 50000 } },
        ]);
        expect(b.messages).toHaveLength(1);
        expect(b.messages[0].role).toBe("system");
        expect(b.messages[0].compact?.status).toBe("running");
    });

    it("context_compact_done silent=true 不更新任何消息", () => {
        const b = fresh();
        // 先有一条非 silent 的 running 气泡
        feed(b, [{ type: "context_compact_start", data: { events: 1 } }]);
        // silent done 不该触碰它
        feed(b, [
            { type: "context_compact_done", data: { summary: "x", silent: true } },
        ]);
        expect(b.messages[0].compact?.status).toBe("running");
    });

    it("context_compact_done 默认更新最近 running 为 done", () => {
        const b = fresh();
        feed(b, [
            { type: "context_compact_start", data: { events: 5, tokens: 30000 } },
            { type: "context_compact_done", data: { summary: "## ok", tokens_before: 30000 } },
        ]);
        expect(b.messages[0].compact?.status).toBe("done");
        expect(b.messages[0].compact?.summaryPreview).toBe("## ok");
    });

    it("context_compact_failed silent=true 不更新任何消息", () => {
        const b = fresh();
        feed(b, [{ type: "context_compact_start", data: {} }]);
        feed(b, [{ type: "context_compact_failed", data: { reason: "oops", silent: true } }]);
        expect(b.messages[0].compact?.status).toBe("running");
    });

    it("context_compact 历史回放 silent=true 不插入分隔气泡", () => {
        const b = fresh();
        feed(b, [{ type: "context_compact", data: { summary: "## raw 兜底", silent: true } }]);
        expect(b.messages).toHaveLength(0);
    });

    it("context_compact 历史回放默认插入分隔气泡", () => {
        const b = fresh();
        feed(b, [{ type: "context_compact", data: { summary: "## subagent 摘要" } }]);
        expect(b.messages).toHaveLength(1);
        expect(b.messages[0].compact?.status).toBe("done");
        expect(b.messages[0].compact?.summaryPreview).toBe("## subagent 摘要");
    });
});

describe("clearSessionCache", () => {
    it("clears bucket so re-hydrate works without stale data", () => {
        const sid = `ws::test_clear_${Date.now()}`;
        useChat.getState().loadSessionEvents(sid, [
            { type: "user_message", data: { metadata: { hide: false }, content: "hello" }, ts: 1000 },
            { type: "assistant_message_complete", data: { content: "hi" }, ts: 2000 },
        ], "hydrate");

        // hasSessionCache always returns false (cache disabled)
        expect(useChat.getState().hasSessionCache(sid)).toBe(false);

        // clearSessionCache empties the bucket
        useChat.getState().clearSessionCache(sid);

        // re-hydrate with different data — should work cleanly
        useChat.getState().loadSessionEvents(sid, [
            { type: "user_message", data: { metadata: { hide: false }, content: "world" }, ts: 3000 },
        ], "hydrate");

        // Verify only the new message exists
        useChat.getState().switchTo(sid);
        const msgs = useChat.getState().messages;
        expect(msgs.length).toBe(1);
        expect(msgs[0].content).toBe("world");
    });
});
