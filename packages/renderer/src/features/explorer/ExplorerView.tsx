import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  FolderTree,
  GitBranch,
  FilePlus,
  FolderPlus,
  LocateFixed,
  ChevronsDownUp,
} from "lucide-react";
import { useWorkspace } from "@/stores/workspace";
import { useNotification } from "@/stores/notification";
import { useEditor } from "@/stores/editor";
import { gitService, useGitService } from "@/services/git-service";
import {
  addFileToIndex,
  removeFileFromIndex,
  renamePathInIndex,
} from "@/services/file-index-service";
import { performanceMetrics } from "@/services/performance-metrics";
import {
  workspaceHash,
  pathSep,
  pathJoin,
  pathParent,
} from "@/utils/pathUtils";
import { FileTreeItem } from "./FileTreeItem";
import { InlineInput } from "./InlineInput";
import { GitChangesView } from "./GitChangesView";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  flattenVisibleEntries,
  getNextFocusPath,
  getParentPath,
} from "./tree-navigation";
import { filterEntries } from "./file-filter";
import type { FlatEntry, TreeEntry } from "./tree-navigation";
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

const TREE_KEY_PREFIX = "ftre-tree-expanded";

/** 按工作区隔离的 localStorage key */
function treeStorageKey(rootPath: string | null): string {
  return rootPath
    ? `${TREE_KEY_PREFIX}:${workspaceHash(rootPath)}`
    : TREE_KEY_PREFIX;
}

function loadExpandedPaths(rootPath: string | null): Set<string> {
  try {
    const raw = localStorage.getItem(treeStorageKey(rootPath));
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      return new Set(arr);
    }
  } catch {
    /* ignore */
  }
  return new Set();
}

let treePersistTimer: ReturnType<typeof setTimeout> | null = null;
function saveExpandedPaths(paths: Set<string>, rootPath: string | null) {
  if (treePersistTimer) clearTimeout(treePersistTimer);
  treePersistTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        treeStorageKey(rootPath),
        JSON.stringify([...paths]),
      );
    } catch {
      /* ignore */
    }
  }, 300);
}

type ViewMode = "files" | "git";

const EXPLORER_ROW_HEIGHT = 32;
const EXPLORER_OVERSCAN = 12;

