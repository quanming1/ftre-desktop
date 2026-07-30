import type { ChatMessage, ContentBlock, ToolResult } from "@/stores/chat";
import type { TurnFileChange } from "./TurnFileChanges";

export interface AssistantMessageComparableProps {
  message: ChatMessage;
  showActions?: boolean;
  turnTexts?: string[];
  turnFileChanges?: TurnFileChange[];
  turnDurationSec?: number;
  turnModel?: string;
}

export function contentBlocksEqual(
  left: ContentBlock[] | undefined,
  right: ContentBlock[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const a = left[index];
    const b = right[index];
    if (a.type !== b.type) return false;
    if (a.type === "text" && b.type === "text") {
      if (a.blockId !== b.blockId || a.text !== b.text) return false;
    } else if (a.type === "thinking" && b.type === "thinking") {
      if (a.blockId !== b.blockId || a.thinking !== b.thinking) return false;
    } else if (a.type === "data" && b.type === "data") {
      if (
        a.blockId !== b.blockId
        || a.data !== b.data
        || a.url !== b.url
        || a.mediaType !== b.mediaType
      ) return false;
    } else if (a.type === "toolCall" && b.type === "toolCall") {
      if (
        a.id !== b.id
        || a.name !== b.name
        || a.arguments !== b.arguments
        || a.argumentsText !== b.argumentsText
      ) return false;
    }
  }
  return true;
}

export function toolResultsEqual(
  left: Record<string, ToolResult> | undefined,
  right: Record<string, ToolResult> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    const a = left[key];
    const b = right[key];
    if (
      !b
      || a.status !== b.status
      || a.result !== b.result
      || a.error !== b.error
      || a.metadata !== b.metadata
    ) return false;
  }
  return true;
}

export function assistantMessagePropsEqual(
  prev: AssistantMessageComparableProps,
  next: AssistantMessageComparableProps,
): boolean {
  if (prev.message.content !== next.message.content) return false;
  if (prev.message.streaming !== next.message.streaming) return false;
  if (prev.message.token !== next.message.token) return false;
  if (prev.message.isError !== next.message.isError) return false;
  if (prev.message.error !== next.message.error) return false;
  if (prev.showActions !== next.showActions) return false;
  if (prev.turnTexts !== next.turnTexts) return false;
  if (prev.turnFileChanges !== next.turnFileChanges) return false;
  if (prev.turnDurationSec !== next.turnDurationSec) return false;
  if (prev.turnModel !== next.turnModel) return false;
  return (
    contentBlocksEqual(prev.message.blocks, next.message.blocks)
    && toolResultsEqual(prev.message.toolResults, next.message.toolResults)
  );
}
