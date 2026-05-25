import { describe, it, expect } from "vitest";
import { splitBlocks } from "./streamingMarkdown";

describe("splitBlocks", () => {
    it("空字符串返回空数组", () => {
        expect(splitBlocks("")).toEqual([]);
    });

    it("单段无空行整体作为一块", () => {
        const r = splitBlocks("hello world\n这只是一段");
        expect(r).toEqual([{ content: "hello world\n这只是一段" }]);
    });

    it("空行切分两段", () => {
        const r = splitBlocks("段落一\n第二行\n\n段落二");
        expect(r.map((b) => b.content)).toEqual(["段落一\n第二行", "段落二"]);
    });

    it("多个连续空行只分一次（不产生空块）", () => {
        const r = splitBlocks("a\n\n\n\nb");
        expect(r.map((b) => b.content)).toEqual(["a", "b"]);
    });

    it("代码块内的空行不切", () => {
        const text = ["前文", "", "```ts", "function f() {", "", "  return 1;", "}", "```", "", "尾巴"].join("\n");
        const r = splitBlocks(text);
        expect(r).toHaveLength(3);
        expect(r[0].content).toBe("前文");
        expect(r[1].content).toBe("```ts\nfunction f() {\n\n  return 1;\n}\n```");
        expect(r[2].content).toBe("尾巴");
    });

    it("未闭合的代码块（streaming 中）作为最后一块", () => {
        const text = ["intro", "", "```py", "x = 1", "y = 2"].join("\n");
        const r = splitBlocks(text);
        expect(r).toHaveLength(2);
        expect(r[0].content).toBe("intro");
        expect(r[1].content).toBe("```py\nx = 1\ny = 2");
    });

    it("波浪号围栏代码块同样处理", () => {
        const text = ["a", "", "~~~js", "b", "~~~", "", "c"].join("\n");
        const r = splitBlocks(text);
        expect(r.map((b) => b.content)).toEqual(["a", "~~~js\nb\n~~~", "c"]);
    });

    it("代码块内出现不同字符的 fence 不会误闭合", () => {
        const text = ["```ts", "// '~~~'", "code", "```"].join("\n");
        const r = splitBlocks(text);
        expect(r).toHaveLength(1);
        expect(r[0].content).toBe(text);
    });

    it("末尾未以空行结束 → 最后一块即为尾巴", () => {
        const text = "段落一\n\n段落二还在写";
        const r = splitBlocks(text);
        expect(r.map((b) => b.content)).toEqual(["段落一", "段落二还在写"]);
    });

    it("增量增长：每多一个 token，已闭合块的 content 字符串保持稳定", () => {
        const stable = "第一段\n\n第二段已结束\n\n";
        let last = stable + "第三段还在写";
        const blocks1 = splitBlocks(last);

        last += "更多内容";
        const blocks2 = splitBlocks(last);

        // 前两块的 content 字符串严格相等（memo 能 bail out）
        expect(blocks1[0].content).toBe(blocks2[0].content);
        expect(blocks1[1].content).toBe(blocks2[1].content);
        // 只有最后一块在变
        expect(blocks1[2].content).not.toBe(blocks2[2].content);
    });
});
