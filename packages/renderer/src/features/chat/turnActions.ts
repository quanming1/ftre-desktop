import type { ChatMessage } from "@/stores/chat";

/**
 * 已闭合的历史 Turn 始终展示操作；session 运行中只隐藏最新活动 Turn 的操作。
 */
export function shouldShowTurnActions(
  messages: ChatMessage[],
  index: number,
  isBusy: boolean,
): boolean {
  const message = messages[index];
  if (message?.role !== "assistant" || message.streaming) return false;

  const next = messages[index + 1];
  const isTurnEnd = !next || next.role !== "assistant";
  if (!isTurnEnd) return false;
  if (!isBusy) return true;

  let activeTurnStart = -1;
  for (let cursor = messages.length - 1; cursor >= 0; cursor--) {
    if (messages[cursor].role === "user") {
      activeTurnStart = cursor;
      break;
    }
  }

  return activeTurnStart >= 0 && index < activeTurnStart;
}
