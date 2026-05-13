/**
 * WebSocket Protocol v3 Type Definitions
 *
 * Based on: ai-base WebSocket Channel Protocol v3
 * All frames follow the uniform envelope: { id, type, data }
 * All messages use the unified `chat.unified` frame type.
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

// ─── Unified Message Types ──────────────────────────────────────────

/** Stream state for streaming messages */
export interface StreamState {
  id: string;
  seq: number;
  delta: string;
  offset: number;
  status: "streaming" | "complete";
}

/** Tool call in OpenAI format */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** Tool event for real-time UI updates */
export interface ToolEvent {
  type: "tool_start" | "tool_end" | "tool_error" | "tool_args_delta";
  call_id: string;
  name?: string;
  phase?: "start" | "ready";
  arguments?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  delta?: string; // Only for tool_args_delta
}

/** Unified message data (used in chat.unified frames) */
export interface UnifiedMessage {
  id: string;
  chat_id: string;
  role: Role;
  content: string | null;
  timestamp: string;
  stream?: StreamState;
  // Tool events for real-time UI updates
  tool_events?: ToolEvent[];
  // Tool calls (OpenAI format, for storage/history)
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  media?: string[];
  // Extended thinking / reasoning (DeepSeek-R1, Kimi-K2, etc.)
  reasoning_content?: string;
  // Anthropic thinking blocks
  thinking_blocks?: Array<{ type: string; thinking?: string }>;
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

// Unified message frame (all messages use this type in v3)
export type UnifiedFrame = Frame<"chat.unified", UnifiedMessage>;

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
  | UnifiedFrame
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
