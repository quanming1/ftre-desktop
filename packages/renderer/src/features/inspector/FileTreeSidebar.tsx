/**
 * FileTreeSidebar — Inspector 面板左侧的文件树侧边栏
 *
 * 懒加载：点击展开目录时才 readDir，不预扫整个工作区。
 * 工作区来源与 WorkspaceBadge 一致：session DB workspace 字段。
 */
import { useState, useCallback, useEffect, memo, useMemo } from "react";
import { ChevronRight, Folder, FolderOpen, File as FileIcon, Copy, Eye, FolderTree } from "lucide-react";
import { useSession } from "@/stores/session";
import { useChat, useSessionId } from "@/stores/chat";
import { useInspector } from "@/stores/inspector";
import { getFileIcon } from "@/lib/file-icons";
import { fetchAppConfig } from "@/services/api";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";

// ── Git 状态标记 ──────────────────────────────────────────────────

/** 文件级 git 状态：直接来自 git:status 的 GitFileStatus.status */
type GitStatus = "modified" | "untracked" | "added" | "deleted" | "renamed" | "conflict";

/** 目录级聚合状态：子树中有变更则标记 */
type DirGitStatus = "modified" | "untracked" | "mixed" | null;

const GIT_STATUS_LABEL: Record<GitStatus, string> = {
  modified: "M",
  untracked: "U",
  added: "A",
  deleted: "D",
  renamed: "R",
  conflict: "C",
};

const GIT_STATUS_COLOR: Record<GitStatus, string> = {
  modified: "text-amber-500",
  untracked: "text-t-ghost",
  added: "text-green-600",
  deleted: "text-red-500",
  renamed: "text-blue-500",
  conflict: "text-purple-500",
};

/** 文件名颜色：git 状态对应的 hex 色 */
const GIT_FILENAME_COLOR: Record<GitStatus, string> = {
  modified: "#d97706",
  untracked: "#6b7280",
  added: "#16a34a",
  deleted: "#dc2626",
  renamed: "#2563eb",
  conflict: "#9333ea",
};

/** 目录名颜色：目录聚合状态对应的 hex 色 */
const DIR_STATUS_COLOR: Record<DirGitStatus, string> = {
  modified: "#d97706",
  untracked: "#6b7280",
  mixed: "#6b7280",
};

/**
 * 构建路径到 git 状态的映射。
 * git:status 返回的 absolutePath 是绝对路径（可能含正斜杠或反斜杠）。
 * 同时构建目录前缀 map，用于目录级聚合。
 */
function buildGitStatusMap(
  files: { absolutePath: string; status: string; isDir: boolean }[],
  workspace: string,
): Map<string, GitStatus> {
  const map = new Map<string, GitStatus>();
  const ws = workspace.replace(/\\/g, "/").toLowerCase();
  for (const f of files) {
    const normalized = f.absolutePath.replace(/\\/g, "/");
    map.set(normalized, f.status as GitStatus);
    // 也用小写做 key 方便查表（路径大小写在 Windows 不敏感）
    map.set(normalized.toLowerCase(), f.status as GitStatus);
  }
  return map;
}

/** 查询路径的文件级 git 状态 */
function getFileGitStatus(path: string, map: Map<string, GitStatus>): GitStatus | null {
  const normalized = path.replace(/\\/g, "/");
  return map.get(normalized) ?? map.get(normalized.toLowerCase()) ?? null;
}

/** 查询路径的目录级聚合 git 状态：子树中有任何变更则返回 */
function getDirGitStatus(path: string, map: Map<string, GitStatus>): DirGitStatus {
  const prefix = path.replace(/\\/g, "/").toLowerCase() + "/";
  let hasModified = false;
  let hasUntracked = false;
  let hasOther = false;
  for (const [key, status] of map) {
    if (!key.toLowerCase().startsWith(prefix)) continue;
    if (status === "modified" || status === "added" || status === "deleted" || status === "renamed" || status === "conflict") {
      hasModified = true;
    } else if (status === "untracked") {
      hasUntracked = true;
    }
    if (hasModified && hasUntracked) break;
  }
  if (hasModified && hasUntracked) return "mixed";
  if (hasModified) return "modified";
  if (hasUntracked) return "untracked";
  return null;
}

