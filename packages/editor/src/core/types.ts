/**
 * Core Types — 编辑器核心类型定义
 */

import type { editor } from "monaco-editor";

/** Document 状态机 */
export type DocState = "idle" | "loaded" | "hibernated";

/** 文件原始格式元数据（用于保存时恢复） */
export interface FileMetadata {
  /** 原始行尾符风格 */
  lineEnding: "lf" | "crlf" | "mixed";
  /** 是否有 BOM 头 */
  hasBom: boolean;
  /** 文件编码（暂时只支持 utf-8） */
  encoding: "utf-8";
}

/** Monaco 视图状态 */
export type ViewState = editor.ICodeEditorViewState;

/** 内容哈希函数类型 */
export type HashFn = (content: string) => string;
