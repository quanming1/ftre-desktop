/**
 * Editor Store 类型定义
 */

export interface OpenFile {
  path: string;
  name: string;
  language: string;
  content: string;
  modified: boolean;
  pinned: boolean;
  loaded: boolean;
}

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
