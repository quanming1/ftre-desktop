/**
 * 直观 demo：把同一份 mock 历史事件分别喂给"旧 reducer（有 BUG 的版本）"和
 * "新 reducer（修复后）"，打印出 parts 顺序对比。
 *
 * 跑：
 *   pnpm --filter @ftre/renderer exec vitest run src/stores/chat.reducer.demo.test.ts --reporter=verbose
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/services/websocket-client", () => ({
    wsClient: {
        onMessage: vi.fn(),
        onDisconnect: vi.fn(),
        onConnect: vi.fn(),
        onStatusChange: vi.fn(),
        sendChat: vi.fn(),
        sendCancel: vi.fn(),
        attach: vi.fn(),
        connected: false,
    },
}));

import {
    applyEvent,
    type BusEvent,
    type ChatMessage,
    type MessagePart,
    type ToolCall,
} from "./chat";

// ─── 旧 reducer 仿写（仅复刻有 BUG 的 message_complete 处理） ─────
function applyEventOldBuggy(b: { messages: ChatMessage[] }, ev: BusEvent): void {
    const d = ev.data || {};
    const ts = ev.ts ?? Date.now();
    const last = <T,>(a: T[]) => a[a.length - 1];

    const tail = (): ChatMessage | null => {
        const m = last(b.messages);
        return m && m.role === "assistant" && m.streaming && !m.isError ? m : null;
    };
    const ensure = () => {
        if (tail()) return;
        b.messages = [
            ...b.messages,
            {
                id: `ast_${b.messages.length}`,
                role: "assistant",
                content: null,
                timestamp: ts,
                streaming: true,
                parts: [],
                toolCalls: [],
            },
        ];
    };
    const replaceTail = (mut: (m: ChatMessage) => ChatMessage) => {
        const i = b.messages.length - 1;
        if (i < 0) return;
        const next = b.messages.slice();
        next[i] = mut(next[i]);
        b.messages = next;
    };

    if (ev.type === "USER_INPUT") {
        b.messages = [
            ...b.messages,
            { id: `u_${b.messages.length}`, role: "user", content: d.content || "", timestamp: ts },
        ];
        return;
    }
    if (ev.type === "message_complete") {
        ensure();
        const final = d.content || "";
        replaceTail((m) => {
            const parts: MessagePart[] = [...(m.parts || [])];
            // ★ 旧逻辑：盲目找最后一个 text part 覆盖，不识别 tool 边界
            let lastTextIdx = -1;
            for (let i = parts.length - 1; i >= 0; i--) {
                if (parts[i].type === "text") { lastTextIdx = i; break; }
            }
            if (lastTextIdx >= 0) parts[lastTextIdx] = { type: "text", text: final };
            else if (final) parts.push({ type: "text", text: final });
            const content = parts
                .filter((p): p is { type: "text"; text: string } => p.type === "text")
                .map((p) => p.text)
                .join("");
            return { ...m, parts, content };
        });
        return;
    }
    if (ev.type === "tool_call") {
        ensure();
        const id: string = d.id ?? "";
        const name: string = d.name ?? "?";
        const args = typeof d.arguments === "object" ? JSON.stringify(d.arguments) : String(d.arguments ?? "{}");
        replaceTail((m) => {
            const toolCalls: ToolCall[] = [...(m.toolCalls || [])];
            const parts: MessagePart[] = [...(m.parts || [])];
            toolCalls.push({ id, name, arguments: args, status: "running" });
            parts.push({ type: "tool_call", toolCallId: id });
            return { ...m, toolCalls, parts };
        });
        return;
    }
    if (ev.type === "tool_result") {
        const id = d.id;
        for (let i = b.messages.length - 1; i >= 0; i--) {
            const tc = b.messages[i].toolCalls?.find((t) => t.id === id);
            if (!tc) continue;
            const next = b.messages.slice();
            next[i] = {
                ...next[i],
                toolCalls: next[i].toolCalls!.map((t) =>
                    t.id === id ? { ...t, status: "ok" as const, result: d.result ?? "" } : t,
                ),
            };
            b.messages = next;
            return;
        }
        return;
    }
    if (ev.type === "done") {
        replaceTail((m) => ({ ...m, streaming: false }));
        return;
    }
}

// ─── Mock 历史 ─────
const HISTORY: BusEvent[] = [
    { type: "USER_INPUT", data: { content: "需求：列目录然后总结" }, ts: 1000 },
    // round 1
    { type: "message_complete", data: { content: "我先列一下根目录" }, ts: 1100 },
    { type: "tool_call", data: { id: "t1", name: "ls", arguments: { path: "." } }, ts: 1110 },
    { type: "tool_result", data: { id: "t1", result: "a.py b.py" }, ts: 1120 },
    // round 2
    { type: "message_complete", data: { content: "看到 2 个 py 文件" }, ts: 1200 },
    { type: "tool_call", data: { id: "t2", name: "cat", arguments: { file: "a.py" } }, ts: 1210 },
    { type: "tool_result", data: { id: "t2", result: "print('hi')" }, ts: 1220 },
    // round 3 — 最终
    { type: "message_complete", data: { content: "总结：是 hello world" }, ts: 1300 },
    { type: "done", data: { success: true }, ts: 1310 },
];

function describePart(p: MessagePart, toolCalls: ToolCall[]): string {
    if (p.type === "text") return `[TEXT] "${p.text}"`;
    if (p.type === "reasoning") return `[REASON] "${p.text}"`;
    const tc = toolCalls.find((t) => t.id === p.toolCallId);
    return `[TOOL ${tc?.name ?? "?"}(${p.toolCallId})] → ${tc?.result ?? "(no result)"}`;
}
function dump(label: string, msg: ChatMessage | undefined) {
    console.log(`\n── ${label} ───────────────────────────────────────────`);
    if (!msg) {
        console.log("(no assistant message)");
        return;
    }
    console.log(`role=${msg.role}  parts=${msg.parts?.length}  tools=${msg.toolCalls?.length}`);
    msg.parts?.forEach((p, i) =>
        console.log(`  ${String(i).padStart(2)}. ${describePart(p, msg.toolCalls || [])}`),
    );
    console.log(`  content="${msg.content}"`);
}

describe("DEMO: 旧 vs 新 reducer 在同一份 DB 回放数据上的行为", () => {
    it("打印对比 + 断言 BUG 已修复", () => {
        // —— 跑两边
        const oldB: { messages: ChatMessage[] } = { messages: [] };
        HISTORY.forEach((e) => applyEventOldBuggy(oldB, e));

        const newB: { messages: ChatMessage[] } = { messages: [] };
        HISTORY.forEach((e) => applyEvent(newB as any, e));

        console.log("\n══════════════════════════════════════════════════════════════════");
        console.log("Mock 历史（DB 回放，无 streaming chunks）：");
        HISTORY.forEach((e, i) => {
            const s =
                e.type === "USER_INPUT" || e.type === "message_complete"
                    ? `"${e.data?.content}"`
                    : e.type === "tool_call"
                        ? `id=${e.data?.id} name=${e.data?.name}`
                        : e.type === "tool_result"
                            ? `id=${e.data?.id} result="${e.data?.result}"`
                            : "";
            console.log(`  ${String(i).padStart(2)}. ${e.type.padEnd(20)} ${s}`);
        });

        const oldMsg = oldB.messages.find((m) => m.role === "assistant");
        const newMsg = newB.messages.find((m) => m.role === "assistant");
        dump("旧 reducer（BUG）", oldMsg);
        dump("新 reducer（已修复）", newMsg);
        console.log("\n══════════════════════════════════════════════════════════════════\n");

        // —— 断言：旧 reducer 确实坏掉 ——
        const oldTexts = oldMsg!.parts!
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text);
        const oldTypes = oldMsg!.parts!.map((p) => p.type);

        // 旧 BUG 1：3 段 text 被压成 1 段（前两段被覆盖了）
        expect(oldTexts).toEqual(["总结：是 hello world"]);
        // 旧 BUG 2：tool 都堆在尾部（顺序变成 text → tool → tool 而不是 text→tool→text→tool→text）
        expect(oldTypes).toEqual(["text", "tool_call", "tool_call"]);

        // —— 断言：新 reducer 顺序正确 ——
        const newTexts = newMsg!.parts!
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text);
        const newTypes = newMsg!.parts!.map((p) => p.type);

        expect(newTexts).toEqual(["我先列一下根目录", "看到 2 个 py 文件", "总结：是 hello world"]);
        expect(newTypes).toEqual(["text", "tool_call", "text", "tool_call", "text"]);
        expect(newMsg!.content).toBe("我先列一下根目录看到 2 个 py 文件总结：是 hello world");
    });
});
