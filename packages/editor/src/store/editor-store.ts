/**
 * Editor Store — 编辑器状态管理核心实现
 *
 * 这是一个独立的状态管理模块，通过 HostBridge 与宿主应用解耦。
 * 宿主应用需要：
 * 1. 调用 initEditorStore() 初始化
 * 2. 通过 useEditorStore 访问状态
 * 3. 实现 EditorStoreHost 接口并注册
 */

import { getTextModelService } from "../core/text-model";
import { workspaceHash } from "../utils/path-utils";
import type { OpenFile, DiffEntry, EditorGroup, EditorSnapshot } from "./types";
import { buildDiffTabPath, SETTINGS_PATH } from "./types";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_GROUP_ID = "default";
const MAX_RECENT_FILES = 20;
const EDITOR_KEY_PREFIX = "ftre-editor-state";

// ── Language Detection ───────────────────────────────────────────────

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  sh: "shellscript",
  bash: "shellscript",
  sql: "sql",
  vue: "vue",
  svelte: "svelte",
  toml: "toml",
  ini: "ini",
};

function detectLanguageFromPath(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() ?? "";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_LANGUAGE_MAP[ext] || "plaintext";
}
const EDITOR_PERSIST_DEBOUNCE_MS = 500;

// ── Host Interface ───────────────────────────────────────────────────

/**
 * 宿主应用需要实现的接口
 * 用于处理 IPC 调用和持久化
 */
export interface EditorStoreHost {
  /** 读取文件内容 */
  readFile(
    path: string,
  ): Promise<{ content: string; language: string; error?: string }>;
  /** 写入文件内容 */
  writeFile(
    path: string,
    content: string,
  ): Promise<{ success: boolean; error?: string }>;
  /** 获取 localStorage 值 */
  storageGet(key: string): string | null;
  /** 设置 localStorage 值 */
  storageSet(key: string, value: string): void;
}

let storeHost: EditorStoreHost | null = null;

export function registerEditorStoreHost(host: EditorStoreHost): void {
  storeHost = host;
}

function getHost(): EditorStoreHost {
  if (!storeHost) {
    throw new Error(
      "[editor-store] Host not registered. Call registerEditorStoreHost() first.",
    );
  }
  return storeHost;
}

// ── Persistence Types ────────────────────────────────────────────────

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

// ── State ────────────────────────────────────────────────────────────

let editorPersistTimer: ReturnType<typeof setTimeout> | null = null;
let currentPersistWorkspace: string | null = null;
const workspaceSnapshots = new Map<string, EditorSnapshot>();

function editorStorageKey(ws?: string | null): string {
  const root = ws ?? currentPersistWorkspace;
  return root
    ? `${EDITOR_KEY_PREFIX}:${workspaceHash(root)}`
    : EDITOR_KEY_PREFIX;
}

// ── State Interface ──────────────────────────────────────────────────

export interface EditorState {
  // Core state
  groups: EditorGroup[];
  activeGroupId: string;
  recentFiles: string[];
  pendingDiffs: DiffEntry[];

  // Backward-compatible top-level accessors (from active group)
  openFiles: OpenFile[];
  activeFile: string | null;
}

export interface EditorActions {
  // File operations
  openFile: (
    file: Omit<OpenFile, "modified" | "pinned" | "loaded"> & {
      loaded?: boolean;
    },
  ) => void;
  closeFile: (path: string) => void;
  setActive: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  markSaved: (path: string) => void;
  setModified: (path: string, modified: boolean) => void;
  refreshFile: (path: string, newContent: string) => void;
  hydrateFileContent: (
    path: string,
    newContent: string,
    language?: string,
  ) => void;
  setFileLanguage: (path: string, language: string) => void;

  // Diff operations
  addDiff: (diff: DiffEntry) => void;
  acceptDiff: (filePath: string) => void;
  rejectDiff: (filePath: string) => void;

