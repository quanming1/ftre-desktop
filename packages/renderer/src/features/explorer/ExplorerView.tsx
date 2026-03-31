import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { FolderTree, GitBranch, FilePlus, FolderPlus, LocateFixed, ChevronsDownUp } from "lucide-react";
import { useWorkspace } from "@/stores/workspace";
import { useNotification } from "@/stores/notification";
import { useEditor } from "@/stores/editor";
import { gitService, useGitService } from "@/services/git-service";
import { workspaceHash, pathSep, pathJoin, pathParent } from "@/utils/pathUtils";
import { FileTreeItem } from "./FileTreeItem";
import { InlineInput } from "./InlineInput";
import { GitChangesView } from "./GitChangesView";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { flattenVisibleEntries, getNextFocusPath, getParentPath } from "./tree-navigation";
import { filterEntries } from "./file-filter";
import type { TreeEntry } from "./tree-navigation";
import type { FileEntry } from "@/types";

/** Pending inline creation state */
interface PendingCreate {
  type: "file" | "folder";
  dirPath: string;
}

/** Pending rename state */
interface PendingRename {
  path: string;
  isDir: boolean;
}

/** Pending delete confirmation state */
interface PendingDelete {
  path: string;
  isDir: boolean;
}

const TREE_KEY_PREFIX = 'ftre-tree-expanded';

/** 按工作区隔离的 localStorage key */
function treeStorageKey(rootPath: string | null): string {
  return rootPath ? `${TREE_KEY_PREFIX}:${workspaceHash(rootPath)}` : TREE_KEY_PREFIX;
}

function loadExpandedPaths(rootPath: string | null): Set<string> {
  try {
    const raw = localStorage.getItem(treeStorageKey(rootPath));
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      return new Set(arr);
    }
  } catch { /* ignore */ }
  return new Set();
}

let treePersistTimer: ReturnType<typeof setTimeout> | null = null;
function saveExpandedPaths(paths: Set<string>, rootPath: string | null) {
  if (treePersistTimer) clearTimeout(treePersistTimer);
  treePersistTimer = setTimeout(() => {
    try {
      localStorage.setItem(treeStorageKey(rootPath), JSON.stringify([...paths]));
    } catch { /* ignore */ }
  }, 300);
}

type ViewMode = "files" | "git";

