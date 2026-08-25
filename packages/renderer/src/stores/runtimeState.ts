import type { SessionActivity } from "@/services/websocket-client";
import type { ChatMessage, SessionStatus } from "./chatTypes";

/**
 * 队列和运行态是两条不同的事实流。
 *
 * 这里集中放窄语义判断，避免 UI 把多个独立事实流混成一个万能开关：
 * - pending 只表示 Inbox 还有待接纳/等待的输入；
 * - active turn 只表示 Agent 正在执行本轮推理或正在收尾；
 * - streaming 只表示确实存在尚未结束的 Assistant 消息。
 */
export function hasPendingWork(
  queueDepth: number,
  pendingMessages: unknown[] | undefined,
): boolean {
  return queueDepth > 0 || (pendingMessages?.length ?? 0) > 0;
}

/** Agent 正在处理当前 Turn；dispatching 只代表消息入队，不显示处理中占位。 */
export function hasActiveTurn(
  sessionStatus: SessionStatus,
  sessionActivity: SessionActivity,
): boolean {
  return sessionStatus === "running"
    && (sessionActivity === "executing" || sessionActivity === "cancelling");
}

/** 判断会话是否仍有运行详情需要展示，包括压缩、等待确认和派发阶段。 */
export function hasRuntimeActivity(
  sessionStatus: SessionStatus,
  sessionActivity: SessionActivity,
  turnStartTs: number | null,
): boolean {
  return sessionStatus !== "idle"
    || sessionActivity !== "idle"
    || turnStartTs != null;
}

/** 真实的 LLM 流式输出只由消息投影中的 streaming 标记决定。 */
export function hasStreamingAssistant(messages: ChatMessage[]): boolean {
  return messages.some((message) => message.role === "assistant" && message.streaming);
}
