import { useState, useCallback, useEffect, useRef, memo, useMemo } from "react";
import {
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
  ClipboardCopy,
  FileText,
  Terminal,
  FolderOpen,
} from "lucide-react";
import { editorCore, editorManager } from "@ftre/editor/core";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { useNotification } from "@/stores/notification";
import { getFileIcon } from "@/lib/file-icons";
import { useGitService } from "@/services/git-service";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { InlineInput } from "./InlineInput";
import { canDrop, resolveDropTarget } from "./drag-drop-utils";
import { pathSep, pathJoin, pathParent } from "@/utils/pathUtils";
import { treeIndent } from "./tree-constants";
import type { FileEntry } from "@/types";

// 简单的扩展名到语言映射（与 electron/src/ipc/fs.ts 保持一致）
const EXT_LANGUAGE_MAP: Record<string, string> = {
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
  vue: "vue",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  txt: "plaintext",
};

function extToLanguage(ext: string): string {
  return EXT_LANGUAGE_MAP[ext.toLowerCase()] || "plaintext";
}

/**
 * Module-level variable to hold drag data during a drag operation.
 * We use this because `dataTransfer.getData()` is not available in
 * `dragOver` events in some browsers (only in `drop`).
 */
let currentDragData: { sourcePath: string; isDir: boolean } | null = null;

// 全局 dragend 兜底清理：即使 handleDragEnd 不触发（如浏览器失焦、跨窗口拖拽），
// 也能确保 currentDragData 被清理
document.addEventListener("dragend", () => {
  currentDragData = null;
});

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

interface FileTreeItemProps {
  entry: FileEntry;
  depth: number;
  expanded: boolean; // 由父组件控制
  focusedPath: string | null; // 当前焦点路径
  focusSeq?: number; // 递增计数器，用于强制触发 scrollIntoView
  expandedPaths: Set<string>; // 所有展开路径（用于递归子项）
  onToggle: (path: string) => void; // 展开/折叠回调
  /** 由父组件从 childrenMap 传入的子项列表（纯展示，不自行加载） */
  childEntries: FileEntry[];
  /** 查询某个子路径的 children（从 childrenMap 中取） */
  getChildren: (path: string) => FileEntry[];
  pendingCreate?: PendingCreate | null;
  pendingRename?: PendingRename | null;
  onCreateSubmit?: (name: string) => void;
  onCreateCancel?: () => void;
  onRenameSubmit?: (newName: string) => void;
  onRenameCancel?: () => void;
  onFocusChange?: (path: string) => void; // 点击时更新焦点路径
  siblingNames?: string[]; // 同级文件名（用于重命名时的重名检测，排除自身）
  // 拖拽相关
  dragOverPath?: string | null; // 当前拖拽悬停的目标路径
  onDragOverChange?: (path: string | null) => void; // 更新拖拽悬停路径
}