  // Group operations
  splitEditor: () => void;
  closeGroup: (groupId: string) => void;
  setActiveGroup: (groupId: string) => void;
  moveTabToGroup: (
    filePath: string,
    fromGroupId: string,
    toGroupId: string,
  ) => void;
  reorderTabs: (groupId: string, fromIndex: number, toIndex: number) => void;

  // Tab operations
  closeOtherFiles: (path: string) => void;
  closeFilesToRight: (path: string) => void;
  closeSavedFiles: () => void;
  pinFile: (path: string) => void;
  unpinFile: (path: string) => void;

  // Recent files
  addRecentFile: (path: string) => void;
  removeRecentFile: (path: string) => void;

  // File system events
  handleFileRenamed: (oldPath: string, newPath: string, isDir: boolean) => void;
  handleFileDeleted: (deletedPath: string, isDir: boolean) => void;

  // Utilities
  createUntitledFile: () => void;
  closeAllFiles: () => void;
  hasUnsavedChanges: () => boolean;

  // Special editors (VSCode-style EditorInput)
  openSettings: () => void;

  // Persistence
  persist: () => void;
  restore: (workspace?: string | null) => Promise<void>;
  suspendForWorkspace: (workspace: string) => void;
  resumeForWorkspace: (workspace: string) => Promise<void>;
}

export type EditorStore = EditorState & EditorActions;

// ── Helpers ──────────────────────────────────────────────────────────

function createDefaultGroup(): EditorGroup {
  return { id: DEFAULT_GROUP_ID, openFiles: [], activeFile: null };
}

let groupCounter = 0;

function generateGroupId(): string {
  groupCounter += 1;
  return `group-${groupCounter}`;
}

/** Reset group counter — for testing only */
export function _resetGroupCounter(): void {
  groupCounter = 0;
}

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

function syncTopLevel(groups: EditorGroup[], activeGroupId: string) {
  const active = groups.find((g) => g.id === activeGroupId) ?? groups[0];
  return { openFiles: active.openFiles, activeFile: active.activeFile };
}

// ── Store Factory ────────────────────────────────────────────────────

export type SetState = (
  partial:
    | Partial<EditorState>
    | ((state: EditorState) => Partial<EditorState>),
) => void;
export type GetState = () => EditorStore;

/**
 * 创建 Editor Store 的 actions
 * 这个工厂函数允许与任何状态管理库集成 (Zustand, Redux, etc.)
 */
