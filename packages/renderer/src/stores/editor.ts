import { create } from "zustand";
import { workspaceHash } from "@/utils/pathUtils";
import { editorCore } from "@/features/editor/core/editor-core";

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

export function buildDiffId(toolId: string, filePath: string): string {
  return `${toolId}:${filePath}`;
}

export function buildDiffTabPath(filePath: string): string {
  return `diff:${filePath}`;
}

export interface EditorGroup {
  id: string;
  openFiles: OpenFile[];
  activeFile: string | null;
}

const DEFAULT_GROUP_ID = "default";
const MAX_RECENT_FILES = 20;
const EDITOR_KEY_PREFIX = "ftre-editor-state";
const EDITOR_PERSIST_DEBOUNCE_MS = 500;
let editorPersistTimer: ReturnType<typeof setTimeout> | null = null;

/** 当前持久化使用的 workspace 路径（由 persist/restore 时设置） */
let currentPersistWorkspace: string | null = null;

/** 按工作区隔离的 localStorage key */
function editorStorageKey(ws?: string | null): string {
  const root = ws ?? currentPersistWorkspace;
  return root
    ? `${EDITOR_KEY_PREFIX}:${workspaceHash(root)}`
    : EDITOR_KEY_PREFIX;
}

/** 工作区内存快照 —— 切换时挂起/恢复 */
export interface EditorSnapshot {
  groups: EditorGroup[];
  activeGroupId: string;
  recentFiles: string[];
  pendingDiffs: DiffEntry[];
}

const workspaceSnapshots = new Map<string, EditorSnapshot>();

/** Lightweight metadata saved to localStorage (no file content) */
interface PersistedFileMeta {
  path: string;
  name: string;
  language: string;
  pinned: boolean;
}

interface PersistedEditorData {
  groups: Array<{
    id: string;
    openFiles: PersistedFileMeta[];
    activeFile: string | null;
  }>;
  activeGroupId: string;
  recentFiles: string[];
}

function createDefaultGroup(): EditorGroup {
  return { id: DEFAULT_GROUP_ID, openFiles: [], activeFile: null };
}

let groupCounter = 0;
function generateGroupId(): string {
  groupCounter += 1;
  return `group-${groupCounter}`;
}

/** Reset the group counter — only for testing */
export function _resetGroupCounter(): void {
  groupCounter = 0;
}

interface EditorState {
  // Backward-compatible top-level accessors (delegate to active group)
  openFiles: OpenFile[];
  activeFile: string | null;
  pendingDiffs: DiffEntry[];

  // EditorGroup support
  groups: EditorGroup[];
  activeGroupId: string;
  recentFiles: string[];

  // Existing actions (operate on active group)
  openFile: (
    file: Omit<OpenFile, "modified" | "pinned" | "loaded"> & {
      loaded?: boolean;
    },
  ) => void;
  closeFile: (path: string) => void;
  setActive: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  markSaved: (path: string) => void;
  refreshFile: (path: string, newContent: string) => void;
  hydrateFileContent: (
    path: string,
    newContent: string,
    language?: string,
  ) => void;
  addDiff: (diff: DiffEntry) => void;
  acceptDiff: (filePath: string) => void;
  rejectDiff: (filePath: string) => void;

