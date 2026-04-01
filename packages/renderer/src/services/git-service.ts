/**
 * GitService — 前端全局 git 操作单例
 *
 * 统一管理：
 * 1. 数据获取：git info / git status，带缓存 + fingerprint 防重复
 * 2. 操作：stage / unstage / commit / diffFile
 * 3. 变更通知：订阅机制，操作后自动通知所有消费者
 * 4. 基于真实文件系统变更防抖刷新缓存
 *
 * 各组件不再直接调 window.desktop.git.xxx，改用 gitService.xxx
 */

import { performanceMetrics } from "@/services/performance-metrics";

type GitInfo = {
  branch: string | null;
  changedFiles: number;
  isGitRepo: boolean;
};
type GitFile = {
  path: string;
  oldPath?: string;
  absolutePath: string;
  status: string;
  staged: boolean;
  isDir: boolean;
};
type DiffResult = { original: string; modified: string; error?: string };
type Listener = () => void;

class GitService {
  private rootPath: string | null = null;

  // ── 缓存 ──
  private cachedInfo: GitInfo = {
    branch: null,
    changedFiles: 0,
    isGitRepo: false,
  };
  private cachedFiles: GitFile[] = [];
  private filesFingerprint = "";

  /** 预计算：absolutePath → status（O(1) 文件状态查询） */
  private fileStatusMap = new Map<string, string>();
  /** 预计算：目录路径 → 冒泡 status（任一子文件有变更则冒泡到父目录） */
  private dirStatusMap = new Map<string, string>();

  // ── 订阅者 ──
  private listeners = new Set<Listener>();

  // ── 防抖 ──
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private fsWatcherCleanup: (() => void) | null = null;

  /** 设置工作区路径，切换时清缓存 + 重新监听广播 */
  setRootPath(path: string | null): void {
    if (path === this.rootPath) return;
    this.rootPath = path;
    this.cachedInfo = { branch: null, changedFiles: 0, isGitRepo: false };
    this.cachedFiles = [];
    this.filesFingerprint = "";
    this.fileStatusMap.clear();
    this.dirStatusMap.clear();
    this.notify();

    // 重新绑定文件系统监听：由真实文件变化驱动 Git 刷新，而不是 UI tree-refresh
    if (this.fsWatcherCleanup) {
      this.fsWatcherCleanup();
      this.fsWatcherCleanup = null;
    }
    if (path) {
      const normalizedRoot = path.replace(/\\/g, "/").replace(/\/+$/, "");
      this.fsWatcherCleanup = window.desktop.fs.onFileChanged(
        (changedPath: string) => {
          const normalizedChanged = changedPath.replace(/\\/g, "/");
          if (
            normalizedChanged === normalizedRoot ||
            normalizedChanged.startsWith(normalizedRoot + "/")
          ) {
            this.debouncedRefresh();
          }
        },
      );
      // 首次立即刷新
      this.refreshAll();
    }
  }

  /** 订阅变更通知，返回取消函数 */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  // ── 读取缓存（同步，零开销）──

  getInfo(): GitInfo {
    return this.cachedInfo;
  }
  getFiles(): GitFile[] {
    return this.cachedFiles;
  }

  // ── 刷新（异步，带 fingerprint 防闪烁）──

  async refreshAll(): Promise<void> {
    if (!this.rootPath) return;
    await Promise.all([this.refreshInfo(), this.refreshFiles()]);
  }

  async refreshInfo(): Promise<void> {
    if (!this.rootPath) return;
    performanceMetrics.count("git.refresh.requests");
    const startMark = performanceMetrics.start();
    try {
      const info = await window.desktop.git.info(this.rootPath);
      this.cachedInfo = {
        ...info,
        changedFiles: this.cachedInfo.changedFiles,
      };
      performanceMetrics.count("git.refresh.info");
      this.notify();
    } catch {
      this.cachedInfo = {
        branch: null,
        changedFiles: this.cachedInfo.changedFiles,
        isGitRepo: false,
      };
      performanceMetrics.count("git.refresh.info");
      this.notify();
    } finally {
      performanceMetrics.end("git.refresh.info.ms", startMark);
    }
  }

