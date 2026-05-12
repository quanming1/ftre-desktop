/**
 * WebSocket Protocol v2 Type Definitions
 *
 * Based on: ai-base WebSocket Channel Protocol
 * All frames follow the uniform envelope: { id, type, data }
 */

// ─── Base Types ─────────────────────────────────────────────────────

export type Role = "assistant" | "user" | "system";

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

// ─── Downstream Frames (server → client) ────────────────────────────

// Session / control frames
export type ReadyFrame = Frame<
  "session.ready",
  { chat_id: string; client_id: string; protocol: "v2" }
>;

export type AttachedFrame = Frame<"session.attached", { chat_id: string }>;

export type SessionUpdatedFrame = Frame<
  "session.updated",
  { chat_id: string }
>;

export type TurnStartFrame = Frame<"turn.start", { chat_id: string }>;

export type TurnEndFrame = Frame<"turn.end", { chat_id: string }>;

export type AckFrame = Frame<
  "chat.ack",
  { chat_id: string; ref_id: string }
>;

// Chat content frames
export type MessageFrame = Frame<
  "chat.message",
  {
    chat_id: string;
    role: Role;
    text: string;
    media_urls?: MediaUrl[];
    buttons?: string[][];
    button_prompt?: string;
    reply_to?: string;
  }
>;

export type DeltaFrame = Frame<
  "chat.delta",
  {
    chat_id: string;
    role: Role;
    text: string;
    stream_id: string;
  }
>;

export type DeltaEndFrame = Frame<
  "chat.delta_end",
  { chat_id: string; stream_id: string }
>;

export type ProgressFrame = Frame<
  "chat.progress",
  { chat_id: string; text: string }
>;

export type ToolUseFrame = Frame<
  "chat.tool_use",
  {
    chat_id: string;
    call_id: string;
    name: string;
    /** "start" = LLM just announced the call, args still streaming in.
     *  "ready" = args complete, tool is about to execute. */
    phase: "start" | "ready";
    /** Only present when phase === "ready" */
    arguments?: Record<string, unknown>;
  }
>;

export type ToolArgsDeltaFrame = Frame<
  "chat.tool_args_delta",
  {
    chat_id: string;
    call_id: string;
    /** Incremental JSON fragment of the arguments string */
    delta: string;
  }
>;

export type ToolResultFrame = Frame<
  "chat.tool_result",
  {
    chat_id: string;
    call_id: string;
    name: string;
    status: "ok" | "error";
    result?: unknown;
    error?: string;
    files?: unknown[];
    embeds?: unknown[];
  }
>;

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
  | MessageFrame
  | DeltaFrame
  | DeltaEndFrame
  | ProgressFrame
  | ToolUseFrame
  | ToolArgsDeltaFrame
  | ToolResultFrame
  | ErrorFrame;

// ─── Upstream Frames (client → server) ──────────────────────────────

export type SessionNewFrame = Frame<"session.new", Record<string, never>>;

export type SessionAttachFrame = Frame<
  "session.attach",
  { chat_id: string }
>;

export type ChatSendFrame = Frame<
  "chat.send",
  {
    chat_id: string;
    text: string;
    media?: MediaItem[];
    webui?: boolean;
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