export function ExplorerView() {
  const { rootPath, setRootPath } = useWorkspace();
  const [viewMode, setViewMode] = useState<ViewMode>("files");
  const gitChangeCount = useGitService((s) => s.getInfo().changedFiles);

  // gitService 跟随工作区切换
  useEffect(() => { gitService.setRootPath(rootPath); }, [rootPath]);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [pendingRename, setPendingRename] = useState<PendingRename | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => loadExpandedPaths(rootPath));
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const treeContainerRef = useRef<HTMLDivElement>(null);

  const { addNotification } = useNotification();

  // 工作区切换时，重新加载该工作区的文件树展开状态
  useEffect(() => {
    setExpandedPaths(loadExpandedPaths(rootPath));
    setChildrenMap(new Map());
  }, [rootPath]);



  // ── Children map for keyboard navigation tree ──────────────────────
  const [childrenMap, setChildrenMap] = useState<Map<string, FileEntry[]>>(new Map());
  /** 正在加载中的文件夹路径，防止重复 readDir */
  const loadingDirs = useRef<Set<string>>(new Set());

  // Load children for expanded folders that aren't loaded yet
  useEffect(() => {
    for (const folderPath of expandedPaths) {
      if (!childrenMap.has(folderPath) && !loadingDirs.current.has(folderPath)) {
        loadingDirs.current.add(folderPath);
        window.desktop.fs.readDir(folderPath).then((result) => {
          loadingDirs.current.delete(folderPath);
          setChildrenMap((prev) => {
            const next = new Map(prev);
            // 失败时写入空数组，防止无限重试
            next.set(folderPath, result.error ? [] : filterEntries(result.entries));
            return next;
          });
        });
      }
    }
  }, [expandedPaths, childrenMap]);

  // Build tree entries for flattenVisibleEntries
  const treeEntries = useMemo((): TreeEntry[] => {
    const buildTree = (items: FileEntry[]): TreeEntry[] =>
      items.map((entry) => ({
        ...entry,
        children: entry.isDir ? buildTree(childrenMap.get(entry.path) ?? []) : undefined,
      }));
    return buildTree(entries);
  }, [entries, childrenMap]);

  const toggleExpanded = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
        // 折叠时递归清理所有子孙文件夹路径
        const prefixBack = path + "\\";
        const prefixFwd = path + "/";
        for (const p of prev) {
          if (p.startsWith(prefixBack) || p.startsWith(prefixFwd)) {
            next.delete(p);
          }
        }
      } else {
        next.add(path);
      }
      saveExpandedPaths(next, rootPath);
      return next;
    });
  }, [rootPath]);

  // ── Keyboard navigation handler ─────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const flatEntries = flattenVisibleEntries(treeEntries, expandedPaths);
      if (flatEntries.length === 0) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          if (!focusedPath) {
            setFocusedPath(flatEntries[0].path);
          } else {
            const next = getNextFocusPath(flatEntries, focusedPath, "down");
            if (next) setFocusedPath(next);
          }
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          if (!focusedPath) {
            setFocusedPath(flatEntries[0].path);
          } else {
            const prev = getNextFocusPath(flatEntries, focusedPath, "up");
            if (prev) setFocusedPath(prev);
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (!focusedPath) break;
          const entry = flatEntries.find((fe) => fe.path === focusedPath);
          if (!entry) break;
          if (entry.isDir) {
            toggleExpanded(entry.path);
          } else {
            // Open file in editor
            window.desktop.fs.readFile(entry.path).then((result) => {
              if (!result.error) {
                useEditor.getState().openFile({
                  path: entry.path,
                  name: entry.name,
                  language: result.language,
                  content: result.content,
                });
              }
            });
          }
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          if (!focusedPath) break;
          const entry = flatEntries.find((fe) => fe.path === focusedPath);
          if (!entry) break;
          if (entry.isDir) {
            if (!entry.expanded) {
              toggleExpanded(entry.path);
            } else {
              // Move to first child
              const next = getNextFocusPath(flatEntries, focusedPath, "down");
              if (next) setFocusedPath(next);
            }
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (!focusedPath) break;
          const entry = flatEntries.find((fe) => fe.path === focusedPath);
          if (!entry) break;
          if (entry.isDir && entry.expanded) {
            toggleExpanded(entry.path);
          } else {
            // Move to parent
            const parent = getParentPath(flatEntries, focusedPath);
            if (parent) setFocusedPath(parent);
          }
          break;
        }
        case "F2": {
          e.preventDefault();
          if (!focusedPath) break;
          const entry = flatEntries.find((fe) => fe.path === focusedPath);
          if (!entry) break;
          setPendingRename({ path: entry.path, isDir: entry.isDir });
          setPendingCreate(null);
          setPendingDelete(null);
          break;
        }
        case "Delete": {
          e.preventDefault();
          if (!focusedPath) break;
          const entry = flatEntries.find((fe) => fe.path === focusedPath);
          if (!entry) break;
          setPendingDelete({ path: entry.path, isDir: entry.isDir });
          setPendingCreate(null);
          setPendingRename(null);
          break;
        }
      }
    },
    [treeEntries, expandedPaths, focusedPath, setFocusedPath, toggleExpanded, setPendingRename, setPendingCreate, setPendingDelete],
  );

  // ── Load root entries ──────────────────────────────────────────────
  const prevRootRef = useRef<string | null>(null);

  const refreshRoot = useCallback(() => {
    if (!rootPath) return;
    const isNewRoot = prevRootRef.current !== rootPath;
    prevRootRef.current = rootPath;

    window.desktop.fs.readDir(rootPath).then((result) => {
      setEntries(filterEntries(result.entries));

      // Spec: open_folder — 首次加载新文件夹时自动打开 README
      if (isNewRoot) {
        const readme = result.entries.find((e) => !e.isDir && /^readme(\.\w+)?$/i.test(e.name));
        if (readme) {
          window.desktop.fs.readFile(readme.path).then((fileResult) => {
            if (!fileResult.error) {
              useEditor.getState().openFile({
                path: readme.path,
                name: readme.name,
                language: fileResult.language,
                content: fileResult.content,
              });
            }
          });
        }
      }
    });
  }, [rootPath]);

  useEffect(() => {
    refreshRoot();
  }, [refreshRoot]);

  // ── Refresh tree when ftre:tree-refresh fires ──────────────────────
  // 统一处理所有目录的刷新（ExplorerView 是唯一处理方）
  // 用 ref 引用 childrenMap/expandedPaths，避免 effect 因其变化反复重建监听器
  const childrenMapRef = useRef(childrenMap);
  childrenMapRef.current = childrenMap;
  const expandedPathsRef = useRef(expandedPaths);
  expandedPathsRef.current = expandedPaths;

  useEffect(() => {
    if (!rootPath) return;
    const handler = (e: Event) => {
      const { dirPath } = (e as CustomEvent).detail;
      if (dirPath === rootPath) {
        refreshRoot();
      }
      // 刷新 childrenMap 中对应路径的数据（如果已加载过）
      if (childrenMapRef.current.has(dirPath) || expandedPathsRef.current.has(dirPath)) {
        window.desktop.fs.readDir(dirPath).then((result) => {
          if (!result.error) {
            setChildrenMap((prev) => {
              const next = new Map(prev);
              next.set(dirPath, filterEntries(result.entries));
              return next;
            });
          }
        });
      }
    };
    window.addEventListener("ftre:tree-refresh", handler);
    return () => window.removeEventListener("ftre:tree-refresh", handler);
  }, [rootPath, refreshRoot]);

  // ── Event: ftre:new-file ───────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const { dirPath } = (e as CustomEvent).detail;
      setPendingCreate({ type: "file", dirPath });
      setPendingRename(null);
      setPendingDelete(null);
    };
    window.addEventListener("ftre:new-file", handler);
    return () => window.removeEventListener("ftre:new-file", handler);
  }, []);

  // ── Event: ftre:new-file-global (from TitleBar menu) ───────────────
  useEffect(() => {
    const handler = () => {
      if (!rootPath) return;
      setPendingCreate({ type: "file", dirPath: rootPath });
    };
    window.addEventListener("ftre:new-file-global", handler);
    return () => window.removeEventListener("ftre:new-file-global", handler);
  }, [rootPath]);

  // ── Event: ftre:new-folder ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const { dirPath } = (e as CustomEvent).detail;
      setPendingCreate({ type: "folder", dirPath });
      setPendingRename(null);
      setPendingDelete(null);
    };
    window.addEventListener("ftre:new-folder", handler);
    return () => window.removeEventListener("ftre:new-folder", handler);
  }, []);

  // ── Event: ftre:file-rename ────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const { path, isDir } = (e as CustomEvent).detail;
      setPendingRename({ path, isDir });
      setPendingCreate(null);
      setPendingDelete(null);
    };
    window.addEventListener("ftre:file-rename", handler);
    return () => window.removeEventListener("ftre:file-rename", handler);
  }, []);

  // ── Event: ftre:file-delete ────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const { path, isDir } = (e as CustomEvent).detail;
      setPendingDelete({ path, isDir });
      setPendingCreate(null);
      setPendingRename(null);
    };
    window.addEventListener("ftre:file-delete", handler);
    return () => window.removeEventListener("ftre:file-delete", handler);
  }, []);

  // ── Reveal: expand ancestors and highlight target ───────────────────
  // 同步批量展开所有祖先目录，children 加载由 expandedPaths 的 useEffect 自动触发。
  // 不使用 async/AbortController，避免自动 reveal 和手动定位按钮之间的竞态。
  //
  // focusSeq 递增计数器：当 focusedPath 值不变时（用户只是滚走了再点定位），
  // 仅靠 setFocusedPath 无法触发 re-render。通过递增 focusSeq 强制
  // FileTreeItem 的 scrollIntoView effect 重新执行。
  const [focusSeq, setFocusSeq] = useState(0);

  const revealPath = useCallback(
    (targetPath: string) => {
      if (!targetPath || !rootPath) return;

      const relativePath = targetPath.startsWith(rootPath) ? targetPath.slice(rootPath.length) : targetPath;
      const segments = relativePath.split(/[\\/]/).filter(Boolean);

      const pathsToExpand: string[] = [];
      let current = rootPath;
      for (let i = 0; i < segments.length - 1; i++) {
        current = pathJoin(current, segments[i]);
        pathsToExpand.push(current);
      }

      if (pathsToExpand.length > 0) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const p of pathsToExpand) {
            if (!next.has(p)) {
              next.add(p);
              changed = true;
            }
          }
          if (!changed) return prev;
          saveExpandedPaths(next, rootPath);
          return next;
        });
      }

      setFocusedPath(targetPath);
      setFocusSeq((s) => s + 1);
    },
    [rootPath],
  );

  // ── Event: ftre:reveal-in-sidebar ──────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const { path: targetPath } = (e as CustomEvent).detail;
      // 如果当前在 Git 视图，自动切换到文件视图
      setViewMode("files");
      revealPath(targetPath);
    };
    window.addEventListener("ftre:reveal-in-sidebar", handler);
    return () => window.removeEventListener("ftre:reveal-in-sidebar", handler);
  }, [revealPath]);

  // ── Auto-reveal active file in tree ────────────────────────────────
  const activeFile = useEditor((s) => s.activeFile);
  useEffect(() => {
    if (activeFile) {
      // diff 虚拟 tab 路径以 "diff:" 开头，提取真实文件路径
      const realPath = activeFile.startsWith("diff:") ? activeFile.slice(5) : activeFile;
      revealPath(realPath);
    }
  }, [activeFile, revealPath]);

  // ── 定位当前文件（按钮用） ─────────────────────────────────────────
  const hasActiveFile = useEditor((s) => s.activeFile !== null);

  const handleLocateFile = useCallback(() => {
    const active = useEditor.getState().activeFile;
    if (active) {
      const realPath = active.startsWith("diff:") ? active.slice(5) : active;
      revealPath(realPath);
    }
  }, [revealPath]);

  // ── 收齐所有文件夹 ────────────────────────────────────────────────
  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set());
    saveExpandedPaths(new Set(), rootPath);
  }, [rootPath]);

  // ── 工具栏新建文件/文件夹 ──────────────────────────────────────────
  const scrollTreeToBottom = useCallback(() => {
    // 延迟一帧，等待 InlineInput 渲染后再滚动
    requestAnimationFrame(() => {
      const el = treeContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const handleNewFile = useCallback(() => {
    if (!rootPath) return;
    setPendingCreate({ type: "file", dirPath: rootPath });
    setPendingRename(null);
    setPendingDelete(null);
    scrollTreeToBottom();
  }, [rootPath, scrollTreeToBottom]);

  const handleNewFolder = useCallback(() => {
    if (!rootPath) return;
    setPendingCreate({ type: "folder", dirPath: rootPath });
    setPendingRename(null);
    setPendingDelete(null);
    scrollTreeToBottom();
  }, [rootPath, scrollTreeToBottom]);

  // ── Handle new file/folder creation ────────────────────────────────
  const handleCreate = useCallback(
    async (name: string) => {
      if (!pendingCreate) return;
      const { type, dirPath } = pendingCreate;
      const fullPath = pathJoin(dirPath, name);

      const result = type === "file" ? await window.desktop.fs.createFile(fullPath) : await window.desktop.fs.createFolder(fullPath);

      if (!result.success) {
        addNotification({
          level: "error",
          message: result.error || (type === "file" ? "创建文件失败" : "创建文件夹失败"),
        });
      }

      // Auto-open newly created files in the editor (not folders)
      if (type === "file" && result.success) {
        const fileResult = await window.desktop.fs.readFile(fullPath);
        if (!fileResult.error) {
          useEditor.getState().openFile({
            path: fullPath,
            name,
            language: fileResult.language,
            content: fileResult.content,
          });
        }
      }

      setPendingCreate(null);
      // Refresh the tree — dispatch a refresh event so FileTreeItem can reload too
      refreshRoot();
      window.dispatchEvent(new CustomEvent("ftre:tree-refresh", { detail: { dirPath } }));
    },
    [pendingCreate, addNotification, refreshRoot],
  );

  // ── Handle rename ──────────────────────────────────────────────────
  const handleRename = useCallback(
    async (newName: string) => {
      if (!pendingRename) return;
      const { path: oldPath } = pendingRename;
      const parentDir = pathParent(oldPath);
      const newPath = pathJoin(parentDir, newName);

      if (newPath === oldPath) {
        setPendingRename(null);
        return;
      }

      const result = await window.desktop.fs.rename(oldPath, newPath);

      if (!result.success) {
        addNotification({
          level: "error",
          message: result.error || "重命名失败",
        });
      } else {
        // Notify editor to update open tabs (task 2.4 handles this)
        window.dispatchEvent(
          new CustomEvent("ftre:file-renamed", {
            detail: { oldPath, newPath, isDir: pendingRename.isDir },
          }),
        );
      }

      setPendingRename(null);
      refreshRoot();
      window.dispatchEvent(new CustomEvent("ftre:tree-refresh", { detail: { dirPath: parentDir } }));
    },
    [pendingRename, addNotification, refreshRoot],
  );

  // ── Handle delete ──────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const { path: targetPath, isDir } = pendingDelete;

    const result = await window.desktop.fs.delete(targetPath, isDir);

    if (!result.success) {
      addNotification({
        level: "error",
          message: result.error || "删除失败",
      });
    } else {
      // Notify editor to close open tabs (task 2.4 handles this)
      window.dispatchEvent(
        new CustomEvent("ftre:file-deleted", {
          detail: { path: targetPath, isDir },
        }),
      );
    }

    setPendingDelete(null);
    const parentDir = pathParent(targetPath);
    refreshRoot();
    window.dispatchEvent(new CustomEvent("ftre:tree-refresh", { detail: { dirPath: parentDir } }));
  }, [pendingDelete, addNotification, refreshRoot]);

  const handleOpenFolder = async () => {
    const result = await window.desktop.fs.selectFolder();
    if (result.path) {
      setRootPath(result.path);
    }
  };

  // 提供给 FileTreeItem 的查询函数：从 childrenMap 中取子项
  const getChildren = useCallback(
    (path: string): FileEntry[] => childrenMap.get(path) ?? [],
    [childrenMap],
  );

  // Check if the pending create is at the root level
  const isRootCreate = pendingCreate && rootPath && pendingCreate.dirPath === rootPath;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── 工具栏 ── */}
      <div className="flex items-center px-2 h-[38px] border-b border-border shrink-0 gap-1">
        {/* 文件树按钮 */}
        <button
          onClick={() => setViewMode("files")}
          className={`flex items-center justify-center w-9 h-9 rounded-md ${
            viewMode === "files" ? "bg-white/[0.08] text-t-primary" : "text-t-ghost hover:text-t-muted hover:bg-white/[0.04]"
          }`}
          title="文件"
        >
          <FolderTree size={18} strokeWidth={1.5} />
        </button>

        {/* Git 变更按钮 */}
        <button
          onClick={() => setViewMode("git")}
          className={`relative flex items-center justify-center w-9 h-9 rounded-md ${
            viewMode === "git" ? "bg-white/[0.08] text-t-primary" : "text-t-ghost hover:text-t-muted hover:bg-white/[0.04]"
          }`}
          title="Git 变更"
        >
          <GitBranch size={18} strokeWidth={1.5} />
          {gitChangeCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-neon text-base text-[10px] font-mono font-bold leading-none px-0.5">
              {gitChangeCount > 99 ? "99+" : gitChangeCount}
            </span>
          )}
        </button>

        <div className="flex-1" />
      </div>

      {/* ── 第二行操作按钮栏 ── */}
      {viewMode === "files" && rootPath && (
        <div className="flex items-center px-2 h-[38px] border-b border-border shrink-0 gap-0.5">
          <div className="flex-1" />
          <button
            onClick={handleNewFile}
            className="flex items-center justify-center w-7 h-7 rounded-md text-t-ghost hover:text-t-muted hover:bg-white/[0.04] transition-colors"
            title="新建文件"
          >
            <FilePlus size={16} strokeWidth={1.5} />
          </button>
          <button
            onClick={handleNewFolder}
            className="flex items-center justify-center w-7 h-7 rounded-md text-t-ghost hover:text-t-muted hover:bg-white/[0.04] transition-colors"
            title="新建文件夹"
          >
            <FolderPlus size={16} strokeWidth={1.5} />
          </button>
          <button
            onClick={hasActiveFile ? handleLocateFile : undefined}
            className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
              hasActiveFile
                ? "text-t-ghost hover:text-t-muted hover:bg-white/[0.04] cursor-pointer"
                : "text-t-ghost opacity-40 cursor-not-allowed"
            }`}
            title="定位当前文件"
            disabled={!hasActiveFile}
          >
            <LocateFixed size={16} strokeWidth={1.5} />
          </button>
          <button
            onClick={collapseAll}
            className="flex items-center justify-center w-7 h-7 rounded-md text-t-ghost hover:text-t-muted hover:bg-white/[0.04] transition-colors"
            title="收齐所有文件夹"
          >
            <ChevronsDownUp size={16} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* ── 内容区 — 两个视图始终挂载，CSS display 切换，避免重新挂载的开销 ── */}
      <div
        ref={treeContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden py-1.5"
        style={{ willChange: "transform", contain: "layout style", display: viewMode === "files" ? "block" : "none" }}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {!rootPath && (
          <div className="px-4 py-12 text-center flex flex-col items-center gap-5">
            <span className="text-[13px] text-t-muted font-sans">未打开文件夹</span>
            <button
              onClick={handleOpenFolder}
              className="px-5 py-2 text-[13px] font-sans bg-neon-dim text-neon hover:bg-neon hover:text-base rounded-lg"
            >
              打开文件夹
            </button>
          </div>
        )}
        {entries.map((entry) => (
          <FileTreeItem
            key={entry.path}
            entry={entry}
            depth={0}
            expanded={expandedPaths.has(entry.path)}
            focusedPath={focusedPath}
            focusSeq={focusSeq}
            expandedPaths={expandedPaths}
            onToggle={toggleExpanded}
            childEntries={childrenMap.get(entry.path) ?? []}
            getChildren={getChildren}
            pendingCreate={pendingCreate}
            pendingRename={pendingRename}
            onCreateSubmit={handleCreate}
            onCreateCancel={() => setPendingCreate(null)}
            onRenameSubmit={handleRename}
            onRenameCancel={() => setPendingRename(null)}
            onFocusChange={setFocusedPath}
            siblingNames={pendingCreate || pendingRename ? entries.map((e) => e.name).filter((n) => n !== entry.name) : []}
            dragOverPath={dragOverPath}
            onDragOverChange={setDragOverPath}
          />
        ))}
        {isRootCreate && (
          <InlineInput
            placeholder={pendingCreate.type === "file" ? "文件名" : "文件夹名"}
            depth={0}
            siblingNames={entries.map((e) => e.name)}
            onSubmit={handleCreate}
            onCancel={() => setPendingCreate(null)}
          />
        )}
      </div>
      <div style={{ display: viewMode === "git" ? "contents" : "none" }}>
        <GitChangesView visible={viewMode === "git"} />
      </div>

      {/* Delete confirmation dialog */}
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.isDir ? "删除文件夹" : "删除文件"}
          message={`确定要删除 "${pendingDelete.path.split(/[\\/]/).pop()}" 吗？此操作无法撤销。`}
          confirmLabel="删除"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
