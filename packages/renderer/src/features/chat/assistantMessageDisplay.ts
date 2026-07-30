import type { ContentBlock } from "@/stores/chat";

const DANGLING_THINK_MARKER = /^(?:<\/?(?:think|thinking)\s*>)+$/i;

/** 返回 AssistantMsg 中最后一个真正可展示的文本块。 */
export function lastDisplayTextBlock(
  blocks: ContentBlock[] | undefined,
): Extract<ContentBlock, { type: "text" }> | undefined {
  if (!blocks) return undefined;
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.type !== "text") continue;
    const text = block.text.trim();
    if (!text || DANGLING_THINK_MARKER.test(text)) continue;
    return block;
  }
  return undefined;
}

/**
 * 默认只展示最终文本；完整 blocks 仍保留在 ChatMessage 中，展开执行过程时使用。
 */
export function collapsedAssistantBlocks(
  blocks: ContentBlock[] | undefined,
): ContentBlock[] {
  const finalText = lastDisplayTextBlock(blocks);
  return finalText ? [finalText] : [];
}

