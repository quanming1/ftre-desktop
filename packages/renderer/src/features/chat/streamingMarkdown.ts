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

export function splitBlocks(text: string): MarkdownBlock[] {
    if (!text) return [];

    const lines = text.split("\n");
    const blocks: MarkdownBlock[] = [];
    let buf: string[] = [];
    let inCode = false;
    let codeFence = "";

    const flush = () => {
        if (buf.length === 0) return;
        blocks.push({ content: buf.join("\n") });
        buf = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (!inCode) {
            // fenced code block 起点
            const m = line.match(/^\s*(`{3,}|~{3,})/);
            if (m) {
                flush();
                inCode = true;
                codeFence = m[1];
                buf.push(line);
                continue;
            }

            // 空行：作为块分隔符。前面无内容则跳过，避免出现空块
            if (line.trim() === "") {
                if (buf.length > 0) flush();
                continue;
            }

            buf.push(line);
        } else {
            buf.push(line);
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
    return blocks;
}

/**
 * createBlockSplitter — splitBlocks 的增量缓存版本（供流式渲染使用）。
 *
 * 流式文本只会追加（TEXT_BLOCK_DELTA 单调拼接，throttle 展示值是全文前缀），
 * 而「追加永远不会改变已闭合的块」——块边界只由空行/围栏闭合决定，
 * 都位于追加点之前。因此只需重切「上一块内容 + 新增后缀」，
 * 复杂度从 O(全文) 降到 O(尾块 + delta)。
 *
 * 输入不满足 append-only 时（换消息、回退）自动退回全量切分并重置缓存。
 * 返回的已闭合块对象复用同一实例（引用稳定），内容字符串也不重新分配。
 */
export interface BlockSplitter {
    split(text: string): MarkdownBlock[];
}

export function createBlockSplitter(): BlockSplitter {
    let hasState = false;
    let input = "";
    /** 已闭合块（不含进行中的尾块） */
    let closed: MarkdownBlock[] = [];
    /** 进行中的尾块内容 */
    let tail = "";

    return {
        split(text: string): MarkdownBlock[] {
            if (!text) {
                hasState = true;
                input = "";
                closed = [];
                tail = "";
                return [];
            }

            if (hasState && input.length > 0 && text.length >= input.length && text.startsWith(input)) {
                // append-only 快路径：重切 尾块 + 新增部分。
                // merged 的非尾块并入 closed；返回值 = closed + merged 的尾块。
                const merged = splitBlocks(tail + text.slice(input.length));
                for (let i = 0; i < merged.length - 1; i++) {
                    closed.push(merged[i]);
                }
                tail = merged.length > 0 ? merged[merged.length - 1].content : "";
                input = text;
                return merged.length > 0
                    ? closed.concat(merged[merged.length - 1])
                    : [...closed];
            }

            // 慢路径：全量切分并重置
            const blocks = splitBlocks(text);
            hasState = true;
            input = text;
            closed = blocks.length > 0 ? blocks.slice(0, -1) : [];
            tail = blocks.length > 0 ? blocks[blocks.length - 1].content : "";
            return blocks;
        },
    };
}
