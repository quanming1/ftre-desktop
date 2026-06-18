export type MessageRole = "user" | "assistant" | "tool" | "system";

export interface SkillRefData {
  id: string;
  name: string;
}

export interface EmailPartData {
  from_name: string;
  from_agent_id: string;
  subject: string;
  content: string;
  room_id: string;
  timestamp: number;
}

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "email"; data: EmailPartData }
  | { type: "skill"; data: string }
  | {
      type: "image";
      data: {
        url: string;
        name?: string;
        mime?: string;
        bytes?: number;
      };
    };

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  streaming?: boolean;
  parts?: MessagePart[];
  diffMeta?: DiffMeta;
  metadata?: {
    archive_id?: string;
    [key: string]: unknown;
  };
}

export interface ToolCallMessage {
  id: string;
  role: "tool";
  toolId: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  status: "streaming" | "running" | "completed" | "error" | "cancelled";
}

export interface ActionButtonMessage {
  id: string;
  role: "action_button";
  label: string;
  step: string;
  summary: string;
}

export interface DiffFileSummary {
  file: string;
  additions: number;
  deletions: number;
}

export interface DiffMeta {
  base_hash: string;
  final_hash: string;
  workspace: string;
}

export type AnyMessage = ChatMessage | ToolCallMessage | ActionButtonMessage;

export function isToolCall(msg: AnyMessage): msg is ToolCallMessage {
  return "toolId" in msg;
}

export function isActionButton(msg: AnyMessage): msg is ActionButtonMessage {
  return msg.role === "action_button";
}
