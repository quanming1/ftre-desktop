/**
 * WebSocket Protocol v4 Type Definitions
 *
 * v4 separates frame types for clarity:
 * - text.delta / text.done: streaming text
 * - tool.start / tool.delta / tool.done / tool.error: tool lifecycle
 * - message: complete message (history, tool results)
 */

// ─── Base Types ─────────────────────────────────────────────────────

export type Role = "assistant" | "user" | "system" | "tool";

export interface Frame<T extends string = string, D = Record<string, unknown>> {
  id: string;
  type: T;
  data: D;
}

export interface MediaUrl {
  url: string;
  name: string;
}

export interface MediaItem {
  data_url: string;
  name?: string;
}

// ─── Tool Call (OpenAI format, for message.tool_calls) ──────────────

/** Tool call in OpenAI format */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string (needs JSON.parse)
  };
}

// ─── v4 Frame Data Types ────────────────────────────────────────────

/** text.delta frame data */
export interface TextDeltaData {
  message_id: string;
  chat_id: string;
  seq: number;
  delta: string;
  content: string; // Accumulated content, can render directly
}

/** text.done frame data */
export interface TextDoneData {
  message_id: string;
  chat_id: string;
  content: string;
  reasoning_content?: string;
  thinking_blocks?: Array<{ type: string; thinking?: string }>;
  timestamp: string;
}

/** tool.start frame data */
export interface ToolStartData {
  call_id: string;
  chat_id: string;
  name: string;
}

/** tool.delta frame data */
export interface ToolDeltaData {
  call_id: string;
  chat_id: string;
  delta: string; // JSON fragment
}

/** tool.done frame data */
export interface ToolDoneData {
  call_id: string;
  chat_id: string;
  name: string;
  arguments: Record<string, unknown>; // Already parsed, no JSON.parse needed
  result: unknown;
  files?: unknown[];
  embeds?: unknown[];
  timestamp: string;
}

/** tool.error frame data */
export interface ToolErrorData {
  call_id: string;
  chat_id: string;
  name: string;
  arguments?: Record<string, unknown>;
  error: string;
  timestamp: string;
}

/** message frame data (complete messages) */
export interface MessageData {
  id: string;
  chat_id: string;
  role: Role;
  content: string | null;
  timestamp: string;
  tool_calls?: ToolCall[]; // assistant message with tool calls
  tool_call_id?: string; // tool result message
  name?: string; // tool result message
  reasoning_content?: string;
  thinking_blocks?: Array<{ type: string; thinking?: string }>;
  media_urls?: MediaUrl[];
}

// ─── Downstream Frames (server → client) ────────────────────────────

// Control frames
export type ReadyFrame = Frame<
  "session.ready",
  { chat_id: string; client_id: string; protocol: string }
>;

export type AttachedFrame = Frame<"session.attached", { chat_id: string }>;

export type SessionUpdatedFrame = Frame<"session.updated", { chat_id: string }>;

export type TurnStartFrame = Frame<"turn.start", { chat_id: string }>;

export type TurnEndFrame = Frame<"turn.end", { chat_id: string }>;

export type AckFrame = Frame<"chat.ack", { chat_id: string; ref_id: string }>;

// v4 content frames
export type TextDeltaFrame = Frame<"text.delta", TextDeltaData>;
export type TextDoneFrame = Frame<"text.done", TextDoneData>;
export type ToolStartFrame = Frame<"tool.start", ToolStartData>;
export type ToolDeltaFrame = Frame<"tool.delta", ToolDeltaData>;
export type ToolDoneFrame = Frame<"tool.done", ToolDoneData>;
export type ToolErrorFrame = Frame<"tool.error", ToolErrorData>;
export type MessageFrame = Frame<"message", MessageData>;

// Error frame
export type ErrorFrame = Frame<
  "error",
  { detail: string; reason?: string; code?: string }
>;

// Union of all server frames
export type ServerFrame =
  | ReadyFrame
  | AttachedFrame
  | SessionUpdatedFrame
  | TurnStartFrame
  | TurnEndFrame
  | AckFrame
  | TextDeltaFrame
  | TextDoneFrame
  | ToolStartFrame
  | ToolDeltaFrame
  | ToolDoneFrame
  | ToolErrorFrame
  | MessageFrame
  | ErrorFrame;

// ─── Upstream Frames (client → server) ──────────────────────────────

export type SessionNewFrame = Frame<"session.new", Record<string, never>>;

export type SessionAttachFrame = Frame<"session.attach", { chat_id: string }>;

export type ChatSendFrame = Frame<
  "chat.send",
  {
    chat_id: string;
    text: string;
    media?: MediaItem[];
    webui?: boolean;
    model?: string;
    provider?: string;
  }
>;

export type ClientFrame = SessionNewFrame | SessionAttachFrame | ChatSendFrame;

// ─── Helper to generate frame ID ────────────────────────────────────

export function generateFrameId(): string {
  return crypto.randomUUID().slice(0, 12);
}

// ─── Frame type guards ──────────────────────────────────────────────

export function isServerFrame(frame: unknown): frame is ServerFrame {
  return (
    typeof frame === "object" &&
    frame !== null &&
    "id" in frame &&
    "type" in frame &&
    "data" in frame
  );
}

export function getFrameType(frame: Frame): string {
  return frame.type;
}
