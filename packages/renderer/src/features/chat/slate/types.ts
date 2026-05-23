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

// ── Skill 业务数据 ──

export interface SkillRef {
  id: string;
  name: string;
  description: string;
}

// ── Image 业务数据 ──

export interface ImageRef {
  /** 本地随机 id（用于 React key、删除定位） */
  id: string;
  /** MIME，限定 image/* 子集 */
  mimeType: string;
  /** 纯 base64（不带 data: 前缀） */
  base64: string;
  /** 原始文件名，仅展示 */
  name?: string;
  /** 解码后字节数（用于尺寸提示） */
  bytes: number;
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

export interface SkillChipElement {
  type: "skill-chip";
  skillRef: SkillRef;
  children: [{ text: "" }];
}

// 新增 element 类型时在这里扩展 union
export type CustomElement =
  | ParagraphElement
  | CodeChipElement
  | MentionChipElement
  | ArchiveChipElement
  | SkillChipElement;

export type CustomText = { text: string };

// ── Slate 类型增强 ──

declare module "slate" {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}