  async refreshFiles(): Promise<void> {
    if (!this.rootPath) return;
    const startMark = performanceMetrics.start();
    try {
      const result = await window.desktop.git.status(this.rootPath);
      const newFiles = result.files ?? [];
      const fp = newFiles
        .map((f) => `${f.path}:${f.status}:${f.staged}`)
        .join("|");
      const changedFiles = new Set(newFiles.map((f) => f.path)).size;

      if (
        fp !== this.filesFingerprint ||
        changedFiles !== this.cachedInfo.changedFiles
      ) {
        this.filesFingerprint = fp;
        this.cachedFiles = newFiles;
        this.cachedInfo = {
          ...this.cachedInfo,
          changedFiles,
          isGitRepo: this.cachedInfo.isGitRepo || newFiles.length > 0,
        };
        this.rebuildStatusMaps();
        this.notify();
      }
      performanceMetrics.count("git.refresh.status");
    } catch {
      if (this.filesFingerprint !== "" || this.cachedInfo.changedFiles !== 0) {
        this.filesFingerprint = "";
        this.cachedFiles = [];
        this.cachedInfo = {
          ...this.cachedInfo,
          changedFiles: 0,
        };
        this.fileStatusMap.clear();
        this.dirStatusMap.clear();
        this.notify();
      }
      performanceMetrics.count("git.refresh.status");
    } finally {
      performanceMetrics.end("git.refresh.status.ms", startMark);
    }
  }

  /** status 优先级：conflict > deleted > modified > added/renamed > untracked */
  private static STATUS_PRIORITY: Record<string, number> = {
    conflict: 5,
    deleted: 4,
    modified: 3,
    added: 2,
    renamed: 2,
    untracked: 1,
  };

  /** 从 cachedFiles 预计算 fileStatusMap 和 dirStatusMap */
  private rebuildStatusMaps(): void {
    this.fileStatusMap.clear();
    this.dirStatusMap.clear();
    for (const f of this.cachedFiles) {
      this.fileStatusMap.set(f.absolutePath, f.status);
      const newPri = GitService.STATUS_PRIORITY[f.status] ?? 0;
      // 冒泡到所有祖先目录，按优先级保留最高的
      let dir = f.absolutePath;
      while (true) {
        const lastSlash = Math.max(dir.lastIndexOf("/"), dir.lastIndexOf("\\"));
        if (lastSlash <= 0) break;
        dir = dir.slice(0, lastSlash);
        const existing = this.dirStatusMap.get(dir);
        const existingPri = existing
          ? (GitService.STATUS_PRIORITY[existing] ?? 0)
          : -1;
        if (newPri > existingPri) {
          this.dirStatusMap.set(dir, f.status);
        } else {
          break; // 当前优先级更低，祖先已有更高优先级，无需继续
        }
      }
    }
  }

  /** O(1) 查询文件/目录的 git status */
  getFileStatus(absolutePath: string): string | undefined {
    return this.fileStatusMap.get(absolutePath);
  }

  getDirStatus(absolutePath: string): string | undefined {
    return this.dirStatusMap.get(absolutePath);
  }

  private debouncedRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshAll();
    }, 1000);
  }

  // ── 操作（执行后自动刷新缓存 + 通知）──

  async stage(filePath: string): Promise<void> {
    if (!this.rootPath) return;
    await window.desktop.git.stage(this.rootPath, filePath);
    await this.refreshFiles();
  }

  async unstage(filePath: string): Promise<void> {
    if (!this.rootPath) return;
    await window.desktop.git.unstage(this.rootPath, filePath);
    await this.refreshFiles();
  }

  async stageAll(files: GitFile[]): Promise<void> {
    if (!this.rootPath) return;
    const filePaths = files.map((f) => f.path);
    if (filePaths.length === 0) return;
    await window.desktop.git.stageMany(this.rootPath, filePaths);
    await this.refreshFiles();
  }

  async unstageAll(files: GitFile[]): Promise<void> {
    if (!this.rootPath) return;
    const filePaths = files.map((f) => f.path);
    if (filePaths.length === 0) return;
    await window.desktop.git.unstageMany(this.rootPath, filePaths);
    await this.refreshFiles();
  }

  async commit(message: string): Promise<{ success: boolean; error?: string }> {
    if (!this.rootPath) return { success: false, error: "no workspace" };
    const result = await window.desktop.git.commit(this.rootPath, message);
    if (result.success) await this.refreshAll();
    return result;
  }

  async diffFile(file: GitFile): Promise<DiffResult> {
    if (!this.rootPath)
      return { original: "", modified: "", error: "no workspace" };
    return window.desktop.git.diffFile(
      this.rootPath,
      file.path,
      file.status,
      file.staged,
      file.oldPath,
    );
  }

  /** 清理（app 卸载时）*/
  destroy(): void {
    if (this.fsWatcherCleanup) {
      this.fsWatcherCleanup();
      this.fsWatcherCleanup = null;
    }
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.listeners.clear();
  }
}

/** 全局单例 */
export const gitService = new GitService();

// ── React Hook：订阅 gitService 变更 ──

import { useSyncExternalStore, useCallback } from "react";

/** 订阅 gitService 并用 selector 取值，只在选中的值变化时重渲染 */
export function useGitService<T>(selector: (svc: GitService) => T): T {
  const subscribe = useCallback(
    (onStoreChange: () => void) => gitService.subscribe(onStoreChange),
    [],
  );
  const getSnapshot = useCallback(() => selector(gitService), [selector]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
