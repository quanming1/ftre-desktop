import { create } from "zustand";
import { useEditor } from "./editor";
import { useSearch } from "./search";
import { useLayout } from "./layout";
import { useDiagnostics } from "./diagnostics";
import { useOutput } from "./output";
import { useNotification } from "./notification";
import { useGlobalSearch } from "./global-search";
import { terminalManager } from "@/services/terminal";
import { saveAllViewStates } from "@ftre/editor";
import { normalizePathForCompare } from "@/utils/pathUtils";

const RECENT_FOLDERS_KEY = "ftre-recent-folders";
const MAX_RECENT_FOLDERS = 12;

interface WorkspaceState {
  rootPath: string | null;
  restored: boolean;
  /** 最近打开过的文件夹路径列表（手动排序） */
  recentFolders: string[];
  setRootPath: (path: string) => void;
  /** 从持久化存储恢复上次打开的文件夹 */
  restore: () => Promise<void>;
  /** 从最近列表中移除一个文件夹 */
  removeRecentFolder: (path: string) => void;
  /** 重排文件夹顺序（拖拽排序用） */
  reorderFolders: (fromIndex: number, toIndex: number) => void;
}

function loadRecentFolders(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_FOLDERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const folders = parsed.filter(
          (s): s is string => typeof s === "string",
        );
        // 去重：使用 normalizePathForCompare 比较，保留第一次出现的路径
        const seen = new Set<string>();
        const deduplicated: string[] = [];
        for (const folder of folders) {
          const norm = normalizePathForCompare(folder);
          if (!seen.has(norm)) {
            seen.add(norm);
            deduplicated.push(folder);
          }
        }
        return deduplicated;
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}

function saveRecentFolders(folders: string[]) {
  try {
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(folders));
  } catch {
    /* ignore */
  }
}

/** 从路径提取文件夹名（用于排序） */
function extractFolderName(p: string): string {
  const norm = normalizePathForCompare(p);
  return norm.split("/").pop() || p;
}

/** 将 path 加入列表，去重，保持手动排序顺序，限制数量 */
function pushRecent(folders: string[], path: string): string[] {
  const norm = normalizePathForCompare(path);
  const exists = folders.some((f) => normalizePathForCompare(f) === norm);
  // 已存在的路径保持原位不动，只有新路径才追加到末尾
  if (exists) return folders;
  return [...folders, path].slice(0, MAX_RECENT_FOLDERS);
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  rootPath: null,
  restored: false,
  recentFolders: [],

  setRootPath: (path) => {
    const prev = get().rootPath;
    // 更新最近文件夹列表
    const updatedRecent = pushRecent(get().recentFolders, path);
    set({ rootPath: path, recentFolders: updatedRecent });
    saveRecentFolders(updatedRecent);
    // 持久化当前工作区
    window.desktop?.store?.set("lastWorkspace", path).catch(() => {});

    // 切换工作区时保存当前 ViewState
    saveAllViewStates();

    // Spec: open_folder — 切换工作区时挂起旧状态、恢复新状态
    const isSameWorkspace =
      prev && normalizePathForCompare(prev) === normalizePathForCompare(path);
    if (prev && !isSameWorkspace) {
      // 编辑器：挂起旧工作区快照，恢复新工作区（或空状态）
      useEditor.getState().suspendForWorkspace(prev);
      useEditor.getState().closeAllFiles(); // 先清空，再异步恢复
      useEditor.getState().resumeForWorkspace(path);
      // 清空搜索结果
      useSearch.getState().clearResults();
      // 终端：通知全局 terminalManager 切换工作区（旧终端 detach 但不销毁，新终端等待 UI 挂载）
      terminalManager.switchWorkspace(path);
      // Spec: open_folder — 侧边栏切换到 Explorer 视图
      useLayout.getState().setActiveSidebarView("explorer");
      // Note: workspace switching for chat is handled by session store
      // 清空诊断信息（文件路径属于旧工作区）
      useDiagnostics.getState().clear();
      // 清空输出频道（旧工作区的日志不应留在新工作区）
      useOutput.getState().clearAllChannels();
      // 清空通知（旧工作区的通知不应干扰新工作区）
      useNotification.getState().clearAll();
      // 关闭全局搜索面板（结果属于旧工作区）
      if (useGlobalSearch.getState().open) {
        useGlobalSearch.getState().close();
      }
      // 文件树展开状态已按工作区隔离（key 带 workspace hash），无需清除
    }
  },

  restore: async () => {
    if (get().restored) return;
    // 恢复最近文件夹列表
    const recentFolders = loadRecentFolders();
    try {
      const result = await window.desktop?.store?.get("lastWorkspace");
      const saved = result?.value as string | null;
      if (saved) {
        set({
          rootPath: saved,
          restored: true,
          recentFolders: pushRecent(recentFolders, saved),
        });
      } else {
        set({ restored: true, recentFolders });
      }
    } catch {
      set({ restored: true, recentFolders });
    }
  },

  removeRecentFolder: (path) => {
    const norm = normalizePathForCompare(path);
    const updated = get().recentFolders.filter(
      (f) => normalizePathForCompare(f) !== norm,
    );
    set({ recentFolders: updated });
    saveRecentFolders(updated);
  },

  reorderFolders: (fromIndex, toIndex) => {
    const folders = [...get().recentFolders];
    if (
      fromIndex < 0 ||
      fromIndex >= folders.length ||
      toIndex < 0 ||
      toIndex >= folders.length
    )
      return;
    const [moved] = folders.splice(fromIndex, 1);
    folders.splice(toIndex, 0, moved);
    set({ recentFolders: folders });
    saveRecentFolders(folders);
  },
}));
