/**
 * editorCore — 非响应式编辑器核心模块（全局单例）
 *
 * 管理三类数据，全部使用 Map，不触发 React 渲染：
 * 1. 文件内容：当前内容 + 磁盘版本（用于 dirty 判断）
 * 2. Monaco 实例：活跃编辑器的引用（用于外部直接操作）
 * 3. 视图状态：scroll/cursor/selections（切换文件时保存/恢复）
 */

import type { editor } from 'monaco-editor';

// ── 存储 ──

const contents = new Map<string, string>();
const diskContents = new Map<string, string>();
const instances = new Map<string, editor.IStandaloneCodeEditor>();
const viewStates = new Map<string, editor.ICodeEditorViewState>();

interface ContentSnapshot {
  contents: Map<string, string>;
  diskContents: Map<string, string>;
  viewStates: Map<string, editor.ICodeEditorViewState>;
}
const workspaceSnapshots = new Map<string, ContentSnapshot>();

// ── API ──

export const editorCore = {
  // 内容
  getContent: (path: string) => contents.get(path) ?? '',
  setContent: (path: string, value: string) => { contents.set(path, value); },
  getDiskContent: (path: string) => diskContents.get(path) ?? '',
  setDiskContent: (path: string, value: string) => { diskContents.set(path, value); },
  removeContent: (path: string) => { contents.delete(path); diskContents.delete(path); },
  isDirty: (path: string) => contents.get(path) !== diskContents.get(path),

  // 实例
  registerInstance: (path: string, ed: editor.IStandaloneCodeEditor) => { instances.set(path, ed); },
  unregisterInstance: (path: string) => { instances.delete(path); },
  getInstance: (path: string) => instances.get(path) ?? null,

  /** 优先从 Monaco 实例取内容（最准确），回退到 Map */
  resolveContent: (path: string): string => {
    const inst = instances.get(path);
    if (inst) return inst.getValue();
    return contents.get(path) ?? '';
  },

  /** 直接更新 Monaco 实例内容（用于外部文件变更/SSE refresh） */
  pushContentToEditor: (path: string, newContent: string) => {
    const inst = instances.get(path);
    if (!inst) return;
    // 内容相同时跳过 setValue（避免自身保存触发 watcher 后重置光标和 undo 栈）
    if (inst.getValue() === newContent) return;
    inst.setValue(newContent);
  },

  // 视图状态
  saveViewState: (path: string, state: editor.ICodeEditorViewState) => { viewStates.set(path, state); },
  getViewState: (path: string) => viewStates.get(path) ?? null,
  removeViewState: (path: string) => { viewStates.delete(path); },

  /** 检查某路径是否有内容缓存 */
  hasContent: (path: string): boolean => contents.has(path),

  /** 将 oldPath 的所有数据迁移到 newPath，删除 oldPath */
  migrateKey: (oldPath: string, newPath: string): void => {
    if (contents.has(oldPath)) {
      contents.set(newPath, contents.get(oldPath)!);
      contents.delete(oldPath);
    }
    if (diskContents.has(oldPath)) {
      diskContents.set(newPath, diskContents.get(oldPath)!);
      diskContents.delete(oldPath);
    }
    if (viewStates.has(oldPath)) {
      viewStates.set(newPath, viewStates.get(oldPath)!);
      viewStates.delete(oldPath);
    }
    // instances 不迁移（Monaco 实例与 DOM 绑定，重命名后会重新 mount），但清理旧引用
    instances.delete(oldPath);
  },

  /** 批量迁移前缀（用于文件夹重命名） */
  migratePrefix: (oldPrefix: string, newPrefix: string): void => {
    for (const map of [contents, diskContents, viewStates] as Map<string, unknown>[]) {
      const toMigrate: [string, string][] = [];
      for (const key of map.keys()) {
        if (key.startsWith(oldPrefix + '/') || key.startsWith(oldPrefix + '\\')) {
          toMigrate.push([key, newPrefix + key.slice(oldPrefix.length)]);
        }
      }
      for (const [oldKey, newKey] of toMigrate) {
        map.set(newKey, map.get(oldKey));
        map.delete(oldKey);
      }
    }
    // 清理 instances 中的旧引用（不迁移值，重命名后会重新 mount）
    for (const key of [...instances.keys()]) {
      if (key.startsWith(oldPrefix + '/') || key.startsWith(oldPrefix + '\\')) {
        instances.delete(key);
      }
    }
  },

  // 工作区快照
  snapshotForWorkspace: (workspace: string) => {
    workspaceSnapshots.set(workspace, {
      contents: new Map(contents),
      diskContents: new Map(diskContents),
      viewStates: new Map(viewStates),
    });
  },
  restoreFromWorkspace: (workspace: string): boolean => {
    const snap = workspaceSnapshots.get(workspace);
    if (!snap) return false;
    contents.clear(); snap.contents.forEach((v, k) => contents.set(k, v));
    diskContents.clear(); snap.diskContents.forEach((v, k) => diskContents.set(k, v));
    viewStates.clear(); snap.viewStates.forEach((v, k) => viewStates.set(k, v));
    return true;
  },
  clearAll: () => {
    contents.clear(); diskContents.clear(); instances.clear(); viewStates.clear();
  },
};
