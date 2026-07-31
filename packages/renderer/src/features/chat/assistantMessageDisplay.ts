import type { ContentBlock, ToolResult } from "@/stores/chat";

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
 *
 * 例外：待确认（asking）的工具调用卡片必须始终可见——否则暂停后用户看不到
 * 允许/拒绝按钮。这些 toolCall block 连同最终文本一起保留在折叠视图中。
 */
export function collapsedAssistantBlocks(
  blocks: ContentBlock[] | undefined,
  toolResults?: Record<string, ToolResult>,
): ContentBlock[] {
  const finalText = lastDisplayTextBlock(blocks);
  const askingCalls = (blocks ?? []).filter(
    (block): block is Extract<ContentBlock, { type: "toolCall" }> =>
      block.type === "toolCall" && toolResults?.[block.id]?.status === "asking",
  );
  if (askingCalls.length === 0) return finalText ? [finalText] : [];
  return finalText ? [...askingCalls, finalText] : askingCalls;
}

