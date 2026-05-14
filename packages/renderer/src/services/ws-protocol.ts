/**
 * WebSocket Protocol v5 — Type Definitions
 *
 * All server→client messages share the same envelope:
 *   { id: string, role: string, data: object, metadata?: object }
 *
 * Roles:
 *   Persistent (stored): user, assistant, tool_call, tool_result, system
 *   Ephemeral (not stored): assistant.delta, tool_call.delta, control
 */

// ─── Message Envelope ───────────────────────────────────────────────

export interface ServerMessage<D = Record<string, unknown>> {
  id: string;
  role: string;
  data: D;
  metadata?: {
    ephemeral?: boolean;
    chat_id?: string;
    model?: string;
    [key: string]: unknown;
  };
}

// ─── Data Types per Role ────────────────────────────────────────────

/** role: "user" */
export interface UserData {
  content: string | ContentBlock[];
  media?: string[];
  media_urls?: MediaUrl[];
  timestamp: string;
}

/** role: "assistant" — complete response (after streaming ends) */
export interface AssistantData {
  content: string | null;
  reasoning?: string;
  thinking_blocks?: Array<{ type: string; thinking?: string }>;
  timestamp: string;
}

/** role: "assistant.delta" — streaming increment (ephemeral) */
export interface AssistantDeltaData {
  delta: string;
  seq: number;
  content: string; // accumulated full content
}

/** role: "tool_call" — model decides to call tools */
export interface ToolCallData {
  calls: ToolCallItem[];
  content?: string | null; // optional text before calling
  timestamp: string;
}

export interface ToolCallItem {
  call_id: string;
  name: string;
  arguments: Record<string, unknown>; // already parsed object
}

/** role: "tool_call.delta" — streaming tool arguments (ephemeral) */
export interface ToolCallDeltaData {
  call_id: string;
  name?: string; // tool name (present on first delta)
  delta: string; // JSON fragment of arguments
}

/** role: "tool_result" — tool execution result */
export interface ToolResultData {
  call_id: string;
  name: string;
  output: string | null; // result on success
  error?: string; // present on failure
  files?: unknown[];
  embeds?: unknown[];
  timestamp: string;
}

/** role: "system" */
export interface SystemData {
  content: string;
  timestamp?: string;
}

/** role: "control" — ephemeral control signals */
export interface ControlData {
  event: string;
  chat_id?: string;
  client_id?: string;
  protocol?: string;
  ref_id?: string;
  detail?: string;
  reason?: string;
  code?: string;
  [key: string]: unknown;
}

// ─── Helpers ────────────────────────────────────────────────────────

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface MediaUrl {
  url: string;
  name: string;
}

export interface MediaItem {
  data_url: string;
  name?: string;
}

// ─── Upstream Frames (client → server, unchanged) ───────────────────

export interface Frame<T extends string = string, D = Record<string, unknown>> {
  id: string;
  type: T;
  data: D;
}

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

// ─── Utilities ──────────────────────────────────────────────────────

export function generateFrameId(): string {
  return crypto.randomUUID().slice(0, 12);
}

/** Validate that a parsed object is a v5 server message */
export function isServerMessage(msg: unknown): msg is ServerMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "id" in msg &&
    "role" in msg &&
    "data" in msg
  );
}
