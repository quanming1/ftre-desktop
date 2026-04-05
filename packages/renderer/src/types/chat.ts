export type MessageRole = "user" | "assistant" | "tool" | "system";

export interface CodeRef {
  filePath: string;
  fileName: string;
  startLine: number;
  endLine: number;
  content: string;
}

/** 归档引用数据 */
export interface ArchiveRefData {
  id: string;
  /** 显示文本（label || summary，仅用于前端展示） */
  display: string;
}

/** 邮件消息数据 */
export interface EmailPartData {
  /** 发送者显示名（如 "Web前端负责人"） */
  from_name: string;
  /** 发送者的 agent 定义 ID（如 "omni-flow-web"） */
  from_agent_id: string;
  /** 邮件主题 */
  subject: string;
  /** 邮件正文 */
  content: string;
  /** 邮件线程 ID（用于查看完整线程） */
  room_id: string;
  /** 发送时间戳（秒） */
  timestamp: number;
}

/**
 * 消息部分 — 前后端统一的 parts 协议
 *
 * - text:     纯文本段
 * - code_ref: 代码引用段（文件 + 行号 + 代码内容）
 * - email:    邮件消息段（发件人 + 主题 + 正文 + 线程 ID）
 */
export type MessagePart =
  | { type: "text"; data: string }
  | {
      type: "code_ref";
      data: {
        path: string;
        lines: [number, number];
        raw: string;
        name: string;
      };
    }
  | { type: "email"; data: EmailPartData }
  | { type: "archive_ref"; data: ArchiveRefData };

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  /** 是否正在流式输出中 */
  streaming?: boolean;
  /** 附带的代码引用 */
  codeRefs?: CodeRef[];
  /** 结构化消息部分（用于渲染 inline chips） */
  parts?: MessagePart[];
  /** 本轮对话的文件变更摘要（仅 user 消息） */
  diffMeta?: DiffMeta;
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
  files: DiffFileSummary[];
  total_additions: number;
  total_deletions: number;
  total_files: number;
}

export type AnyMessage = ChatMessage | ToolCallMessage | ActionButtonMessage;

export function isToolCall(msg: AnyMessage): msg is ToolCallMessage {
  return "toolId" in msg;
}

export function isActionButton(msg: AnyMessage): msg is ActionButtonMessage {
  return msg.role === "action_button";
}