export function ExplorerView() {
  const { rootPath, setRootPath } = useWorkspace();
  const [viewMode, setViewMode] = useState<ViewMode>("files");
  const gitChangeCount = useGitService((s) => s.getInfo().changedFiles);

  // gitService 跟随工作区切换
  useEffect(() => {
    gitService.setRootPath(rootPath);
  }, [rootPath]);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(
    null,
  );
  const [pendingRename, setPendingRename] = useState<PendingRename | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    loadExpandedPaths(rootPath),
  );
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  // 等待 reveal 的目标路径（当目录异步加载完成后设置焦点）
  const [pendingRevealPath, setPendingRevealPath] = useState<string | null>(
    null,
  );
  const treeContainerRef = useRef<HTMLDivElement>(null);

  const { addNotification } = useNotification();

  // 工作区切换时，重新加载该工作区的文件树展开状态，并清理所有临时状态
  useEffect(() => {
    setExpandedPaths(loadExpandedPaths(rootPath));
    setChildrenMap(new Map());
    setFocusedPath(null);
    setPendingRevealPath(null);
    // 清除所有 pending 状态，避免旧工作区的操作状态残留
    setPendingCreate(null);
    setPendingRename(null);
    setPendingDelete(null);
  }, [rootPath]);

  // ── Children map for keyboard navigation tree ──────────────────────
  const [childrenMap, setChildrenMap] = useState<Map<string, FileEntry[]>>(
    new Map(),
  );
  /** 正在加载中的文件夹路径，防止重复 readDir */
  const loadingDirs = useRef<Set<string>>(new Set());

  // Load children for expanded folders that aren't loaded yet
  useEffect(() => {
    for (const folderPath of expandedPaths) {
      if (
        !childrenMap.has(folderPath) &&
        !loadingDirs.current.has(folderPath)
      ) {
        loadingDirs.current.add(folderPath);
        window.desktop.fs.readDir(folderPath).then((result) => {
          loadingDirs.current.delete(folderPath);
          setChildrenMap((prev) => {
            const next = new Map(prev);
            // 失败时写入空数组，防止无限重试
            next.set(
              folderPath,
              result.error ? [] : filterEntries(result.entries),
            );
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
        children: entry.isDir
          ? buildTree(childrenMap.get(entry.path) ?? [])
          : undefined,
      }));
    return buildTree(entries);
  }, [entries, childrenMap]);

  const flatEntries = useMemo(
    () => flattenVisibleEntries(treeEntries, expandedPaths),
    [treeEntries, expandedPaths],
  );

  const entryMap = useMemo(() => {
    const map = new Map<string, FileEntry>();
    const walk = (items: TreeEntry[]) => {
      for (const item of items) {
        map.set(item.path, item);
        if (item.children) walk(item.children);
      }
    };
    walk(treeEntries);
    return map;
  }, [treeEntries]);

  // 虚拟化策略：始终启用虚拟化，但在 pending 状态时扩展可见范围以包含目标行
  // 这样既保持大型项目的性能，又确保 InlineInput 能正确渲染
  const canVirtualize = !!rootPath;

  // 计算 pending 操作的目标行索引，用于扩展可见范围
  const pendingTargetIndex = useMemo(() => {
    if (pendingCreate) {
      // 新建时目标是父目录的最后一个子项位置
      return flatEntries.findIndex((e) => e.path === pendingCreate.dirPath);
    }
    if (pendingRename) {
      return flatEntries.findIndex((e) => e.path === pendingRename.path);
    }
    if (dragOverPath) {
      return flatEntries.findIndex((e) => e.path === dragOverPath);
    }
    return -1;
  }, [flatEntries, pendingCreate, pendingRename, dragOverPath]);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const totalRows = flatEntries.length;

  // 基础可见范围计算
  const baseStartIndex = Math.max(
    0,
    Math.floor(scrollTop / EXPLORER_ROW_HEIGHT) - EXPLORER_OVERSCAN,
  );
  const baseVisibleCount =
    Math.ceil(viewportHeight / EXPLORER_ROW_HEIGHT) + EXPLORER_OVERSCAN * 2;
  const baseEndIndex = Math.min(totalRows, baseStartIndex + baseVisibleCount);

  // 如果有 pending 操作，扩展范围以包含目标行（前后各 5 行缓冲）
  const PENDING_BUFFER = 5;
  let startIndex = baseStartIndex;
  let endIndex = baseEndIndex;

  if (pendingTargetIndex >= 0) {
    const targetStart = Math.max(0, pendingTargetIndex - PENDING_BUFFER);
    const targetEnd = Math.min(
      totalRows,
      pendingTargetIndex + PENDING_BUFFER + 1,
    );
    startIndex = Math.min(startIndex, targetStart);
    endIndex = Math.max(endIndex, targetEnd);
  }

  const virtualEntries = useMemo(
    () => flatEntries.slice(startIndex, endIndex),
    [flatEntries, startIndex, endIndex],
  );
  const visibleEntries = virtualEntries;

  const topSpacerHeight = startIndex * EXPLORER_ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(
    0,
    (totalRows - endIndex) * EXPLORER_ROW_HEIGHT,
  );

  const toggleExpanded = useCallback(
    (path: string) => {
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
    },
    [rootPath],
  );

  // ── Keyboard navigation handler ─────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
            // 无焦点时按 ArrowUp 应聚焦最后一项（与 ArrowDown 聚焦第一项对称）
            setFocusedPath(flatEntries[flatEntries.length - 1].path);
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
    [
      treeEntries,
      expandedPaths,
      focusedPath,
      setFocusedPath,
      toggleExpanded,
      setPendingRename,
      setPendingCreate,
      setPendingDelete,
    ],
  );

  // ── Load root entries ──────────────────────────────────────────────
  const prevRootRef = useRef<string | null>(null);

  const refreshRoot = useCallback(() => {
    if (!rootPath) return;
    const isNewRoot = prevRootRef.current !== rootPath;
    prevRootRef.current = rootPath;

    const refreshStart = performanceMetrics.start();
    window.desktop.fs.readDir(rootPath).then((result) => {
      setEntries(filterEntries(result.entries));
      performanceMetrics.count("tree.refresh.root");
      performanceMetrics.end("tree.refresh.root.ms", refreshStart);

      // Spec: open_folder — 首次加载新文件夹时自动打开 README
      if (isNewRoot) {
        const readme = result.entries.find(
          (e) => !e.isDir && /^readme(\.\w+)?$/i.test(e.name),
        );
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

  // 用 ref 引用 focusedPath，用于在 tree-refresh 时检查是否需要清理
  const focusedPathRef = useRef(focusedPath);
  focusedPathRef.current = focusedPath;

  useEffect(() => {
    if (!rootPath) return;
    const handler = (e: Event) => {
      const { dirPath, changedPath } = (
        e as CustomEvent<{ dirPath: string; changedPath?: string }>
      ).detail;

      if (changedPath && /[\\/]\.git([\\/]|$)/.test(changedPath)) return;

      performanceMetrics.count("tree.refresh.events");

      if (dirPath === rootPath) {
        refreshRoot();
      }
      // 刷新 childrenMap 中对应路径的数据（如果已加载过）
      if (
        childrenMapRef.current.has(dirPath) ||
        expandedPathsRef.current.has(dirPath)
      ) {
        const refreshStart = performanceMetrics.start();
        window.desktop.fs.readDir(dirPath).then((result) => {
          if (!result.error) {
            const newEntries = filterEntries(result.entries);
            setChildrenMap((prev) => {
              const next = new Map(prev);
              next.set(dirPath, newEntries);
              return next;
            });
            performanceMetrics.count("tree.refresh.child");
            performanceMetrics.end("tree.refresh.dir.ms", refreshStart);

            // 检查 focusedPath 是否仍然存在
            // 如果 focusedPath 的父目录是当前刷新的目录，检查它是否还在新的条目列表中
            const currentFocused = focusedPathRef.current;
            if (currentFocused && pathParent(currentFocused) === dirPath) {
              const stillExists = newEntries.some(
                (e) => e.path === currentFocused,
              );
              if (!stillExists) {
                setFocusedPath(null);
              }
            }
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

      const relativePath = targetPath.startsWith(rootPath)
        ? targetPath.slice(rootPath.length)
        : targetPath;
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

      // 检查目标路径是否已在 flatEntries 中
      // 如果是，直接设置焦点；否则等待目录加载完成
      const isTargetVisible = flatEntries.some((e) => e.path === targetPath);
      if (isTargetVisible) {
        setFocusedPath(targetPath);
        setFocusSeq((s) => s + 1);
        setPendingRevealPath(null);
      } else {
        // 目录还在异步加载中，记录待 reveal 的路径
        setPendingRevealPath(targetPath);
      }
    },
    [rootPath, flatEntries],
  );

  // 当 flatEntries 变化时，检查 pendingRevealPath 是否已可见
  useEffect(() => {
    if (!pendingRevealPath) return;
    const isTargetVisible = flatEntries.some(
      (e) => e.path === pendingRevealPath,
    );
    if (isTargetVisible) {
      setFocusedPath(pendingRevealPath);
      setFocusSeq((s) => s + 1);
      setPendingRevealPath(null);
    }
  }, [flatEntries, pendingRevealPath]);

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

  // ── 定位当前文件（按钮用） ─────────────────────────────────────────
  // 注意：移除了自动定位逻辑（activeFile 变化时自动 revealPath）
  // 原因：自动定位会打断用户在文件树中的浏览，破坏用户上下文
  // 现在用户需要手动点击"定位"按钮来定位当前文件
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
    setFocusedPath(null); // 清理 focusedPath，因为被聚焦的项可能不可见了
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

      const result =
        type === "file"
          ? await window.desktop.fs.createFile(fullPath)
          : await window.desktop.fs.createFolder(fullPath);

      if (!result.success) {
        addNotification({
          level: "error",
          message:
            result.error ||
            (type === "file" ? "创建文件失败" : "创建文件夹失败"),
        });
      }

      // Auto-open newly created files in the editor (not folders)
      if (type === "file" && result.success) {
        addFileToIndex(fullPath);
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

      // 创建成功后自动聚焦到新项目，方便用户立即操作（如重命名、删除等）
      if (result.success) {
        setFocusedPath(fullPath);
      }

      setPendingCreate(null);
      // Refresh via the centralized tree-refresh handler only
      window.dispatchEvent(
        new CustomEvent("ftre:tree-refresh", {
          detail: { dirPath, changedPath: fullPath },
        }),
      );
    },
    [pendingCreate, addNotification],
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
        renamePathInIndex(oldPath, newPath, pendingRename.isDir);
        // 如果重命名的是当前聚焦的项，更新 focusedPath 到新路径
        if (focusedPath === oldPath) {
          setFocusedPath(newPath);
        } else if (
          focusedPath?.startsWith(oldPath + "/") ||
          focusedPath?.startsWith(oldPath + "\\")
        ) {
          // 如果聚焦的是被重命名目录的子项，也需要更新路径
          const relativePath = focusedPath.slice(oldPath.length);
          setFocusedPath(newPath + relativePath);
        }
        // Notify editor to update open tabs (task 2.4 handles this)
        window.dispatchEvent(
          new CustomEvent("ftre:file-renamed", {
            detail: { oldPath, newPath, isDir: pendingRename.isDir },
          }),
        );
      }

      setPendingRename(null);
      window.dispatchEvent(
        new CustomEvent("ftre:tree-refresh", {
          detail: { dirPath: parentDir, changedPath: newPath },
        }),
      );
    },
    [pendingRename, addNotification, focusedPath],
  );

  // ── 检查路径下是否有未保存的更改 ────────────────────────────────────
  const hasUnsavedChanges = useCallback(
    (targetPath: string, isDir: boolean): boolean => {
      const openFiles = useEditor.getState().openFiles;
      return openFiles.some((f) => {
        if (!f.modified) return false;
        if (isDir) {
          // 检查是否是目标目录下的文件
          return (
            f.path === targetPath ||
            f.path.startsWith(targetPath + "/") ||
            f.path.startsWith(targetPath + "\\")
          );
        }
        return f.path === targetPath;
      });
    },
    [],
  );

  // ── Handle delete ──────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const { path: targetPath, isDir } = pendingDelete;

    // 检查是否有未保存的更改
    if (hasUnsavedChanges(targetPath, isDir)) {
      const fileName = targetPath.split(/[\\/]/).pop();
      const confirmDelete = window.confirm(
        `"${fileName}" 有未保存的更改，确定要删除吗？`,
      );
      if (!confirmDelete) {
        setPendingDelete(null);
        return;
      }
    }

    const result = await window.desktop.fs.delete(targetPath, isDir);

    if (!result.success) {
      addNotification({
        level: "error",
        message: result.error || "删除失败",
      });
    } else {
      removeFileFromIndex(targetPath, isDir);
      // 如果删除的是当前聚焦的项，清理 focusedPath
      if (
        focusedPath === targetPath ||
        focusedPath?.startsWith(targetPath + "/") ||
        focusedPath?.startsWith(targetPath + "\\")
      ) {
        setFocusedPath(null);
      }
      // Notify editor to close open tabs (task 2.4 handles this)
      window.dispatchEvent(
        new CustomEvent("ftre:file-deleted", {
          detail: { path: targetPath, isDir },
        }),
      );
    }

    setPendingDelete(null);
    const parentDir = pathParent(targetPath);
    window.dispatchEvent(
      new CustomEvent("ftre:tree-refresh", {
        detail: { dirPath: parentDir, changedPath: targetPath },
      }),
    );
  }, [pendingDelete, addNotification, focusedPath, hasUnsavedChanges]);

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

  const getSiblingNames = useCallback(
    (flatEntry: FlatEntry): string[] => {
      if (!(pendingCreate || pendingRename)) return [];
      if (!flatEntry.parentPath) {
        return entries
          .map((entry) => entry.name)
          .filter((name) => name !== flatEntry.name);
      }
      const siblings = childrenMap.get(flatEntry.parentPath) ?? [];
      return siblings
        .map((entry) => entry.name)
        .filter((name) => name !== flatEntry.name);
    },
    [pendingCreate, pendingRename, entries, childrenMap],
  );

  useEffect(() => {
    const el = treeContainerRef.current;
    if (!el) return;

    let rafId: number | null = null;

    const syncViewport = () => {
      setViewportHeight(el.clientHeight);
      setScrollTop(el.scrollTop);
    };

    // 使用 requestAnimationFrame 节流滚动事件，避免频繁渲染
    const handleScroll = () => {
      if (rafId !== null) return; // 已有待处理的帧，跳过
      rafId = requestAnimationFrame(() => {
        rafId = null;
        syncViewport();
      });
    };

    syncViewport();
    el.addEventListener("scroll", handleScroll, { passive: true });

    const ro = new ResizeObserver(() => syncViewport());
    ro.observe(el);

    return () => {
      el.removeEventListener("scroll", handleScroll);
      ro.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    if (!canVirtualize) return;
    if (!focusedPath) return;
    const el = treeContainerRef.current;
    if (!el) return;

    const index = flatEntries.findIndex((entry) => entry.path === focusedPath);
    if (index === -1) return;

    const rowTop = index * EXPLORER_ROW_HEIGHT;
    const rowBottom = rowTop + EXPLORER_ROW_HEIGHT;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;

    if (rowTop >= viewTop && rowBottom <= viewBottom) return;

    const targetScrollTop = Math.max(
      0,
      rowTop - Math.max(0, (el.clientHeight - EXPLORER_ROW_HEIGHT) / 2),
    );
    el.scrollTo({ top: targetScrollTop });
  }, [canVirtualize, focusedPath, focusSeq, flatEntries]);

  // Check if the pending create is at the root level
  const isRootCreate =
    pendingCreate && rootPath && pendingCreate.dirPath === rootPath;

  // 自动展开 pendingCreate 的目标目录（虚拟化模式下 FileTreeItem 收不到 pendingCreate，需要在这里处理）
  useEffect(() => {
    if (pendingCreate && !isRootCreate) {
      const dirPath = pendingCreate.dirPath;
      if (!expandedPaths.has(dirPath)) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.add(dirPath);
          saveExpandedPaths(next, rootPath);
          return next;
        });
      }
    }
  }, [pendingCreate, isRootCreate, expandedPaths, rootPath]);

  // 计算非根目录的 pendingCreate 需要渲染的位置和 depth
  const pendingCreateInfo = useMemo(() => {
    if (!pendingCreate || isRootCreate) return null;
    // 找到目标目录在 flatEntries 中的位置
    const dirIndex = flatEntries.findIndex(
      (e) => e.path === pendingCreate.dirPath,
    );
    if (dirIndex === -1) return null;
    const dirEntry = flatEntries[dirIndex];
    // InlineInput 应该在目标目录的所有子项之后
    // 找到最后一个属于该目录的子项
    let insertAfterIndex = dirIndex;
    for (let i = dirIndex + 1; i < flatEntries.length; i++) {
      if (flatEntries[i].depth <= dirEntry.depth) break;
      insertAfterIndex = i;
    }
    return {
      insertAfterIndex,
      depth: dirEntry.depth + 1,
      siblingNames: getChildren(pendingCreate.dirPath).map((c) => c.name),
    };
  }, [pendingCreate, isRootCreate, flatEntries, getChildren]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── 工具栏 ── */}
      <div className="flex items-center px-2 h-[38px] border-b border-border shrink-0 gap-1">
        {/* 文件树按钮 */}
        <button
          onClick={() => setViewMode("files")}
          className={`flex items-center justify-center w-9 h-9 rounded-md ${
            viewMode === "files"
              ? "bg-white/[0.08] text-t-primary"
              : "text-t-ghost hover:text-t-muted hover:bg-white/[0.04]"
          }`}
          title="文件"
        >
          <FolderTree size={18} strokeWidth={1.5} />
        </button>

        {/* Git 变更按钮 */}
        <button
          onClick={() => setViewMode("git")}
          className={`relative flex items-center justify-center w-9 h-9 rounded-md ${
            viewMode === "git"
              ? "bg-white/[0.08] text-t-primary"
              : "text-t-ghost hover:text-t-muted hover:bg-white/[0.04]"
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
        style={{
          willChange: "transform",
          contain: "layout style",
          display: viewMode === "files" ? "block" : "none",
        }}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {!rootPath && (
          <div className="px-4 py-12 text-center flex flex-col items-center gap-5">
            <span className="text-[13px] text-t-muted font-sans">
              未打开文件夹
            </span>
            <button
              onClick={handleOpenFolder}
              className="px-5 py-2 text-[13px] font-sans bg-neon-dim text-neon hover:bg-neon hover:text-base rounded-lg"
            >
              打开文件夹
            </button>
          </div>
        )}
        {canVirtualize && topSpacerHeight > 0 && (
          <div style={{ height: topSpacerHeight }} aria-hidden="true" />
        )}
        {visibleEntries.map((flatEntry, idx) => {
          const entry = entryMap.get(flatEntry.path);
          if (!entry) return null;

          // 计算当前条目在 flatEntries 中的真实索引
          const realIndex = startIndex + idx;

          // 检查是否需要在此条目之后渲染 InlineInput
          const shouldRenderInlineInput =
            pendingCreateInfo &&
            realIndex === pendingCreateInfo.insertAfterIndex;

          return (
            <React.Fragment key={entry.path}>
              <FileTreeItem
                key={entry.path}
                entry={entry}
                depth={flatEntry.depth}
                expanded={flatEntry.expanded}
                focusedPath={focusedPath}
                focusSeq={focusSeq}
                expandedPaths={canVirtualize ? new Set() : expandedPaths}
                onToggle={toggleExpanded}
                childEntries={[]}
                getChildren={() => []}
                pendingCreate={null}
                pendingRename={pendingRename}
                onCreateSubmit={handleCreate}
                onCreateCancel={() => setPendingCreate(null)}
                onRenameSubmit={handleRename}
                onRenameCancel={() => setPendingRename(null)}
                onFocusChange={setFocusedPath}
                siblingNames={getSiblingNames(flatEntry)}
                dragOverPath={dragOverPath}
                onDragOverChange={setDragOverPath}
              />
              {shouldRenderInlineInput && (
                <InlineInput
                  placeholder={
                    pendingCreate!.type === "file" ? "文件名" : "文件夹名"
                  }
                  depth={pendingCreateInfo.depth}
                  siblingNames={pendingCreateInfo.siblingNames}
                  onSubmit={handleCreate}
                  onCancel={() => setPendingCreate(null)}
                />
              )}
            </React.Fragment>
          );
        })}
        {bottomSpacerHeight > 0 && (
          <div style={{ height: bottomSpacerHeight }} aria-hidden="true" />
        )}
        {/* 根目录的 InlineInput：在底部渲染 */}
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