function DirGitBadge({ status }: { status: DirGitStatus }) {
  if (!status) return null;
  const label = status === "mixed" ? "*" : status === "modified" ? "M" : "U";
  const color = status === "modified" ? "text-amber-500" : status === "untracked" ? "text-t-ghost" : "text-t-ghost";
  return <span className={`ml-auto shrink-0 text-[10px] font-mono font-bold ${color} opacity-60`}>{label}</span>;
}

function FileGitBadge({ status }: { status: GitStatus | null }) {
  if (!status) return null;
  return (
    <span className={`ml-auto shrink-0 text-[10px] font-mono font-bold ${GIT_STATUS_COLOR[status]}`}>
      {GIT_STATUS_LABEL[status]}
    </span>
  );
}

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico",
]);

const BINARY_EXTS = new Set([
  "exe", "dll", "so", "dylib", "bin", "obj", "o", "a", "lib",
  "zip", "gz", "tar", "rar", "7z", "bz2",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "mp3", "mp4", "avi", "mov", "wav", "flac", "ogg",
  "ttf", "otf", "woff", "woff2", "eot",
  "pyc", "class", "jar", "wasm",
  "sqlite", "db", "mdb",
]);

function getExt(path: string): string {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m?.[1] ?? "";
}

function isImageFile(path: string): boolean {
  return IMAGE_EXTS.has(getExt(path));
}

function isBinaryFile(path: string): boolean {
  return BINARY_EXTS.has(getExt(path));
}

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".turbo", "dist", "build", ".next",
  "__pycache__", ".cache", ".vite", "target", ".idea", ".vscode",
]);

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  ext: string | null;
  children?: TreeNode[];
  loaded?: boolean;
}

