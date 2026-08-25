/** Chat Store 与纯投影共用的数据契约；不依赖 Zustand 或 WebSocket 生命周期。 */
import type { MessageToken } from "@/services/api";

export type Role = "assistant" | "user" | "system";
export type SessionStatus = "idle" | "running" | "compacting" | "blocked";
export type SendMessageResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: "empty" | "compacting" | "blocked" | "outbox_full" | "transport_failed" };

/** 协议级 content block（assistant 消息的最小内容单元） */
export type ContentBlock =
  | { type: "thinking"; thinking: string; blockId: string }
  | { type: "text"; text: string; blockId: string }
  | { type: "data"; data: string; url?: string; mediaType: string; blockId: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, any>; argumentsText?: string };

/** 工具权限确认信息（status==="asking" 时携带，供确认卡片渲染） */
export interface ToolConfirm {
  /** 命中 ASK 的原因（实时事件携带；历史恢复时无该字段，用通用文案） */
  reason?: string;
  /** 命中的权限规则 id（可选，仅溯源展示） */
  ruleId?: string;
}

/** 工具执行结果（与 toolCall block 的 id 配对） */
export interface ToolResult {
  id: string;
  name: string;
  result: string | null;
  error: string | null;
  status: "running" | "completed" | "error" | "cancelled" | "asking" | "denied";
  /** status==="asking" 时的权限确认上下文 */
  confirm?: ToolConfirm;
  /** 工具附加元数据（edit/write 携带 diff 信息） */
  metadata?: {
    file?: string;
    before?: string;
    after?: string;
    diff?: string;
    additions?: number;
    deletions?: number;
    [key: string]: any;
  };
}

export interface MessageAttachment {
  type: "image";
  url: string;
  mime?: string;
  name?: string;
  bytes?: number;
}

export interface ChatMessage {
  id: string;
  role: Role;
  /** user: 文本; assistant: 拼接文本(便利字段); system: null */
  content: string | null;
  timestamp: number;
  /** assistant: 协议 content blocks（直接存储，不做二次转换） */
  blocks?: ContentBlock[];
  /** assistant: tool 结果，按 toolCall.id 索引 */
  toolResults?: Record<string, ToolResult>;
  streaming?: boolean;
  attachments?: MessageAttachment[];
  token?: MessageToken;
  metadata?: { kind?: "block" | "final"; [k: string]: any };
  isError?: boolean;
  /** Reply 结束后的状态错误；正文仍按正常 content blocks 渲染。 */
  error?: { code?: string; message: string };
  external?: boolean;
  externalFrom?: string;
  compact?: {
    status: "running" | "done" | "failed";
    mode?: "summary" | "fast";
    /** context_compact_start 中的实际摘要模型；仅运行中的压缩使用。 */
    model?: string;
    tokensBefore?: number;
    tokensAfter?: number;
    summaryPreview?: string;
    eventsCleared?: number;
    toolResults?: number;
    reason?: string;
  };
  /** 本轮耗时（秒），turn_end 时计算写入 */
  durationSec?: number;
  /** assistant 完成时间（毫秒时间戳），来自 Msg.finished_at 或 TURN_END。 */
  finishedAt?: number;
  /** 产生该消息的模型 ID（从 MODEL_CALL_START.model_name 提取） */
  model?: string;
  /** 本地发送或重连恢复的用户消息所对应的可靠队列生命周期。 */
}

export interface RetryState {
  attempt: number;
  maxAttempts: number;
  message: string;
}

export interface PlanStep {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface PlanData {
  goal: string;
  steps: PlanStep[];
}
