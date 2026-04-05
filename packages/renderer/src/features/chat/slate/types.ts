/**
 * Slate 自定义类型定义
 *
 * 所有自定义 Element / Text 类型集中在此，
 * 新增 element 类型时只需在这里加类型 + 更新 CustomElement union。
 */
import type { BaseEditor, Descendant } from "slate";
import type { ReactEditor } from "slate-react";
import type { HistoryEditor } from "slate-history";

// ── 业务数据 ──

export interface CodeRef {
  filePath: string;
  fileName: string;
  startLine: number;
  endLine: number;
  content: string;
}

// ── Archive 业务数据 ──

export interface ArchiveRef {
  id: string;
  summary: string;
  turnCount: number;
  totalMessages: number;
  label?: string;
  createdAt: number;
}

// ── Mention 业务数据（Agent 群聊） ──

export interface MentionRef {
  memberId: string;
  memberName: string;
  color: string;
}

// ── Slate Elements ──

export interface ParagraphElement {
  type: "paragraph";
  children: Descendant[];
}

export interface CodeChipElement {
  type: "code-chip";
  codeRef: CodeRef;
  children: [{ text: "" }];
}

export interface MentionChipElement {
  type: "mention-chip";
  mention: MentionRef;
  children: [{ text: "" }];
}

export interface ArchiveChipElement {
  type: "archive-chip";
  archiveRef: ArchiveRef;
  children: [{ text: "" }];
}

// 新增 element 类型时在这里扩展 union
export type CustomElement =
  | ParagraphElement
  | CodeChipElement
  | MentionChipElement
  | ArchiveChipElement;

export type CustomText = { text: string };

// ── Slate 类型增强 ──

declare module "slate" {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}