function sortEntries(entries: TreeNode[]): TreeNode[] {
  return entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function readDirSorted(dir: string): Promise<TreeNode[]> {
  const result = await window.desktop.fs.readDir(dir);
  if (result.error || !result.entries) return [];
  const filtered = result.entries
    .filter((e) => !IGNORED_DIRS.has(e.name) && !e.name.startsWith("."))
    .map((e) => ({
      name: e.name,
      path: e.path,
      isDir: e.isDir,
      ext: e.ext,
    }));
  return sortEntries(filtered);
}

/** 单个树节点 */
const TreeItem = memo(function TreeItem({
  node,
  depth,
  expandedPaths,
  selectedPath,
  gitStatusMap,
  onToggle,
  onFileClick,
  onContextMenu,
}: {
  node: TreeNode;
  depth: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  gitStatusMap: Map<string, GitStatus> | null;
  onToggle: (path: string) => void;
  onFileClick: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const [children, setChildren] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isExpanded && node.isDir && !loading && children.length === 0) {
      setLoading(true);
      readDirSorted(node.path).then((entries) => {
        setChildren(entries);
        setLoading(false);
      });
    }
  }, [isExpanded, node.isDir, node.path]);

  const padding = 8 + depth * 16;

  if (node.isDir) {
    const dirStatus = gitStatusMap ? getDirGitStatus(node.path, gitStatusMap) : null;
    return (
      <>
        <button
          onClick={() => onToggle(node.path)}
          onContextMenu={(e) => onContextMenu(e, node.path, true)}
          className="flex items-center gap-1 w-full text-left text-[12.5px] hover:bg-hover/60 transition-colors py-[3px] pr-2 group"
          style={{ paddingLeft: padding }}
        >
          <ChevronRight
            size={13}
            className={`shrink-0 text-t-ghost transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
          />
          {isExpanded ? (
            <FolderOpen size={14} className="shrink-0 text-t-ghost" />
          ) : (
            <Folder size={14} className="shrink-0 text-t-ghost" />
          )}
          <span className="truncate" style={{ color: dirStatus ? DIR_STATUS_COLOR[dirStatus] : "#374151" }}>{node.name}</span>
          <DirGitBadge status={dirStatus} />
        </button>
        {isExpanded && !loading && children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            expandedPaths={expandedPaths}
            selectedPath={selectedPath}
            gitStatusMap={gitStatusMap}
            onToggle={onToggle}
            onFileClick={onFileClick}
            onContextMenu={onContextMenu}
          />
        ))}
      </>
    );
  }

  const { icon: Icon, color } = getFileIcon(node.path, false, false);
  const isActive = node.path === selectedPath;
  const fileStatus = gitStatusMap ? getFileGitStatus(node.path, gitStatusMap) : null;

  return (
    <button
      onClick={() => onFileClick(node.path)}
      onContextMenu={(e) => onContextMenu(e, node.path, false)}
      className={`flex items-center gap-1 w-full text-left text-[12.5px] transition-colors py-[3px] pr-2 group ${
        isActive
          ? "bg-neon/10 font-medium"
          : "hover:bg-hover/60"
      }`}
      style={{ paddingLeft: padding + 13 }}
    >
      <Icon size={14} className="shrink-0" style={{ color }} />
      <span className="truncate" style={{ color: isActive ? "#111827" : (fileStatus ? GIT_FILENAME_COLOR[fileStatus] : "#4b5563") }}>{node.name}</span>
      <FileGitBadge status={fileStatus} />
    </button>
  );
});

/** 根目录文件夹（工作区名称），默认展开 */
function RootFolderItem({
  workspace,
  expandedPaths,
  gitStatusMap,
  onToggle,
  onContextMenu,
  children,
}: {
  workspace: string;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  gitStatusMap: Map<string, GitStatus> | null;
  onToggle: (path: string) => void;
  onFileClick: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  children: React.ReactNode;
}) {
  const isExpanded = expandedPaths.has(workspace);
  const name = workspace.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? workspace;
  const dirStatus = gitStatusMap ? getDirGitStatus(workspace, gitStatusMap) : null;

  return (
    <>
      <button
        onClick={() => onToggle(workspace)}
        onContextMenu={(e) => onContextMenu(e, workspace, true)}
        className="flex items-center gap-1 w-full text-left text-[12.5px] font-medium hover:bg-hover/60 transition-colors py-[3px] pr-2 group"
        style={{ paddingLeft: 8 }}
      >
        <ChevronRight
          size={13}
          className={`shrink-0 text-t-ghost transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
        />
        {isExpanded ? (
          <FolderOpen size={14} className="shrink-0 text-t-ghost" />
        ) : (
          <Folder size={14} className="shrink-0 text-t-ghost" />
        )}
        <span className="truncate" style={{ color: dirStatus ? DIR_STATUS_COLOR[dirStatus] : "#111827" }}>{name}</span>
        <DirGitBadge status={dirStatus} />
      </button>
      {isExpanded && children}
    </>
  );
}

export function FileTreeSidebar() {
  const sessionId = useSessionId();
  const sessions = useSession((s) => s.sessions);
  const allSessions = useSession((s) => s.allSessions);
  const pendingWorkspace = useChat((s) => s.pendingWorkspace);

  const sessionWorkspace = useMemo(() => {
    if (!sessionId) return "";
    const lookup = (arr: typeof sessions) =>
      arr.find((s) => s.session_id === sessionId)?.workspace || "";
    return lookup(sessions) || lookup(allSessions);
  }, [sessionId, sessions, allSessions]);

  // 当前生效路径：有 session 用 DB 字段（即使为空也不用 pending），否则用 pending
  const workspace = sessionId ? sessionWorkspace : (pendingWorkspace || "");

  // 无 session 且 pendingWorkspace 为空时，从 config 读默认工作区
  const setPendingWorkspace = useChat((s) => s.setPendingWorkspace);
  useEffect(() => {
    if (sessionId || pendingWorkspace !== null) return;
    let cancelled = false;
    fetchAppConfig()
      .then((cfg) => {
        if (cancelled) return;
        const def = cfg?.default_workspace;
        if (typeof def === "string" && def.trim()) {
          setPendingWorkspace(def);
        }
      })
      .catch(() => void 0);
    return () => { cancelled = true; };
  }, [sessionId, pendingWorkspace, setPendingWorkspace]);

  const [rootEntries, setRootEntries] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [gitStatusMap, setGitStatusMap] = useState<Map<string, GitStatus> | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    path: string;
    isDir: boolean;
  } | null>(null);

  useEffect(() => {
    if (!workspace) {
      setRootEntries([]);
      setGitStatusMap(null);
      return;
    }
    setLoading(true);
    setExpandedPaths(new Set([workspace]));
    readDirSorted(workspace).then((entries) => {
      setRootEntries(entries);
      setLoading(false);
    });
    // 异步加载 git 状态
    window.desktop.git.status(workspace).then((result) => {
      if (result.error || !result.files) {
        setGitStatusMap(null);
        return;
      }
      setGitStatusMap(buildGitStatusMap(result.files, workspace));
    }).catch(() => setGitStatusMap(null));
  }, [workspace]);

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleFileClick = useCallback((path: string) => {
    setSelectedPath(path);
    const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
    if (isImageFile(path)) {
      useInspector.getState().openImagePreview(`filetree-${path}`, path, name);
    } else if (isBinaryFile(path)) {
      return;
    } else {
      useInspector.getState().openFilePreview(`filetree-${path}`, path, name);
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, path, isDir });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const getContextMenuItems = useCallback((path: string, isDir: boolean): ContextMenuItem[] => {
    const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
    const items: ContextMenuItem[] = [];

    if (!isDir) {
      items.push({
        id: "open",
        label: "预览",
        icon: Eye,
        action: () => handleFileClick(path),
      });
    }

    items.push({
      id: "reveal",
      label: "在资源管理器中打开",
      icon: FolderTree,
      action: () => {
        window.desktop?.fs?.revealInExplorer(path);
      },
    });

    items.push({
      id: "sep1",
      label: "",
      separator: true,
      action: () => {},
    });

    items.push({
      id: "copy-path",
      label: "复制路径",
      icon: Copy,
      action: () => {
        navigator.clipboard.writeText(path);
      },
    });

    return items;
  }, [handleFileClick]);

  if (!workspace) {
    return (
      <div className="w-full h-full flex items-center justify-center text-[12px] text-t-ghost p-4 text-center">
        未设置工作区
      </div>
    );
  }

  return (
    <>
    <div className="h-full w-full overflow-y-auto filetree-scroll">
      <div className="py-1 min-h-full">
        {loading ? (
          <div className="text-[12px] text-t-ghost px-3 py-2">加载中...</div>
        ) : rootEntries.length === 0 ? (
          <div className="text-[12px] text-t-ghost px-3 py-2">空目录</div>
        ) : (
          <RootFolderItem
            workspace={workspace}
            expandedPaths={expandedPaths}
            selectedPath={selectedPath}
            gitStatusMap={gitStatusMap}
            onToggle={handleToggle}
            onFileClick={handleFileClick}
            onContextMenu={handleContextMenu}
            children={rootEntries}
          >
            {rootEntries.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={1}
                expandedPaths={expandedPaths}
                selectedPath={selectedPath}
                gitStatusMap={gitStatusMap}
                onToggle={handleToggle}
                onFileClick={handleFileClick}
                onContextMenu={handleContextMenu}
              />
            ))}
          </RootFolderItem>
        )}
      </div>
    </div>
    {contextMenu && (
      <ContextMenu
        items={getContextMenuItems(contextMenu.path, contextMenu.isDir)}
        position={contextMenu.position}
        onClose={closeContextMenu}
        size="sm"
      />
    )}
    </>
  );
}