export function createEditorActions(
  set: SetState,
  get: GetState,
): EditorActions {
  return {
    // ── File Operations ──────────────────────────────────────────────

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

      // 清理：如果没有其他 group 打开此文件
      const stillOpen = groups.some((g) =>
        g.openFiles.some((f) => f.path === path),
      );
      if (!stillOpen) {
        const modelService = getTextModelService();
        modelService.dispose(path);
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

      // 标记 Model 为已保存
      const modelService = getTextModelService();
      if (modelService.isInitialized()) {
        modelService.markSaved(path);
      }

      // 更新所有组中该文件的 modified 状态（UI 需要）
      const groups = state.groups.map((g) => ({
        ...g,
        openFiles: g.openFiles.map((f) =>
          f.path === path ? { ...f, modified: false } : f,
        ),
      }));
      set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
    },

    setModified: (path, modified) => {
      const state = get();

      // 在所有组中查找文件（文件可能在非活跃组中被修改）
      let foundInAnyGroup = false;
      for (const group of state.groups) {
        const file = group.openFiles.find((f) => f.path === path);
        if (file && file.modified !== modified) {
          foundInAnyGroup = true;
          break;
        }
      }
      if (!foundInAnyGroup) return;

      // 更新所有组中该文件的 modified 状态
      const groups = state.groups.map((g) => ({
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

      // 刷新 Model
      const modelService = getTextModelService();
      if (modelService.isInitialized()) {
        modelService.updateContent(path, newContent);
      }

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

      // 新架构由 EditorGroupPane 自动加载 Model，这里只更新 store 状态
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

    setFileLanguage: (path, language) => {
      const state = get();
      const newGroups = state.groups.map((g) => ({
        ...g,
        openFiles: g.openFiles.map((f) =>
          f.path === path ? { ...f, language } : f,
        ),
      }));
      set({
        groups: newGroups,
        ...syncTopLevel(newGroups, state.activeGroupId),
      });
    },

    // ── Diff Operations ──────────────────────────────────────────────

    addDiff: (diff) => {
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

      // Ensure diff virtual tab exists and is active
      const freshState = get();
      const group = getActiveGroup(freshState);
      const tabExists = group.openFiles.some((f) => f.path === diff.tabPath);

      if (!tabExists) {
        const fileName = diff.filePath.split(/[\\/]/).pop() ?? diff.filePath;
        const virtualFile: OpenFile = {
          path: diff.tabPath,
          name: `${fileName} (Diff)`,
          language: detectLanguageFromPath(diff.filePath),
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
              updatedFiles[Math.min(idx, updatedFiles.length - 1)]?.path ??
              null;
          }
        }

        return { ...g, openFiles: updatedFiles, activeFile: newActive };
      });

      set({
        groups,
        ...syncTopLevel(groups, state.activeGroupId),
        pendingDiffs: state.pendingDiffs.filter((d) => d.filePath !== filePath),
      });

      // Write file via host
      getHost().writeFile(filePath, diff.newContent);
    },

    rejectDiff: (filePath) => {
      const state = get();
      const diff = state.pendingDiffs.find((d) => d.filePath === filePath);
      if (!diff) return;

      const groups = state.groups.map((g) => {
        const filtered = g.openFiles.filter((f) => f.path !== diff.tabPath);
        let newActive = g.activeFile;
        if (g.activeFile === diff.tabPath) {
          const idx = g.openFiles.findIndex((f) => f.path === diff.tabPath);
          newActive =
            filtered[Math.min(idx, filtered.length - 1)]?.path ?? null;
        }
        return { ...g, openFiles: filtered, activeFile: newActive };
      });

      set({
        groups,
        ...syncTopLevel(groups, state.activeGroupId),
        pendingDiffs: state.pendingDiffs.filter((d) => d.filePath !== filePath),
      });
    },

    // ── Group Operations ─────────────────────────────────────────────

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

      const existsInTarget = toGroup.openFiles.find((f) => f.path === filePath);
      let groups = state.groups;

      // Remove from source group
      groups = updateGroup(groups, fromGroupId, (g) => {
        const newFiles = g.openFiles.filter((f) => f.path !== filePath);
        let newActive = g.activeFile;
        if (g.activeFile === filePath) {
          const idx = g.openFiles.findIndex((f) => f.path === filePath);
          newActive =
            newFiles[Math.min(idx, newFiles.length - 1)]?.path ?? null;
        }
        return { ...g, openFiles: newFiles, activeFile: newActive };
      });

      // Add to target group if not already there
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

    // ── Tab Operations ───────────────────────────────────────────────

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

      // 清理不再打开的文件
      const modelService = getTextModelService();
      for (const removedPath of removedPaths) {
        const stillOpen = groups.some((g) =>
          g.openFiles.some((f) => f.path === removedPath),
        );
        if (!stillOpen) {
          modelService.dispose(removedPath);
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
        group.openFiles
          .filter((f, i) => i > idx && !f.pinned)
          .map((f) => f.path),
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

      // 清理不再打开的文件
      const modelService = getTextModelService();
      for (const removedPath of removedPaths) {
        const stillOpen = groups.some((g) =>
          g.openFiles.some((f) => f.path === removedPath),
        );
        if (!stillOpen) {
          modelService.dispose(removedPath);
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

      // 清理不再打开的文件
      const modelService = getTextModelService();
      for (const removedPath of removedPaths) {
        const stillOpen = groups.some((g) =>
          g.openFiles.some((f) => f.path === removedPath),
        );
        if (!stillOpen) {
          modelService.dispose(removedPath);
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

    // ── Recent Files ─────────────────────────────────────────────────

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

    // ── File System Events ───────────────────────────────────────────

    handleFileRenamed: (oldPath, newPath, isDir) => {
      const state = get();

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

      const pendingDiffs = state.pendingDiffs.map((d) =>
        matchesPath(d.filePath)
          ? {
              ...d,
              filePath: updateFilePath(d.filePath),
              tabPath: buildDiffTabPath(updateFilePath(d.filePath)),
            }
          : d,
      );

      set({
        groups,
        pendingDiffs,
        ...syncTopLevel(groups, state.activeGroupId),
      });

      // 新架构：关闭旧路径的 Model，让编辑器重新加载新路径
      const modelService = getTextModelService();
      if (modelService.isInitialized()) {
        if (isDir) {
          // 目录重命名：需要遍历所有打开的文件
          for (const group of state.groups) {
            for (const file of group.openFiles) {
              if (
                file.path === oldPath ||
                file.path.startsWith(oldPath + "/") ||
                file.path.startsWith(oldPath + "\\")
              ) {
                modelService.dispose(file.path);
              }
            }
          }
        } else {
          modelService.dispose(oldPath);
        }
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

      // 收集被删除的文件路径
      const deletedFilePaths = new Set<string>();
      for (const g of state.groups) {
        for (const f of g.openFiles) {
          if (matchesPath(f.path)) deletedFilePaths.add(f.path);
        }
      }

      const groups = state.groups.map((g) => {
        const hasMatch = g.openFiles.some((f) => matchesPath(f.path));
        if (!hasMatch) return g;

        const filtered = g.openFiles.filter((f) => !matchesPath(f.path));
        let newActive = g.activeFile;
        if (g.activeFile && matchesPath(g.activeFile)) {
          const idx = g.openFiles.findIndex((f) => f.path === g.activeFile);
          newActive =
            filtered[Math.min(idx, filtered.length - 1)]?.path ?? null;
        }

        return { ...g, openFiles: filtered, activeFile: newActive };
      });

      const pendingDiffs = state.pendingDiffs.filter(
        (d) => !matchesPath(d.filePath) && !matchesPath(d.tabPath),
      );

      set({
        groups,
        pendingDiffs,
        ...syncTopLevel(groups, state.activeGroupId),
      });

      // 删除 Model（仅当文件不在任何 group 中打开时）
      const modelService = getTextModelService();
      for (const deletedFilePath of deletedFilePaths) {
        const stillOpen = groups.some((g) =>
          g.openFiles.some((f) => f.path === deletedFilePath),
        );
        if (!stillOpen) {
          modelService.dispose(deletedFilePath);
        }
      }
    },

    // ── Utilities ────────────────────────────────────────────────────

    createUntitledFile: () => {
      const state = get();
      const group = getActiveGroup(state);

      // Find max Untitled number across all groups
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

      // 销毁所有 Model
      const modelService = getTextModelService();
      if (modelService.isInitialized()) {
        modelService.disposeAll();
      }
    },

    hasUnsavedChanges: () => {
      const modelService = getTextModelService();
      return modelService.getDirtyUris().length > 0;
    },

    // ── Special Editors (VSCode-style EditorInput) ───────────────────

    openSettings: () => {
      const state = get();

      // 检查是否已经打开了 Settings tab（单例模式）
      for (const g of state.groups) {
        const existing = g.openFiles.find((f) => f.path === SETTINGS_PATH);
        if (existing) {
          // 聚焦到已有的 Settings tab
          const groups = updateGroup(state.groups, g.id, (group) => ({
            ...group,
            activeFile: SETTINGS_PATH,
          }));
          set({
            groups,
            activeGroupId: g.id,
            ...syncTopLevel(groups, g.id),
          });
          return;
        }
      }

      // 创建新的 Settings tab
      const group = getActiveGroup(state);
      const settingsFile: OpenFile = {
        path: SETTINGS_PATH,
        name: "Settings",
        language: "settings",
        content: "",
        modified: false,
        pinned: false,
        loaded: true,
        type: "settings",
      };

      const groups = updateGroup(state.groups, group.id, (g) => ({
        ...g,
        openFiles: [...g.openFiles, settingsFile],
        activeFile: SETTINGS_PATH,
      }));
      set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
    },

    // ── Persistence ──────────────────────────────────────────────────

    persist: () => {
      if (editorPersistTimer) clearTimeout(editorPersistTimer);
      editorPersistTimer = setTimeout(() => {
        try {
          const state = get();
          const data: PersistedEditorData = {
            groups: state.groups.map((g) => ({
              id: g.id,
              openFiles: g.openFiles
                .filter(
                  (f) =>
                    !f.path.startsWith("diff:") &&
                    !f.path.startsWith("untitled:") &&
                    !f.path.startsWith("ftre://"),
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
          getHost().storageSet(editorStorageKey(), JSON.stringify(data));
        } catch {
          // Silently ignore
        }
      }, EDITOR_PERSIST_DEBOUNCE_MS);
    },

    restore: async (workspace) => {
      if (workspace !== undefined) currentPersistWorkspace = workspace;
      try {
        const raw = getHost().storageGet(editorStorageKey());
        if (!raw) return;

        const data = JSON.parse(raw) as PersistedEditorData;
        if (!data.groups || data.groups.length === 0) return;

        // Lightweight restore: rebuild tab metadata first
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
        const activeGroupId = finalGroups.some(
          (g) => g.id === data.activeGroupId,
        )
          ? data.activeGroupId
          : finalGroups[0].id;

        set({
          groups: finalGroups,
          activeGroupId,
          recentFiles: data.recentFiles ?? [],
          ...syncTopLevel(finalGroups, activeGroupId),
          pendingDiffs: [],
        });

        // Hydrate active files
        const host = getHost();
        await Promise.allSettled(
          finalGroups.map(async (group) => {
            if (!group.activeFile) return;
            const activeMeta = group.openFiles.find(
              (f) => f.path === group.activeFile,
            );
            if (!activeMeta) return;
            try {
              const result = await host.readFile(activeMeta.path);
              if (!result.error) {
                get().hydrateFileContent(
                  activeMeta.path,
                  result.content,
                  result.language || activeMeta.language,
                );
              }
            } catch {
              // Lazy hydration failure handled when user focuses tab
            }
          }),
        );
      } catch {
        console.warn("Failed to restore editor state");
      }
    },

    suspendForWorkspace: (workspace) => {
      const state = get();
      workspaceSnapshots.set(workspace, {
        groups: state.groups,
        activeGroupId: state.activeGroupId,
        recentFiles: state.recentFiles,
        pendingDiffs: state.pendingDiffs,
      });
      currentPersistWorkspace = workspace;

      // 新架构不需要休眠机制，直接持久化
      get().persist();
    },

    resumeForWorkspace: async (workspace) => {
      currentPersistWorkspace = workspace;
      const snapshot = workspaceSnapshots.get(workspace);

      if (snapshot) {
        set({
          groups: snapshot.groups,
          activeGroupId: snapshot.activeGroupId,
          recentFiles: snapshot.recentFiles,
          pendingDiffs: snapshot.pendingDiffs,
          ...syncTopLevel(snapshot.groups, snapshot.activeGroupId),
        });
      } else {
        await get().restore(workspace);
      }
    },
  };
}

// ── Initial State ────────────────────────────────────────────────────

export function createInitialEditorState(): EditorState {
  return {
    groups: [createDefaultGroup()],
    activeGroupId: DEFAULT_GROUP_ID,
    recentFiles: [],
    pendingDiffs: [],
    openFiles: [],
    activeFile: null,
  };
}
