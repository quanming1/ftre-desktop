/**
 * Editor Store 类型定义
 */

/**
 * EditorInput 类型 - 参考 VSCode 的 EditorInput 设计
 * 'file' - 普通文件编辑器
 * 'settings' - 设置面板
 * 'diff' - Diff 视图（已有，通过 diff: 前缀区分）
 */
export type EditorInputType = "file" | "settings";

export interface OpenFile {
  path: string;
  name: string;
  language: string;
  content: string;
  modified: boolean;
  pinned: boolean;
  loaded: boolean;
  /** EditorInput 类型，默认为 'file' */
  type?: EditorInputType;
}

/** Settings 虚拟路径常量 */
export const SETTINGS_PATH = "ftre://settings";

export interface DiffEntry {
  id: string;
  filePath: string;
  tabPath: string;
  originalContent: string;
  newContent: string;
  toolName: string;
  isApproximate: boolean;
}

export interface EditorGroup {
  id: string;
  openFiles: OpenFile[];
  activeFile: string | null;
}

export interface EditorSnapshot {
  groups: EditorGroup[];
  activeGroupId: string;
  recentFiles: string[];
  pendingDiffs: DiffEntry[];
}

export function buildDiffId(toolId: string, filePath: string): string {
  return `${toolId}:${filePath}`;
}

export function buildDiffTabPath(filePath: string): string {
  return `diff:${filePath}`;
}
