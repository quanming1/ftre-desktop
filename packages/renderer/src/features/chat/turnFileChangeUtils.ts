import type { ChatMessage } from "@/stores/chat";

/** 一轮中按文件合并后的 edit/write 变更。 */
export interface TurnFileChange {
  toolCallId: string;
  filePath: string;
  operation: "edit" | "write";
  additions: number;
  deletions: number;
  before: string;
  after: string;
}

function turnStartIndex(messages: ChatMessage[], endIndex: number): number {
  for (let index = endIndex; index >= 0; index--) {
    if (messages[index]?.role === "user") return index + 1;
  }
  return 0;
}

/**
 * 收集指定消息之前（含指定消息）的当前轮文件修改。
 * 同一文件多次修改保留第一次 before、最后一次 after，并累加增删行数。
 */
export function collectTurnFileChanges(
  messages: ChatMessage[],
  endIndex = messages.length - 1,
): TurnFileChange[] {
  if (messages.length === 0 || endIndex < 0) return [];
  const end = Math.min(endIndex, messages.length - 1);
  const fileMap = new Map<string, TurnFileChange>();

  for (let index = turnStartIndex(messages, end); index <= end; index++) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    for (const block of message.blocks ?? []) {
      if (block.type !== "toolCall" || (block.name !== "edit" && block.name !== "write")) continue;
      const result = message.toolResults?.[block.id];
      const metadata = result?.metadata;
      if (
        result?.status !== "completed"
        || !metadata?.file
        || metadata.before === undefined
        || metadata.after === undefined
      ) continue;

      const key = metadata.file.replace(/\\/g, "/").toLowerCase();
      const existing = fileMap.get(key);
      if (existing) {
        existing.after = metadata.after;
        existing.additions += metadata.additions ?? 0;
        existing.deletions += metadata.deletions ?? 0;
      } else {
        fileMap.set(key, {
          toolCallId: block.id,
          filePath: metadata.file,
          operation: block.name,
          additions: metadata.additions ?? 0,
          deletions: metadata.deletions ?? 0,
          before: metadata.before,
          after: metadata.after,
        });
      }
    }
  }

  return Array.from(fileMap.values());
}

/** 收集最近一条用户消息之后的本轮变更；空闲态也可用于保留上一轮摘要。 */
export function collectLatestTurnFileChanges(messages: ChatMessage[]): TurnFileChange[] {
  const lastUserIndex = messages.reduce(
    (found, message, index) => (message.role === "user" ? index : found),
    -1,
  );
  if (lastUserIndex < 0) return [];
  return collectTurnFileChanges(messages, messages.length - 1);
}

/** 运行详情入口：仅在 Agent 确实执行当前 Turn 时收集变更。 */
export function collectActiveTurnFileChanges(
  messages: ChatMessage[],
  hasActiveTurn: boolean,
): TurnFileChange[] {
  return hasActiveTurn ? collectLatestTurnFileChanges(messages) : [];
}

/** 输入框摘要是否可见；压缩期间必须隐藏上一轮的临时摘要。 */
export function shouldShowTurnFileChangesSummary(
  messages: ChatMessage[],
  hasActiveTurn: boolean,
  pendingMessagesCount: number,
  lastUserInputTs: number | null,
  isCompacting = false,
): boolean {
  if (!hasActiveTurn || isCompacting || (pendingMessagesCount > 0 && lastUserInputTs == null)) return false;
  return collectLatestTurnFileChanges(messages).length > 0;
}

/** 当前轮还没有任何 assistant 消息时，用于渲染发送后的等待占位。 */
export function shouldShowThinkingPlaceholder(
  messages: ChatMessage[],
  hasActiveTurn: boolean,
  pendingMessagesCount = 0,
): boolean {
  if (!hasActiveTurn) return false;
  const lastUserIndex = messages.reduce(
    (found, message, index) => (message.role === "user" ? index : found),
    -1,
  );
  if (lastUserIndex < 0) return pendingMessagesCount > 0;
  return !messages.slice(lastUserIndex + 1).some((message) => {
    if (message.role !== "assistant") return false;
    if (message.content?.trim() || message.error) return true;
    return (message.blocks ?? []).some((block) => {
      if (block.type === "toolCall") return true;
      if (block.type === "text") return block.text.trim().length > 0;
      if (block.type === "thinking") return block.thinking.trim().length > 0;
      return block.data.length > 0 || Boolean(block.url);
    });
  });
}
