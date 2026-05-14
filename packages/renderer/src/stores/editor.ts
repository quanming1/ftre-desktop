/**
 * Editor Store — Renderer 端实现
 *
 * 使用 @ftre/editor 包提供的 store 核心逻辑，
 * 通过 Zustand 包装并注册宿主接口。
 */

import { create } from "zustand";
import {
  createEditorActions,
  createInitialEditorState,
  registerEditorStoreHost,
  type EditorStore,
  type EditorStoreHost,
  type OpenFile,
  type DiffEntry,
  type EditorGroup,
  type EditorSnapshot,
  type EditorInputType,
  buildDiffId,
  buildDiffTabPath,
  SETTINGS_PATH,
  _resetGroupCounter,
} from "@ftre/editor";

// Re-export types and utils for backward compatibility
export type { OpenFile, DiffEntry, EditorGroup, EditorSnapshot, EditorInputType };
export { buildDiffId, buildDiffTabPath, SETTINGS_PATH, _resetGroupCounter };

// ── Host Implementation ──────────────────────────────────────────────

const editorStoreHost: EditorStoreHost = {
  readFile: (path) => window.desktop.fs.readFile(path),
  writeFile: (path, content) => window.desktop.fs.writeFile(path, content),
  storageGet: (key) => localStorage.getItem(key),
  storageSet: (key, value) => localStorage.setItem(key, value),
};

// Register host immediately
registerEditorStoreHost(editorStoreHost);

// ── Zustand Store ────────────────────────────────────────────────────

export const useEditor = create<EditorStore>((set, get) => ({
  ...createInitialEditorState(),
  ...createEditorActions(set, get),
}));

// Auto-persist when groups, activeGroupId, or recentFiles change
useEditor.subscribe((state, prev) => {
  if (
    state.groups !== prev.groups ||
    state.activeGroupId !== prev.activeGroupId ||
    state.recentFiles !== prev.recentFiles
  ) {
    state.persist();
  }
});

// ── Selector Hooks ───────────────────────────────────────────────────

/** 当前活跃文件路径 */
export const useActiveFile = () => useEditor((s) => s.activeFile);

/** 当前活跃文件的元数据 */
export const useActiveFileMeta = () =>
  useEditor((s) => {
    const group = s.groups.find((g) => g.id === s.activeGroupId);
    if (!group?.activeFile) return null;
    return group.openFiles.find((f) => f.path === group.activeFile) ?? null;
  });

/** pendingDiffs 列表 */
export const usePendingDiffs = () => useEditor((s) => s.pendingDiffs);