  // New actions
  splitEditor: () => void;
  closeGroup: (groupId: string) => void;
  setActiveGroup: (groupId: string) => void;
  moveTabToGroup: (
    filePath: string,
    fromGroupId: string,
    toGroupId: string,
  ) => void;
  reorderTabs: (groupId: string, fromIndex: number, toIndex: number) => void;
  addRecentFile: (path: string) => void;
  removeRecentFile: (path: string) => void;
  handleFileRenamed: (oldPath: string, newPath: string, isDir: boolean) => void;
  handleFileDeleted: (deletedPath: string, isDir: boolean) => void;
  createUntitledFile: () => void;
  /** Close all files across all groups, reset to single default group */
  closeAllFiles: () => void;
  /** Check if any file across all groups has unsaved changes */
  hasUnsavedChanges: () => boolean;
  /** 精准更新文件 modified 标志（不重建整个 groups） */
  setModified: (path: string, modified: boolean) => void;
  /** Update the language of an open file (Spec: change_language_mode) */
  setFileLanguage: (path: string, language: string) => void;
  /** Close all files except the one at `path` in the active group */
  closeOtherFiles: (path: string) => void;
  /** Close all files to the right of `path` in the active group */
  closeFilesToRight: (path: string) => void;
  /** Close all unmodified files in the active group */
  closeSavedFiles: () => void;
  /** Pin a tab in the active group */
  pinFile: (path: string) => void;
  /** Unpin a tab in the active group */
  unpinFile: (path: string) => void;
  /** Persist open files metadata to localStorage */
  persist: () => void;
  /** Restore open files from localStorage and reload content via IPC */
  restore: (workspace?: string | null) => Promise<void>;
  /** 将当前编辑器状态保存为内存快照（切换工作区时调用） */
  suspendForWorkspace: (workspace: string) => void;
  /** 从内存快照恢复编辑器状态（切换回工作区时调用） */
  resumeForWorkspace: (workspace: string) => Promise<void>;
}

// ── helpers ──────────────────────────────────────────────────────────

function getActiveGroup(state: EditorState): EditorGroup {
  return (
    state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  );
}

function updateGroup(
  groups: EditorGroup[],
  groupId: string,
  updater: (g: EditorGroup) => EditorGroup,
): EditorGroup[] {
  return groups.map((g) => (g.id === groupId ? updater(g) : g));
}

/** Sync top-level openFiles/activeFile from the active group */
function syncTopLevel(groups: EditorGroup[], activeGroupId: string) {
  const active = groups.find((g) => g.id === activeGroupId) ?? groups[0];
  return { openFiles: active.openFiles, activeFile: active.activeFile };
}

// ── store ────────────────────────────────────────────────────────────

