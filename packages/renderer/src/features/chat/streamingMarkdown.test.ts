import { describe, it, expect } from "vitest";
import { splitBlocks, createBlockSplitter } from "./streamingMarkdown";

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

describe("createBlockSplitter（增量切块）", () => {
    /** 模拟流式：逐段追加，校验每一步与全量 splitBlocks 的结果一致 */
    function streamSteps(chunks: string[]): Array<{ text: string; splitter: ReturnType<typeof createBlockSplitter> }> {
        const splitter = createBlockSplitter();
        let text = "";
        const steps = chunks.map((chunk) => {
            text += chunk;
            return { text, splitter };
        });
        return steps;
    }

    it("append-only 追加与全量切分结果一致（普通段落）", () => {
        const chunks = ["第一段", "还在写", "\n\n第二段开始", "，继续", "\n\n\n第三段"];
        for (const { text, splitter } of streamSteps(chunks)) {
            expect(splitter.split(text)).toEqual(splitBlocks(text));
        }
    });

    it("append-only 追加与全量切分结果一致（围栏代码块闭合）", () => {
        const chunks = ["intro\n\n```ts", "\nconst a = 1;", "\n\n```", "\n\n尾巴", "追加"];
        for (const { text, splitter } of streamSteps(chunks)) {
            expect(splitter.split(text)).toEqual(splitBlocks(text));
        }
    });

    it("append-only 追加与全量切分结果一致（未闭合代码块内含空行）", () => {
        const chunks = ["```py", "\nx = 1", "\n", "\ny = 2", "\nz = 3"];
        for (const { text, splitter } of streamSteps(chunks)) {
            expect(splitter.split(text)).toEqual(splitBlocks(text));
        }
    });

    it("已闭合块对象引用稳定（memo 可直接 bail out）", () => {
        const splitter = createBlockSplitter();
        const first = splitter.split("块一\n\n块二还在写");
        const second = splitter.split("块一\n\n块二还在写，追加内容");

        expect(second).toHaveLength(2);
        expect(second[0]).toBe(first[0]); // 同一对象实例
        expect(second[1].content).not.toBe(first[1].content);
    });

    it("非 append-only 输入自动退回全量切分（结果仍正确）", () => {
        const splitter = createBlockSplitter();
        splitter.split("第一版内容\n\n第二段");
        const shrunk = "第一版内容，被替换";
        expect(splitter.split(shrunk)).toEqual(splitBlocks(shrunk));
    });

    it("空输入重置状态", () => {
        const splitter = createBlockSplitter();
        splitter.split("一些内容");
        expect(splitter.split("")).toEqual([]);
        expect(splitter.split("重新开始")).toEqual(splitBlocks("重新开始"));
    });
});
