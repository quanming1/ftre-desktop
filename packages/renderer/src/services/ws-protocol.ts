/**
 * WebSocket Protocol — ftre BusMessage 协议
 *
 * 下行（server → client）：
 *   { id, type: "agent_event", data: { type, data }, metadata }
 *
 * 上行（client → server）：
 *   直接发送 data 内容（JSON），服务端包装为 BusMessage
 */

// ─── Server → Client ────────────────────────────────────────────────

/** 服务端下行消息（BusMessage 序列化） */
export interface ServerMessage {
  id: string;
  type: string;
  data: AgentEvent;
  metadata: {
    channel_id: string;
    session_id: string;
    [key: string]: unknown;
  };
}

/** Agent 事件 */
export interface AgentEvent {
  type: AgentEventType;
  data: Record<string, unknown>;
}

export type AgentEventType =
  | "message"
  | "message_complete"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "tool_call_streaming"
  | "tool_cancelled"
  | "error"
  | "retry"
  | "done"
  | "usage_update";

// ─── Agent Event Data Types ─────────────────────────────────────────

export interface MessageData {
  content: string;
}

export interface MessageCompleteData {
  content: string;
}

export interface ReasoningData {
  content: string;
}

export interface ToolCallData {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultData {
  id: string;
  name: string;
  result: string;
  error: string | null;
  status: string;
}

export interface ToolCallStreamingData {
  tool_calls: Array<{
    index: number;
    id?: string;
    name?: string;
    arguments_delta?: string;
  }>;
}

export interface DoneData {
  success: boolean;
  reason: string;
}

export interface ErrorData {
  message: string;
  code: string;
}

export interface UsageUpdateData {
  usage: Record<string, unknown>;
}

// ─── Client → Server ────────────────────────────────────────────────

/** 客户端上行：直接发送 data 对象 */
export interface ClientMessage {
  content: string;
  media?: MediaItem[];
}

export interface MediaItem {
  data_url: string;
  name?: string;
}

// ─── Utilities ──────────────────────────────────────────────────────

export function isServerMessage(msg: unknown): msg is ServerMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "id" in msg &&
    "type" in msg &&
    "data" in msg
  );
}

export function generateMessageId(): string {
  return crypto.randomUUID().slice(0, 12);
}