export const FileTreeItem = memo(function FileTreeItem({
  entry,
  depth,
  expanded,
  focusedPath,
  focusSeq,
  expandedPaths,
  onToggle,
  childEntries,
  getChildren,
  pendingCreate,
  pendingRename,
  onCreateSubmit,
  onCreateCancel,
  onRenameSubmit,
  onRenameCancel,
  onFocusChange,
  siblingNames,
  dragOverPath,
  onDragOverChange,
}: FileTreeItemProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const openFile = useEditor((s) => s.openFile);
  const activeFile = useEditor((s) => s.activeFile);
  const rootPath = useWorkspace((s) => s.rootPath);

  /** Compute path relative to workspace root */
  const getRelativePath = useCallback(
    (absolutePath: string): string => {
      if (!rootPath) return absolutePath;
      const normalizedAbs = absolutePath.replace(/\\/g, "/");
      const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
      if (normalizedAbs.startsWith(normalizedRoot + "/")) {
        return normalizedAbs.slice(normalizedRoot.length + 1);
      }
      return absolutePath;
    },
    [rootPath],
  );

  const realActiveFile = activeFile?.startsWith("diff:")
    ? activeFile.slice(5)
    : activeFile;
  const isActive = realActiveFile === entry.path;
  const isFocused = focusedPath === entry.path;
  const isRenaming = pendingRename?.path === entry.path;
  const itemRef = useRef<HTMLDivElement>(null);
  const autoExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载时清理所有定时器
  useEffect(() => {
    return () => {
      if (autoExpandTimerRef.current) clearTimeout(autoExpandTimerRef.current);
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    };
  }, []);

  // Git status 着色 — O(1) 查询预计算的 statusMap
  const gitStatus = useGitService((s) => {
    const fileStatus = s.getFileStatus(entry.path);
    if (fileStatus) return fileStatus;
    if (entry.isDir) return s.getDirStatus(entry.path) ?? null;
    return null;
  });

  const GIT_COLORS: Record<string, string> = {
    modified: "#e2c08d",
    untracked: "#73c991",
    deleted: "#c74e39",
    added: "#73c991",
    renamed: "#73c991",
    conflict: "#e4676b",
  };
  const GIT_LABELS: Record<string, string> = {
    modified: "M",
    untracked: "U",
    deleted: "D",
    added: "A",
    renamed: "R",
    conflict: "C",
  };
  const gitColor = gitStatus ? GIT_COLORS[gitStatus] : undefined;
  const gitLabel = gitStatus ? GIT_LABELS[gitStatus] : undefined;

  // Indentation and file icon
  const paddingLeft = treeIndent(depth);
  const { icon: Icon, color } = getFileIcon(entry.name, entry.isDir, expanded);

  // Auto-scroll into view when this item is focused (via keyboard nav or locate button)
  // 注意：移除了 isActive 触发滚动的逻辑
  // 原因：isActive 表示编辑器当前打开的文件，不应该触发文件树滚动
  // 只有 isFocused（用户主动定位或键盘导航）才应该滚动
  useEffect(() => {
    if (isFocused && itemRef.current) {
      const el = itemRef.current;
      const container = el.closest('[class*="overflow-y-auto"]');
      if (!container) return;
      const rect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      // 只在元素不在可视区域内时才滚动到中间
      if (rect.top < containerRect.top || rect.bottom > containerRect.bottom) {
        el.scrollIntoView({ block: "center" });
      }
    }
    // focusSeq: 即使 isFocused 值不变，seq 递增也能重新触发 scroll
  }, [isFocused, focusSeq]);

  // Auto-expand folder when a create operation targets it
  useEffect(() => {
    if (
      pendingCreate &&
      pendingCreate.dirPath === entry.path &&
      entry.isDir &&
      !expanded
    ) {
      onToggle(entry.path);
    }
  }, [pendingCreate, entry.isDir, entry.path, expanded, onToggle]);

  const toggle = useCallback(() => {
    if (!entry.isDir) return;
    onToggle(entry.path);
  }, [entry.isDir, entry.path, onToggle]);

  // 预读取：鼠标悬停文件时提前加载内容到缓存（减少点击时的等待）
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchedRef = useRef(false);

  const handleMouseEnter = useCallback(() => {
    // 只对文件生效，跳过目录
    if (entry.isDir) return;
    // 已经缓存过则跳过
    if (editorCore.hasContent(entry.path)) return;
    // 已经预读取过则跳过
    if (prefetchedRef.current) return;

    // 延迟 150ms 再预读取，避免快速划过时的无效请求
    prefetchTimerRef.current = setTimeout(async () => {
      if (editorCore.hasContent(entry.path)) return;
      try {
        const result = await window.desktop.fs.readFile(entry.path);
        if (!result.error) {
          // 预存到 editorCore 缓存，打开时直接使用
          editorCore.setContent(entry.path, result.content);
          editorCore.setDiskContent(entry.path, result.content);
          // 预加载 Monaco model（跳过 model 创建开销，打开时直接复用）
          const ext = entry.path.split(".").pop() ?? "";
          const lang = extToLanguage(ext);
          editorManager.preloadModel(entry.path, result.content, lang);
          prefetchedRef.current = true;
        }
      } catch {
        // 预读取失败静默忽略，不影响正常流程
      }
    }, 150);
  }, [entry.path, entry.isDir]);

  const handleMouseLeave = useCallback(() => {
    // 取消未完成的预读取
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  }, []);

  const handleClick = useCallback(async () => {
    onFocusChange?.(entry.path);
    if (entry.isDir) {
      toggle();
      return;
    }

    // 优先使用预读取的缓存内容
    if (editorCore.hasContent(entry.path)) {
      const cachedContent = editorCore.getContent(entry.path);
      // 还需要获取 language，从文件扩展名推断
      const ext = entry.name.split(".").pop() || "";
      const language = extToLanguage(ext);
      openFile({
        path: entry.path,
        name: entry.name,
        language,
        content: cachedContent,
      });
      return;
    }

    // 没有缓存则正常读取
    const result = await window.desktop.fs.readFile(entry.path);
    if (!result.error) {
      openFile({
        path: entry.path,
        name: entry.name,
        language: result.language,
        content: result.content,
      });
    }
  }, [entry, toggle, openFile, onFocusChange]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // ── Drag & Drop handlers ───────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      const dragData = { sourcePath: entry.path, isDir: entry.isDir };
      currentDragData = dragData;
      e.dataTransfer.setData("application/json", JSON.stringify(dragData));
      e.dataTransfer.effectAllowed = "move";
    },
    [entry.path, entry.isDir],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!currentDragData) {
        e.dataTransfer.dropEffect = "none";
        return;
      }

      const targetDir = resolveDropTarget(entry.path, entry.isDir);
      if (!canDrop(currentDragData.sourcePath, targetDir)) {
        e.dataTransfer.dropEffect = "none";
        return;
      }

      e.dataTransfer.dropEffect = "move";
      e.stopPropagation();
      // Notify parent of the drag-over target for visual feedback
      // 始终高亮当前悬停的项（无论是文件还是目录），让用户清楚知道鼠标在哪
      // 实际 drop 时会根据 resolveDropTarget 计算目标目录
      onDragOverChange?.(entry.path);

      // 拖拽悬停在折叠文件夹上 800ms 后自动展开
      if (entry.isDir && !expanded && !autoExpandTimerRef.current) {
        autoExpandTimerRef.current = setTimeout(() => {
          autoExpandTimerRef.current = null;
          onToggle(entry.path);
        }, 800);
      }
    },
    [entry.path, entry.isDir, expanded, onDragOverChange, onToggle],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      // Only clear if we're actually leaving this element (not entering a child)
      const related = e.relatedTarget as Node | null;
      if (related && (e.currentTarget as Node).contains(related)) return;
      onDragOverChange?.(null);
      // 离开时取消自动展开定时器
      if (autoExpandTimerRef.current) {
        clearTimeout(autoExpandTimerRef.current);
        autoExpandTimerRef.current = null;
      }
    },
    [onDragOverChange],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onDragOverChange?.(null);
      if (autoExpandTimerRef.current) {
        clearTimeout(autoExpandTimerRef.current);
        autoExpandTimerRef.current = null;
      }

      let dragData: { sourcePath: string; isDir: boolean };
      try {
        dragData = JSON.parse(e.dataTransfer.getData("application/json"));
      } catch {
        return;
      }

      const targetDir = resolveDropTarget(entry.path, entry.isDir);
      if (!canDrop(dragData.sourcePath, targetDir)) return;

      // Build the new path: targetDir + source file/folder name
      const sourceName =
        dragData.sourcePath.split(/[\\/]/).pop() ?? dragData.sourcePath;
      const newPath = pathJoin(targetDir, sourceName);

      // Same destination — no-op
      if (newPath === dragData.sourcePath) return;

      const result = await window.desktop.fs.rename(
        dragData.sourcePath,
        newPath,
      );

      if (!result.success) {
        useNotification.getState().addNotification({
          level: "error",
          message: result.error || "移动失败",
        });
      } else {
        // Notify editor about the move so open tabs update
        window.dispatchEvent(
          new CustomEvent("ftre:file-renamed", {
            detail: {
              oldPath: dragData.sourcePath,
              newPath,
              isDir: dragData.isDir,
            },
          }),
        );
      }

      // Refresh affected directories
      const sourceParent = pathParent(dragData.sourcePath);
      window.dispatchEvent(
        new CustomEvent("ftre:tree-refresh", {
          detail: { dirPath: sourceParent },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("ftre:tree-refresh", {
          detail: { dirPath: targetDir },
        }),
      );

      // 清理拖拽数据，防止残留
      currentDragData = null;
    },
    [entry.path, entry.isDir, onDragOverChange],
  );

  const handleDragEnd = useCallback(() => {
    currentDragData = null;
    onDragOverChange?.(null);
  }, [onDragOverChange]);

  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    if (entry.isDir) {
      return [
        {
          id: "new-file",
          label: "新建文件",
          icon: FilePlus,
          action: () =>
            window.dispatchEvent(
              new CustomEvent("ftre:new-file", {
                detail: { dirPath: entry.path },
              }),
            ),
        },
        {
          id: "new-folder",
          label: "新建文件夹",
          icon: FolderPlus,
          action: () =>
            window.dispatchEvent(
              new CustomEvent("ftre:new-folder", {
                detail: { dirPath: entry.path },
              }),
            ),
        },
        { id: "sep1", label: "", separator: true, action: () => {} },
        {
          id: "rename",
          label: "重命名",
          icon: Pencil,
          shortcut: "F2",
          action: () =>
            window.dispatchEvent(
              new CustomEvent("ftre:file-rename", {
                detail: { path: entry.path, isDir: true },
              }),
            ),
        },
        {
          id: "delete",
          label: "删除",
          icon: Trash2,
          shortcut: "Delete",
          action: () =>
            window.dispatchEvent(
              new CustomEvent("ftre:file-delete", {
                detail: { path: entry.path, isDir: true },
              }),
            ),
        },
        { id: "sep2", label: "", separator: true, action: () => {} },
        {
          id: "copy-path",
          label: "复制路径",
          icon: Copy,
          shortcut: "Ctrl+Shift+C",
          action: () => navigator.clipboard.writeText(entry.path),
        },
        {
          id: "copy-relative-path",
          label: "复制相对路径",
          icon: ClipboardCopy,
          action: () =>
            navigator.clipboard.writeText(getRelativePath(entry.path)),
        },
        { id: "sep3", label: "", separator: true, action: () => {} },
        {
          id: "reveal-explorer",
          label: "在文件管理器中显示",
          icon: FolderOpen,
          action: () => window.desktop.fs.revealInExplorer(entry.path),
        },
        {
          id: "open-terminal",
          label: "在终端中打开",
          icon: Terminal,
          action: () =>
            window.dispatchEvent(
              new CustomEvent("ftre:open-terminal-at", {
                detail: { dirPath: entry.path },
              }),
            ),
        },
      ];
    }

    return [
      {
        id: "open",
        label: "打开",
        icon: FileText,
        action: () => handleClick(),
      },
      { id: "sep1", label: "", separator: true, action: () => {} },
      {
        id: "rename",
        label: "重命名",
        icon: Pencil,
        shortcut: "F2",
        action: () =>
          window.dispatchEvent(
            new CustomEvent("ftre:file-rename", {
              detail: { path: entry.path, isDir: false },
            }),
          ),
      },
      {
        id: "delete",
        label: "删除",
        icon: Trash2,
        shortcut: "Delete",
        action: () =>
          window.dispatchEvent(
            new CustomEvent("ftre:file-delete", {
              detail: { path: entry.path, isDir: false },
            }),
          ),
      },
      { id: "sep2", label: "", separator: true, action: () => {} },
      {
        id: "copy-path",
        label: "复制路径",
        icon: Copy,
        shortcut: "Ctrl+Shift+C",
        action: () => navigator.clipboard.writeText(entry.path),
      },
      {
        id: "copy-relative-path",
        label: "复制相对路径",
        icon: ClipboardCopy,
        action: () =>
          navigator.clipboard.writeText(getRelativePath(entry.path)),
      },
      { id: "sep3", label: "", separator: true, action: () => {} },
      {
        id: "open-terminal",
        label: "在终端中打开",
        icon: Terminal,
        action: () => {
          const dirPath = pathParent(entry.path);
          window.dispatchEvent(
            new CustomEvent("ftre:open-terminal-at", { detail: { dirPath } }),
          );
        },
      },
      {
        id: "reveal-explorer",
        label: "在文件管理器中显示",
        icon: FolderOpen,
        action: () => window.desktop.fs.revealInExplorer(entry.path),
      },
    ];
  }, [entry, handleClick]);

  // 计算重命名时的 siblingNames（排除自身）
  const renameSiblingNames = useMemo(() => {
    if (!isRenaming) return [];
    return siblingNames;
  }, [isRenaming, siblingNames]);

  // 重命名模式：渲染 InlineInput 替换整个行
  if (isRenaming && onRenameSubmit && onRenameCancel) {
    return (
      <>
        <InlineInput
          initialValue={entry.name}
          placeholder="文件名"
          depth={depth}
          siblingNames={renameSiblingNames}
          onSubmit={onRenameSubmit}
          onCancel={onRenameCancel}
        />
        {/* 重命名时仍需渲染子项和 pendingCreate 的 InlineInput */}
        {expanded &&
          childEntries.map((child) => (
            <FileTreeItem
              key={child.path}
              entry={child}
              depth={depth + 1}
              expanded={expandedPaths.has(child.path)}
              focusedPath={focusedPath}
              focusSeq={focusSeq}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
              childEntries={getChildren(child.path)}
              getChildren={getChildren}
              pendingCreate={pendingCreate}
              pendingRename={pendingRename}
              onCreateSubmit={onCreateSubmit}
              onCreateCancel={onCreateCancel}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              onFocusChange={onFocusChange}
              siblingNames={
                pendingCreate || pendingRename
                  ? childEntries
                      .map((c) => c.name)
                      .filter((n) => n !== child.name)
                  : []
              }
              dragOverPath={dragOverPath}
              onDragOverChange={onDragOverChange}
            />
          ))}
        {pendingCreate &&
          pendingCreate.dirPath === entry.path &&
          expanded &&
          onCreateSubmit &&
          onCreateCancel && (
            <InlineInput
              placeholder={
                pendingCreate.type === "file" ? "文件名" : "文件夹名"
              }
              depth={depth + 1}
              siblingNames={childEntries.map((c) => c.name)}
              onSubmit={onCreateSubmit}
              onCancel={onCreateCancel}
            />
          )}
      </>
    );
  }

  return (
    <>
      <div
        ref={itemRef}
        draggable
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        style={{
          paddingLeft,
          contentVisibility: "auto",
          containIntrinsicSize: "auto 32px",
        }}
        className={`flex items-center gap-2 pr-3 h-[32px] cursor-pointer text-[15px] select-none rounded-[4px] mx-0.5 font-sans ${
          isActive
            ? "bg-white/[0.1] text-white"
            : "text-neutral-300 hover:bg-white/[0.05] hover:text-white"
        }${isFocused && !isActive ? " bg-white/[0.05]" : ""}${isFocused ? " ring-1 ring-white/[0.1]" : ""}${
          dragOverPath === entry.path ? " bg-neon/8 ring-1 ring-neon/30" : ""
        }`}
      >
        {entry.isDir && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className={`shrink-0 text-t-muted ${expanded ? "rotate-90" : ""}`}
          >
            <path
              d="M3 1.5L7.5 5L3 8.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <Icon size={16} className="shrink-0" style={{ color }} />
        <span
          className="overflow-hidden text-ellipsis whitespace-nowrap leading-snug"
          style={gitColor ? { color: gitColor } : undefined}
        >
          {entry.name}
        </span>
        {gitLabel && (
          <span
            className="ml-auto shrink-0 text-[11px] font-mono font-semibold leading-none opacity-70"
            style={{ color: gitColor }}
          >
            {gitLabel}
          </span>
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          items={getContextMenuItems()}
          position={contextMenu}
          onClose={closeContextMenu}
        />
      )}
      {expanded &&
        childEntries.map((child) => (
          <FileTreeItem
            key={child.path}
            entry={child}
            depth={depth + 1}
            expanded={expandedPaths.has(child.path)}
            focusedPath={focusedPath}
            focusSeq={focusSeq}
            expandedPaths={expandedPaths}
            onToggle={onToggle}
            childEntries={getChildren(child.path)}
            getChildren={getChildren}
            pendingCreate={pendingCreate}
            pendingRename={pendingRename}
            onCreateSubmit={onCreateSubmit}
            onCreateCancel={onCreateCancel}
            onRenameSubmit={onRenameSubmit}
            onRenameCancel={onRenameCancel}
            onFocusChange={onFocusChange}
            siblingNames={
              pendingCreate || pendingRename
                ? childEntries
                    .map((c) => c.name)
                    .filter((n) => n !== child.name)
                : []
            }
            dragOverPath={dragOverPath}
            onDragOverChange={onDragOverChange}
          />
        ))}
      {/* Inline input for creating inside this folder */}
      {pendingCreate &&
        pendingCreate.dirPath === entry.path &&
        expanded &&
        onCreateSubmit &&
        onCreateCancel && (
          <InlineInput
            placeholder={pendingCreate.type === "file" ? "文件名" : "文件夹名"}
            depth={depth + 1}
            siblingNames={childEntries.map((c) => c.name)}
            onSubmit={onCreateSubmit}
            onCancel={onCreateCancel}
          />
        )}
    </>
  );
});
