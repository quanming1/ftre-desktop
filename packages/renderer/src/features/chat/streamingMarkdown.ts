/**
 * Streaming Markdown 切块器
 *
 * 把一段 markdown 文本按"块边界"切成数组，让 streaming 渲染时
 * 已闭合的块走 React.memo bail out，只有"正在写的尾巴"重新解析。
 *
 * 切块规则（足够覆盖日常 LLM 输出）：
 * - 普通文本之间用空行（一行或多行）做分隔
 * - 围栏代码块 (``` 或 ~~~) 内部的空行不切，等闭合 fence 出现才结束
 * - 切出来的块按出现顺序排列；最后一块若文本未以空行收尾，则属于"尾部"
 *   （由调用方据 index 判断，本模块只负责切，不标记 closed）
 *
 * 复杂度：O(n) 一次扫描，n 是字符数。
 */

export interface MarkdownBlock {
    content: string;
}

interface BlockRecord extends MarkdownBlock {
    start: number;
    end: number;
}

interface ParsedBlocks {
    blocks: BlockRecord[];
    inCode: boolean;
}

function parseBlockRecords(text: string): ParsedBlocks {
    if (!text) return { blocks: [], inCode: false };

    const lines = text.split("\n");
    const blocks: BlockRecord[] = [];
    let buf: string[] = [];
    let inCode = false;
    let codeFence = "";
    let offset = 0;
    let blockStart = -1;
    let blockEnd = -1;

    const flush = () => {
        if (buf.length === 0) return;
        blocks.push({
            content: buf.join("\n"),
            start: blockStart,
            end: blockEnd,
        });
        buf = [];
        blockStart = -1;
        blockEnd = -1;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineStart = offset;
        const lineEnd = lineStart + line.length;
        offset = lineEnd + 1;

        if (!inCode) {
            // fenced code block 起点
            const m = line.match(/^\s*(`{3,}|~{3,})/);
            if (m) {
                flush();
                inCode = true;
                codeFence = m[1];
                blockStart = lineStart;
                blockEnd = lineEnd;
                buf.push(line);
                continue;
            }

            // 空行：作为块分隔符。前面无内容则跳过，避免出现空块
            if (line.trim() === "") {
                if (buf.length > 0) flush();
                continue;
            }

            if (buf.length === 0) blockStart = lineStart;
            buf.push(line);
            blockEnd = lineEnd;
        } else {
            if (buf.length === 0) blockStart = lineStart;
            buf.push(line);
            blockEnd = lineEnd;
            const trimmed = line.trim();
            // 闭合 fence：必须是同字符的同长度（或更长）行，且后面只能是空白
            // 这里用宽松匹配：以同样 fence 字符开头、整行只剩反引号/波浪号 + 空白
            if (
                trimmed.startsWith(codeFence) &&
                /^[`~]+\s*$/.test(trimmed)
            ) {
                flush();
                inCode = false;
                codeFence = "";
            }
        }
    }

    // 流末尾的剩余内容（可能是未闭合的尾部）
    flush();
    return { blocks, inCode };
}

export function splitBlocks(text: string): MarkdownBlock[] {
    return parseBlockRecords(text).blocks.map(({ content }) => ({ content }));
}

/**
 * createBlockSplitter — 带引用复用的安全切块器（供流式渲染使用）。
 *
 * 旧的尾块增量算法会丢弃尾部换行：当换行和下一段正文跨两个 chunk 到达时，
 * 下一次扫描拿不到真实的空行边界，导致实时 Markdown 与刷新后的全量解析不一致。
 * 这里保留未完成尾块的原始文本（包括尾部换行），每次只重切尾块和新增内容；
 * 已完成块对象继续复用。这样不会丢失跨 chunk 的空行边界，也不会让长回复退回
 * 到每次从头扫描全文。
 *
 * 输入回退、替换或流式追加都走同一条确定性路径，返回结果始终与 splitBlocks 一致。
 */
export interface BlockSplitter {
    split(text: string): MarkdownBlock[];
}

export function createBlockSplitter(): BlockSplitter {
    let input = "";
    let closed: MarkdownBlock[] = [];
    let output: MarkdownBlock[] = [];
    let tailRaw = "";
    let initialized = false;

    const apply = (
        source: string,
        parsed: ParsedBlocks,
        prefix: MarkdownBlock[],
        previous: MarkdownBlock[],
    ): MarkdownBlock[] => {
        const records = parsed.blocks;
        const last = records[records.length - 1];
        // splitBlocks 会把结尾的换行当作空行分隔符；只有代码块仍未闭合时，
        // 这些换行才属于当前尾块，不能提前提交。
        const hasTrailingSeparator = !parsed.inCode
            && (last === undefined
                || (source.length > last.end && source.slice(last.end).trim() === ""));
        const stableCount = hasTrailingSeparator ? records.length : Math.max(records.length - 1, 0);
        const candidates = records.map((record, index) => {
            const prior = previous[prefix.length + index];
            return prior?.content === record.content ? prior : { content: record.content };
        });

        closed = prefix.concat(candidates.slice(0, stableCount));
        const tail = candidates.slice(stableCount);
        output = closed.concat(tail);
        tailRaw = tail.length > 0 && last ? source.slice(last.start) : "";
        return output;
    };

    return {
        split(text: string): MarkdownBlock[] {
            const appendOnly = initialized
                && text.length >= input.length
                && text.startsWith(input);

            if (appendOnly) {
                const delta = text.slice(input.length);
                const next = apply(tailRaw + delta, parseBlockRecords(tailRaw + delta), closed, output);
                input = text;
                return next;
            }

            const next = apply(text, parseBlockRecords(text), [], []);
            input = text;
            initialized = true;
            return next;
        },
    };
}