export const useEditor = create<EditorState>((set, get) => ({
  // Initial state
  groups: [createDefaultGroup()],
  activeGroupId: DEFAULT_GROUP_ID,
  recentFiles: [],
  openFiles: [],
  activeFile: null,
  pendingDiffs: [],

  // ── existing actions (backward-compatible, operate on active group) ──

  openFile: (file) => {
    const state = get();
    const group = getActiveGroup(state);

    const exists = group.openFiles.find((f) => f.path === file.path);
    if (exists) {
      const groups = updateGroup(state.groups, group.id, (g) => ({
        ...g,
        activeFile: file.path,
      }));
      set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
      return;
    }

    const newFile: OpenFile = {
      ...file,
      modified: false,
      pinned: false,
      loaded: file.loaded ?? true,
    };
    const groups = updateGroup(state.groups, group.id, (g) => ({
      ...g,
      openFiles: [...g.openFiles, newFile],
      activeFile: file.path,
    }));
    set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
  },

  closeFile: (path) => {
    const state = get();
    const group = getActiveGroup(state);
    const filtered = group.openFiles.filter((f) => f.path !== path);

    let newActive = group.activeFile;
    if (group.activeFile === path) {
      const idx = group.openFiles.findIndex((f) => f.path === path);
      newActive = filtered[Math.min(idx, filtered.length - 1)]?.path ?? null;
    }

    const groups = updateGroup(state.groups, group.id, (g) => ({
      ...g,
      openFiles: filtered,
      activeFile: newActive,
    }));
    set({
      groups,
      ...syncTopLevel(groups, state.activeGroupId),
      pendingDiffs: state.pendingDiffs.filter(
        (d) => d.filePath !== path && d.tabPath !== path,
      ),
    });

    // 清理 editorCore（仅当没有其他 group 还打开此文件时）
    const stillOpen = groups.some((g) =>
      g.openFiles.some((f) => f.path === path),
    );
    if (!stillOpen) {
      editorCore.removeContent(path);
      editorCore.removeViewState(path);
    }
  },

  setActive: (path) => {
    const state = get();
    const group = getActiveGroup(state);
    const groups = updateGroup(state.groups, group.id, (g) => ({
      ...g,
      activeFile: path,
    }));
    set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
  },

  updateContent: (path, content) => {
    const state = get();
    const group = getActiveGroup(state);
    const groups = updateGroup(state.groups, group.id, (g) => ({
      ...g,
      openFiles: g.openFiles.map((f) =>
        f.path === path ? { ...f, content, modified: true } : f,
      ),
    }));
    set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
  },

  markSaved: (path) => {
    const state = get();
    const group = getActiveGroup(state);
    // 只在当前状态是 modified 时才更新，避免无意义 set
    const file = group.openFiles.find((f) => f.path === path);
    if (!file || !file.modified) return;
    const groups = updateGroup(state.groups, group.id, (g) => ({
      ...g,
      openFiles: g.openFiles.map((f) =>
        f.path === path ? { ...f, modified: false } : f,
      ),
    }));
    set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
  },

  setModified: (path, modified) => {
    const state = get();
    const group = getActiveGroup(state);
    const file = group.openFiles.find((f) => f.path === path);
    if (!file || file.modified === modified) return; // 值没变就不 set
    const groups = updateGroup(state.groups, group.id, (g) => ({
      ...g,
      openFiles: g.openFiles.map((f) =>
        f.path === path ? { ...f, modified } : f,
      ),
    }));
    set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
  },

  refreshFile: (path, newContent) => {
    const state = get();
    const exists = state.groups.some((g) =>
      g.openFiles.some((f) => f.path === path),
    );
    if (!exists) return;

    editorCore.setContent(path, newContent);
    editorCore.setDiskContent(path, newContent);
    editorCore.pushContentToEditor(path, newContent);

    const groups = state.groups.map((g) => ({
      ...g,
      openFiles: g.openFiles.map((f) =>
        f.path === path
          ? { ...f, content: newContent, modified: false, loaded: true }
          : f,
      ),
    }));
    set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
  },

  hydrateFileContent: (path, newContent, language) => {
    const state = get();
    const exists = state.groups.some((g) =>
      g.openFiles.some((f) => f.path === path),
    );
    if (!exists) return;

    editorCore.setContent(path, newContent);
    editorCore.setDiskContent(path, newContent);
    editorCore.pushContentToEditor(path, newContent);

    const groups = state.groups.map((g) => ({
      ...g,
      openFiles: g.openFiles.map((f) =>
        f.path === path
          ? {
              ...f,
              content: newContent,
              language: language || f.language,
              modified: false,
              loaded: true,
            }
          : f,
      ),
    }));
    set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
  },

  addDiff: (diff) => {
    // 1. 更新 pendingDiffs — 始终用最新内容替换（不做 id 幂等跳过）
    const { pendingDiffs } = get();
    const existingIdx = pendingDiffs.findIndex(
      (d) => d.filePath === diff.filePath,
    );
    if (existingIdx !== -1) {
      const updated = [...pendingDiffs];
      updated[existingIdx] = diff;
      set({ pendingDiffs: updated });
    } else {
      set({ pendingDiffs: [...pendingDiffs, diff] });
    }

    // 2. 确保 diff 虚拟 tab 存在并激活 — 用最新 state
    const freshState = get();
    const group = getActiveGroup(freshState);
    const tabExists = group.openFiles.some((f) => f.path === diff.tabPath);
    if (!tabExists) {
      const fileName = diff.filePath.split(/[\\/]/).pop() ?? diff.filePath;
      const virtualFile: OpenFile = {
        path: diff.tabPath,
        name: `${fileName} (Diff)`,
        language: "plaintext",
        content: "",
        modified: false,
        pinned: false,
        loaded: true,
      };
      const groups = updateGroup(freshState.groups, group.id, (g) => ({
        ...g,
        openFiles: [...g.openFiles, virtualFile],
        activeFile: diff.tabPath,
      }));
      set({ groups, ...syncTopLevel(groups, freshState.activeGroupId) });
    } else {
      get().setActive(diff.tabPath);
    }
  },

  acceptDiff: (filePath) => {
    const state = get();
    const diff = state.pendingDiffs.find((d) => d.filePath === filePath);
    if (!diff) return;

    // Close the diff virtual tab and refresh the real file tab if open
    const groups = state.groups.map((g) => {
      const filtered = g.openFiles.filter((f) => f.path !== diff.tabPath);
      const hasRealFile = filtered.some((f) => f.path === filePath);
      const updatedFiles = hasRealFile
        ? filtered.map((f) =>
            f.path === filePath
              ? { ...f, content: diff.newContent, modified: false }
              : f,
          )
        : filtered;

      let newActive = g.activeFile;
      if (g.activeFile === diff.tabPath) {
        if (hasRealFile) {
          newActive = filePath;
        } else {
          const idx = g.openFiles.findIndex((f) => f.path === diff.tabPath);
          newActive =
            updatedFiles[Math.min(idx, updatedFiles.length - 1)]?.path ?? null;
        }
      }

      return { ...g, openFiles: updatedFiles, activeFile: newActive };
    });
    set({
      groups,
      ...syncTopLevel(groups, state.activeGroupId),
      pendingDiffs: state.pendingDiffs.filter((d) => d.filePath !== filePath),
    });
    window.desktop.fs.writeFile(filePath, diff.newContent);
  },

  rejectDiff: (filePath) => {
    const state = get();
    const diff = state.pendingDiffs.find((d) => d.filePath === filePath);
    if (!diff) return;

    // Close the diff virtual tab
    const groups = state.groups.map((g) => {
      const filtered = g.openFiles.filter((f) => f.path !== diff.tabPath);

      let newActive = g.activeFile;
      if (g.activeFile === diff.tabPath) {
        const idx = g.openFiles.findIndex((f) => f.path === diff.tabPath);
        newActive = filtered[Math.min(idx, filtered.length - 1)]?.path ?? null;
      }

      return { ...g, openFiles: filtered, activeFile: newActive };
    });
    set({
      groups,
      ...syncTopLevel(groups, state.activeGroupId),
      pendingDiffs: state.pendingDiffs.filter((d) => d.filePath !== filePath),
    });
  },

  // ── new actions ─────────────────────────────────────────────────────

  setActiveGroup: (groupId) => {
    const state = get();
    const exists = state.groups.find((g) => g.id === groupId);
    if (!exists || state.activeGroupId === groupId) return;
    set({
      activeGroupId: groupId,
      ...syncTopLevel(state.groups, groupId),
    });
  },

  splitEditor: () => {
    const state = get();
    const group = getActiveGroup(state);
    if (!group.activeFile) return;

    const activeOpenFile = group.openFiles.find(
      (f) => f.path === group.activeFile,
    );
    if (!activeOpenFile) return;

    const newGroup: EditorGroup = {
      id: generateGroupId(),
      openFiles: [{ ...activeOpenFile }],
      activeFile: activeOpenFile.path,
    };

    const groups = [...state.groups, newGroup];
    set({
      groups,
      activeGroupId: newGroup.id,
      ...syncTopLevel(groups, newGroup.id),
    });
  },

  closeGroup: (groupId) => {
    const state = get();
    // Don't remove the last group
    if (state.groups.length <= 1) return;

    const filtered = state.groups.filter((g) => g.id !== groupId);
    const newActiveGroupId =
      state.activeGroupId === groupId ? filtered[0].id : state.activeGroupId;

    set({
      groups: filtered,
      activeGroupId: newActiveGroupId,
      ...syncTopLevel(filtered, newActiveGroupId),
    });
  },

  moveTabToGroup: (filePath, fromGroupId, toGroupId) => {
    const state = get();
    const fromGroup = state.groups.find((g) => g.id === fromGroupId);
    const toGroup = state.groups.find((g) => g.id === toGroupId);
    if (!fromGroup || !toGroup) return;

    const file = fromGroup.openFiles.find((f) => f.path === filePath);
    if (!file) return;

    // Already exists in target group? Just activate it there
    const existsInTarget = toGroup.openFiles.find((f) => f.path === filePath);

    let groups = state.groups;

    // Remove from source group
    groups = updateGroup(groups, fromGroupId, (g) => {
      const newFiles = g.openFiles.filter((f) => f.path !== filePath);
      let newActive = g.activeFile;
      if (g.activeFile === filePath) {
        const idx = g.openFiles.findIndex((f) => f.path === filePath);
        newActive = newFiles[Math.min(idx, newFiles.length - 1)]?.path ?? null;
      }
      return { ...g, openFiles: newFiles, activeFile: newActive };
    });

    // Add to target group (if not already there)
    if (!existsInTarget) {
      groups = updateGroup(groups, toGroupId, (g) => ({
        ...g,
        openFiles: [...g.openFiles, { ...file }],
        activeFile: filePath,
      }));
    } else {
      groups = updateGroup(groups, toGroupId, (g) => ({
        ...g,
        activeFile: filePath,
      }));
    }

    set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
  },

  reorderTabs: (groupId, fromIndex, toIndex) => {
    const state = get();
    const group = state.groups.find((g) => g.id === groupId);
    if (!group) return;

    const files = [...group.openFiles];
    if (fromIndex < 0 || fromIndex >= files.length) return;
    if (toIndex < 0 || toIndex >= files.length) return;

    const [moved] = files.splice(fromIndex, 1);
    files.splice(toIndex, 0, moved);

    const groups = updateGroup(state.groups, groupId, (g) => ({
      ...g,
      openFiles: files,
    }));
    set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
  },

  addRecentFile: (path) => {
    const state = get();
    const filtered = state.recentFiles.filter((p) => p !== path);
    const updated = [path, ...filtered].slice(0, MAX_RECENT_FILES);
    set({ recentFiles: updated });
  },

  removeRecentFile: (path) => {
    const state = get();
    const filtered = state.recentFiles.filter((p) => p !== path);
    if (filtered.length !== state.recentFiles.length) {
      set({ recentFiles: filtered });
    }
  },

  handleFileRenamed: (oldPath, newPath, isDir) => {
    const state = get();
    const newName = newPath.split(/[\\/]/).pop() ?? newPath;

    // For directories, update all open files whose path starts with oldPath
    // For files, update the exact match
    const matchesPath = (filePath: string) =>
      isDir
        ? filePath.startsWith(oldPath + "/") ||
          filePath.startsWith(oldPath + "\\")
        : filePath === oldPath;

    const updateFilePath = (filePath: string) =>
      isDir ? newPath + filePath.slice(oldPath.length) : newPath;

    const groups = state.groups.map((g) => {
      const hasMatch = g.openFiles.some((f) => matchesPath(f.path));
      if (!hasMatch) return g;

      const updatedFiles = g.openFiles.map((f) => {
        if (!matchesPath(f.path)) return f;
        const updatedPath = updateFilePath(f.path);
        return {
          ...f,
          path: updatedPath,
          name: updatedPath.split(/[\\/]/).pop() ?? updatedPath,
        };
      });

      const updatedActive =
        g.activeFile && matchesPath(g.activeFile)
          ? updateFilePath(g.activeFile)
          : g.activeFile;

      return { ...g, openFiles: updatedFiles, activeFile: updatedActive };
    });

    // Also update pendingDiffs
    const pendingDiffs = state.pendingDiffs.map((d) =>
      matchesPath(d.filePath)
        ? {
            ...d,
            filePath: updateFilePath(d.filePath),
            tabPath: `diff:${updateFilePath(d.filePath)}`,
          }
        : d,
    );

    set({ groups, pendingDiffs, ...syncTopLevel(groups, state.activeGroupId) });

    // 同步迁移 editorCore 中的路径
    if (isDir) {
      editorCore.migratePrefix(oldPath, newPath);
    } else {
      editorCore.migrateKey(oldPath, newPath);
    }
  },

  handleFileDeleted: (deletedPath, isDir) => {
    const state = get();

    const matchesPath = (filePath: string) =>
      isDir
        ? filePath === deletedPath ||
          filePath.startsWith(deletedPath + "/") ||
          filePath.startsWith(deletedPath + "\\")
        : filePath === deletedPath;

    const groups = state.groups.map((g) => {
      const hasMatch = g.openFiles.some((f) => matchesPath(f.path));
      if (!hasMatch) return g;

      const filtered = g.openFiles.filter((f) => !matchesPath(f.path));

      let newActive = g.activeFile;
      if (g.activeFile && matchesPath(g.activeFile)) {
        const idx = g.openFiles.findIndex((f) => f.path === g.activeFile);
        newActive = filtered[Math.min(idx, filtered.length - 1)]?.path ?? null;
      }

      return { ...g, openFiles: filtered, activeFile: newActive };
    });

    const pendingDiffs = state.pendingDiffs.filter(
      (d) => !matchesPath(d.filePath) && !matchesPath(d.tabPath),
    );

    // 收集被删除的文件路径，用于清理 editorCore
    const deletedFilePaths = new Set<string>();
    for (const g of state.groups) {
      for (const f of g.openFiles) {
        if (matchesPath(f.path)) deletedFilePaths.add(f.path);
      }
    }

    set({ groups, pendingDiffs, ...syncTopLevel(groups, state.activeGroupId) });

    // 清理 editorCore（仅清理没有在更新后的 groups 中打开的文件）
    for (const deletedFilePath of deletedFilePaths) {
      const stillOpen = groups.some((g) =>
        g.openFiles.some((f) => f.path === deletedFilePath),
      );
      if (!stillOpen) {
        editorCore.removeContent(deletedFilePath);
        editorCore.removeViewState(deletedFilePath);
      }
    }
  },

  createUntitledFile: () => {
    const state = get();
    const group = getActiveGroup(state);

    // Find the max Untitled number across all groups
    let maxNum = 0;
    for (const g of state.groups) {
      for (const f of g.openFiles) {
        const match = f.name.match(/^Untitled-(\d+)$/);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      }
    }

    const num = maxNum + 1;
    const name = `Untitled-${num}`;
    const path = `untitled:${name}`;
    const newFile: OpenFile = {
      path,
      name,
      language: "plaintext",
      content: "",
      modified: false,
      pinned: false,
      loaded: true,
    };

    const groups = updateGroup(state.groups, group.id, (g) => ({
      ...g,
      openFiles: [...g.openFiles, newFile],
      activeFile: path,
    }));
    set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
  },

  closeAllFiles: () => {
    const defaultGroup = createDefaultGroup();
    set({
      groups: [defaultGroup],
      activeGroupId: DEFAULT_GROUP_ID,
      openFiles: [],
      activeFile: null,
      pendingDiffs: [],
    });
    // 清理全部 editorCore 内存数据
    editorCore.clearAll();
  },

  hasUnsavedChanges: () => {
    const state = get();
    for (const group of state.groups) {
      for (const f of group.openFiles) {
        if (f.modified) return true;
      }
    }
    return false;
  },

  setFileLanguage: (path, language) => {
    const state = get();
    const newGroups = state.groups.map((g) => ({
      ...g,
      openFiles: g.openFiles.map((f) =>
        f.path === path ? { ...f, language } : f,
      ),
    }));
    set({ groups: newGroups, ...syncTopLevel(newGroups, state.activeGroupId) });
  },

  closeOtherFiles: (path) => {
    const state = get();
    const group = getActiveGroup(state);
    const kept = group.openFiles.filter((f) => f.path === path || f.pinned);
    const removedPaths = new Set(
      group.openFiles
        .filter((f) => f.path !== path && !f.pinned)
        .map((f) => f.path),
    );

    const groups = updateGroup(state.groups, group.id, (g) => ({
      ...g,
      openFiles: kept,
      activeFile: kept.length > 0 ? path : null,
    }));
    set({
      groups,
      ...syncTopLevel(groups, state.activeGroupId),
      pendingDiffs: state.pendingDiffs.filter(
        (d) => !removedPaths.has(d.filePath) && !removedPaths.has(d.tabPath),
      ),
    });

    // 清理 editorCore（仅清理没有在其他 group 打开的文件）
    for (const removedPath of removedPaths) {
      const stillOpen = groups.some((g) =>
        g.openFiles.some((f) => f.path === removedPath),
      );
      if (!stillOpen) {
        editorCore.removeContent(removedPath);
        editorCore.removeViewState(removedPath);
      }
    }
  },

  closeFilesToRight: (path) => {
    const state = get();
    const group = getActiveGroup(state);
    const idx = group.openFiles.findIndex((f) => f.path === path);
    if (idx === -1) return;

    const kept = group.openFiles.filter((f, i) => i <= idx || f.pinned);
    const removedPaths = new Set(
      group.openFiles.filter((f, i) => i > idx && !f.pinned).map((f) => f.path),
    );

    let newActive = group.activeFile;
    if (newActive && removedPaths.has(newActive)) {
      newActive = path;
    }

    const groups = updateGroup(state.groups, group.id, (g) => ({
      ...g,
      openFiles: kept,
      activeFile: newActive,
    }));
    set({
      groups,
      ...syncTopLevel(groups, state.activeGroupId),
      pendingDiffs: state.pendingDiffs.filter(
        (d) => !removedPaths.has(d.filePath) && !removedPaths.has(d.tabPath),
      ),
    });

    // 清理 editorCore（仅清理没有在其他 group 打开的文件）
    for (const removedPath of removedPaths) {
      const stillOpen = groups.some((g) =>
        g.openFiles.some((f) => f.path === removedPath),
      );
      if (!stillOpen) {
        editorCore.removeContent(removedPath);
        editorCore.removeViewState(removedPath);
      }
    }
  },

  closeSavedFiles: () => {
    const state = get();
    const group = getActiveGroup(state);
    const kept = group.openFiles.filter((f) => f.modified || f.pinned);
    const removedPaths = new Set(
      group.openFiles
        .filter((f) => !f.modified && !f.pinned)
        .map((f) => f.path),
    );

    let newActive = group.activeFile;
    if (newActive && removedPaths.has(newActive)) {
      const idx = group.openFiles.findIndex((f) => f.path === newActive);
      newActive = kept[Math.min(idx, kept.length - 1)]?.path ?? null;
    }

    const groups = updateGroup(state.groups, group.id, (g) => ({
      ...g,
      openFiles: kept,
      activeFile: newActive,
    }));
    set({
      groups,
      ...syncTopLevel(groups, state.activeGroupId),
      pendingDiffs: state.pendingDiffs.filter(
        (d) => !removedPaths.has(d.filePath) && !removedPaths.has(d.tabPath),
      ),
    });

    // 清理 editorCore（仅清理没有在其他 group 打开的文件）
    for (const removedPath of removedPaths) {
      const stillOpen = groups.some((g) =>
        g.openFiles.some((f) => f.path === removedPath),
      );
      if (!stillOpen) {
        editorCore.removeContent(removedPath);
        editorCore.removeViewState(removedPath);
      }
    }
  },

  pinFile: (path) => {
    const state = get();
    const group = getActiveGroup(state);
    const idx = group.openFiles.findIndex((f) => f.path === path);
    if (idx === -1) return;

    const file = { ...group.openFiles[idx], pinned: true };
    const others = group.openFiles.filter((_, i) => i !== idx);
    const lastPinnedIdx = others.reduce(
      (acc, f, i) => (f.pinned ? i : acc),
      -1,
    );
    const newFiles = [...others];
    newFiles.splice(lastPinnedIdx + 1, 0, file);

    const groups = updateGroup(state.groups, group.id, (g) => ({
      ...g,
      openFiles: newFiles,
    }));
    set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
  },

  unpinFile: (path) => {
    const state = get();
    const group = getActiveGroup(state);
    const groups = updateGroup(state.groups, group.id, (g) => ({
      ...g,
      openFiles: g.openFiles.map((f) =>
        f.path === path ? { ...f, pinned: false } : f,
      ),
    }));
    set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
  },

  persist: () => {
    if (editorPersistTimer) clearTimeout(editorPersistTimer);
    editorPersistTimer = setTimeout(() => {
      try {
        const state = get();
        const data: PersistedEditorData = {
          groups: state.groups.map((g) => ({
            id: g.id,
            openFiles: g.openFiles
              // Skip diff virtual tabs and untitled files
              .filter(
                (f) =>
                  !f.path.startsWith("diff:") &&
                  !f.path.startsWith("untitled:"),
              )
              .map((f) => ({
                path: f.path,
                name: f.name,
                language: f.language,
                pinned: f.pinned,
              })),
            activeFile: g.activeFile,
          })),
          activeGroupId: state.activeGroupId,
          recentFiles: state.recentFiles,
        };
        localStorage.setItem(editorStorageKey(), JSON.stringify(data));
      } catch {
        // silently ignore
      }
    }, EDITOR_PERSIST_DEBOUNCE_MS);
  },

  restore: async (workspace) => {
    if (workspace !== undefined) currentPersistWorkspace = workspace;
    try {
      const raw = localStorage.getItem(editorStorageKey());
      if (!raw) return;
      const data = JSON.parse(raw) as PersistedEditorData;
      if (!data.groups || data.groups.length === 0) return;

      // Lightweight restore: rebuild tab metadata first, then hydrate only active files.
      const restoredGroups: EditorGroup[] = data.groups.map((savedGroup) => {
        const files: OpenFile[] = savedGroup.openFiles.map((meta) => ({
          path: meta.path,
          name: meta.name,
          language: meta.language,
          content: "",
          modified: false,
          pinned: meta.pinned,
          loaded: false,
        }));

        const activeFile = files.some((f) => f.path === savedGroup.activeFile)
          ? savedGroup.activeFile
          : (files[files.length - 1]?.path ?? null);

        return {
          id: savedGroup.id,
          openFiles: files,
          activeFile,
        };
      });

      const nonEmpty = restoredGroups.filter((g) => g.openFiles.length > 0);
      const finalGroups =
        nonEmpty.length > 0 ? nonEmpty : [createDefaultGroup()];
      const activeGroupId = finalGroups.some((g) => g.id === data.activeGroupId)
        ? data.activeGroupId
        : finalGroups[0].id;

      set({
        groups: finalGroups,
        activeGroupId,
        recentFiles: data.recentFiles ?? [],
        ...syncTopLevel(finalGroups, activeGroupId),
        pendingDiffs: [],
      });

      await Promise.allSettled(
        finalGroups.map(async (group) => {
          if (!group.activeFile) return;
          const activeMeta = group.openFiles.find(
            (f) => f.path === group.activeFile,
          );
          if (!activeMeta) return;
          try {
            const result = await window.desktop.fs.readFile(activeMeta.path);
            if (!result.error) {
              get().hydrateFileContent(
                activeMeta.path,
                result.content,
                result.language || activeMeta.language,
              );
            }
          } catch {
            // Lazy hydration failure is handled when the user focuses the tab again.
          }
        }),
      );
    } catch {
      console.warn("Failed to restore editor state");
    }
  },

  suspendForWorkspace: (workspace) => {
    const state = get();
    // 保存完整的内存快照（包含文件内容，恢复时不需要重新从磁盘读）
    workspaceSnapshots.set(workspace, {
      groups: state.groups,
      activeGroupId: state.activeGroupId,
      recentFiles: state.recentFiles,
      pendingDiffs: state.pendingDiffs,
    });
    // 持久化到 localStorage（供重启恢复）
    currentPersistWorkspace = workspace;
    get().persist();
  },

  resumeForWorkspace: async (workspace) => {
    currentPersistWorkspace = workspace;
    const snapshot = workspaceSnapshots.get(workspace);
    if (snapshot) {
      // 内存中有快照 → 直接恢复（瞬间，不需要读磁盘）
      set({
        groups: snapshot.groups,
        activeGroupId: snapshot.activeGroupId,
        recentFiles: snapshot.recentFiles,
        pendingDiffs: snapshot.pendingDiffs,
        ...syncTopLevel(snapshot.groups, snapshot.activeGroupId),
      });
    } else {
      // 内存中没有（首次打开或重启后）→ 从 localStorage 恢复
      await get().restore(workspace);
    }
  },
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

// ── 精细化 selector hooks ────────────────────────────────────────────

/** 当前活跃文件路径 */
export const useActiveFile = () => useEditor((s) => s.activeFile);

/** 当前活跃文件的元数据（StatusBar 用） */
export const useActiveFileMeta = () =>
  useEditor((s) => {
    const group = s.groups.find((g) => g.id === s.activeGroupId);
    if (!group?.activeFile) return null;
    return group.openFiles.find((f) => f.path === group.activeFile) ?? null;
  });

/** pendingDiffs 列表 */
export const usePendingDiffs = () => useEditor((s) => s.pendingDiffs);
