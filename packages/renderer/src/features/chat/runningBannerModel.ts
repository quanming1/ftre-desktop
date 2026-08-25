import type { ChatMessage, SessionStatus } from "@/stores/chat";

interface RunningBannerModelInput {
  sessionStatus: SessionStatus;
  messages: ChatMessage[];
  storeModel: string | null;
}

/**
 * 运行横幅的模型标签。
 *
 * 压缩不是普通 Agent 回复，必须只使用 context_compact_start 明示的摘要模型；
 * 旧 Gateway 未提供该字段时不显示模型，不能回退到历史 assistant 回复的模型。
 */
export function resolveRunningBannerModel({
  sessionStatus,
  messages,
  storeModel,
}: RunningBannerModelInput): string | null {
  if (sessionStatus === "idle") return null;

  if (sessionStatus === "compacting") {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const compact = messages[index].compact;
      if (compact?.status === "running") return compact.model ?? null;
    }
    return null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.model) return message.model;
  }
  return storeModel;
}
