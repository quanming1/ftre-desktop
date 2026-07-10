/**
 * FileTreeSidebar — Inspector 面板左侧的文件树侧边栏
 *
 * 懒加载：点击展开目录时才 readDir，不预扫整个工作区。
 * 工作区来源与 WorkspaceBadge 一致：session DB workspace 字段。
 */
import { useState, useCallback, useEffect, memo, useMemo, useRef } from "react";
import { ChevronRight, Copy, Eye, FileText, FolderTree } from "lucide-react";
import { Icon } from "@iconify/react";
import { useSession } from "@/stores/session";
import { useChat, useSessionId } from "@/stores/chat";
import { useInspector } from "@/stores/inspector";
import { fetchAppConfig } from "@/services/api";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { FileIconView } from "@/components/FileIconView";

const FolderIcon = ({ size = 16 }: { size?: number }) => (
  <span style={{ display: "inline-flex", width: size, height: size, minWidth: size, minHeight: size, alignItems: "center", justifyContent: "center" }} className="shrink-0">
    <Icon icon="vscode-icons:default-folder" width={size} height={size} />
  </span>
);
const FolderOpenIcon = ({ size = 16 }: { size?: number }) => (
  <span style={{ display: "inline-flex", width: size, height: size, minWidth: size, minHeight: size, alignItems: "center", justifyContent: "center" }} className="shrink-0">
    <Icon icon="vscode-icons:default-folder-opened" width={size} height={size} />
  </span>
);

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
  selectedFilePath,
  gitStatusMap,
  onToggle,
  onFileClick,
  onContextMenu,
}: {
  node: TreeNode;
  depth: number;
  expandedPaths: Set<string>;
  selectedFilePath: string | null;
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
            <FolderOpenIcon size={16} />
          ) : (
            <FolderIcon size={16} />
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
            selectedFilePath={selectedFilePath}
            gitStatusMap={gitStatusMap}
            onToggle={onToggle}
            onFileClick={onFileClick}
            onContextMenu={onContextMenu}
          />
        ))}
      </>
    );
  }

  const isActive = node.path === selectedFilePath;
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
      <FileIconView path={node.path} size={16} />
      <span className="truncate" style={{ color: isActive ? "#111827" : (fileStatus ? GIT_FILENAME_COLOR[fileStatus] : "#4b5563") }}>{node.name}</span>
      <FileGitBadge status={fileStatus} />
    </button>
  );
});

/** Git 变更文件平铺列表（虚拟 "Changes" 节点） */
function GitChangesSection({
  workspace,
  changedFiles,
  expandedPaths,
  selectedDiffPath,
  onToggle,
  onGitFileClick,
  onContextMenu,
}: {
  workspace: string;
  changedFiles: GitFileStatus[];
  expandedPaths: Set<string>;
  selectedDiffPath: string | null;
  onToggle: (path: string) => void;
  onGitFileClick: (file: GitFileStatus) => void;
  onContextMenu: (e: React.MouseEvent, file: GitFileStatus) => void;
}) {
  const changesKey = `${workspace}::changes`;
  const isExpanded = expandedPaths.has(changesKey);

  /** 按 git 状态分组排序：modified > added > deleted > renamed > untracked > conflict */
  const statusOrder: Record<string, number> = {
    modified: 0, added: 1, deleted: 2, renamed: 3, untracked: 4, conflict: 5,
  };
  const sorted = [...changedFiles].sort((a, b) => {
    const so = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    if (so !== 0) return so;
    return a.absolutePath.localeCompare(b.absolutePath);
  });

  return (
    <>
      <button
        onClick={() => onToggle(changesKey)}
        className="flex items-center gap-1 w-full text-left text-[12.5px] font-medium hover:bg-hover/60 transition-colors py-[3px] pr-2 group"
        style={{ paddingLeft: 8 }}
      >
        <ChevronRight
          size={13}
          className={`shrink-0 text-t-ghost transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
        />
        <span style={{ display: "inline-flex", width: 16, height: 16, minWidth: 16, minHeight: 16, alignItems: "center", justifyContent: "center" }} className="shrink-0">
          <Icon icon="vscode-icons:file-type-git" width={16} height={16} style={{ color: "#f05032" }} />
        </span>
        <span className="truncate" style={{ color: changedFiles.length > 0 ? "#d97706" : "#111827" }}>
          Changes
        </span>
        {changedFiles.length > 0 && (
          <span className="ml-auto shrink-0 text-[10px] font-mono font-bold text-t-ghost">
            {changedFiles.length}
          </span>
        )}
      </button>
      {isExpanded && sorted.map((file) => {
        const name = file.absolutePath.replace(/\\/g, "/").split("/").pop() ?? file.absolutePath;
        const relPath = file.absolutePath.replace(/\\/g, "/").slice(workspace.replace(/\\/g, "/").length + 1);
        const status = file.status as GitStatus;
        const isActive = file.absolutePath === selectedDiffPath;

        // 状态标签：modified → M (橙), added → A (绿), deleted → D (红), renamed → R (蓝), untracked → U (灰), conflict → C (紫)
        const statusChar = GIT_STATUS_LABEL[status];
        const statusColor = GIT_STATUS_COLOR[status];

        return (
          <button
            key={file.absolutePath}
            onClick={() => onGitFileClick(file)}
            onContextMenu={(e) => onContextMenu(e, file)}
            title={relPath}
            className={`flex items-center gap-1 w-full text-left text-[12.5px] transition-colors py-[3px] pr-2 ${
              isActive ? "bg-neon/10 font-medium" : "hover:bg-hover/60"
            }`}
            style={{ paddingLeft: 8 + 16 + 13 }}
          >
            <FileIconView path={file.absolutePath} size={16} />
            <span className="truncate" style={{ color: isActive ? "#111827" : GIT_FILENAME_COLOR[status] }}>
              {name}
            </span>
            {/* 右侧：+xx -xx M */}
            <span className="ml-auto shrink-0 flex items-center gap-1.5 font-mono text-[10px]">
              {file.additions != null && file.additions > 0 && (
                <span className="text-green-600">+{file.additions}</span>
              )}
              {file.deletions != null && file.deletions > 0 && (
                <span className="text-red-500">-{file.deletions}</span>
              )}
              <span className={`font-bold ${statusColor}`}>{statusChar}</span>
            </span>
          </button>
        );
      })}
      {isExpanded && sorted.length === 0 && (
        <div className="text-[12px] text-t-ghost px-3 py-1.5" style={{ paddingLeft: 8 + 16 + 13 }}>
          无变更
        </div>
      )}
    </>
  );
}

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
  selectedFilePath: string | null;
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
          <FolderOpenIcon size={16} />
        ) : (
          <FolderIcon size={16} />
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
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const [gitStatusMap, setGitStatusMap] = useState<Map<string, GitStatus> | null>(null);
  const [changedFiles, setChangedFiles] = useState<GitFileStatus[]>([]);
  const gitEtagRef = useRef<string>("");
  const pollCountRef = useRef(0);
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    path: string;
    isDir: boolean;
  } | null>(null);

  // 监听 active tab 变化，同步文件树/Changes 的选中状态
  const activeTabId = useInspector((s) => s.activeTabId);
  const allTabs = useInspector((s) => s.tabs);
  useEffect(() => {
    if (!activeTabId) {
      setSelectedFilePath(null);
      setSelectedDiffPath(null);
      return;
    }
    const tab = allTabs.find((t) => t.id === activeTabId);
    if (!tab) {
      setSelectedFilePath(null);
      setSelectedDiffPath(null);
      return;
    }
    // 根据 tab 类型设置选中状态
    setSelectedFilePath(null);
    setSelectedDiffPath(null);
    if (tab.type === "diff") {
      setSelectedDiffPath(tab.filePath ?? null);
    } else if (tab.type === "file" || tab.type === "image") {
      setSelectedFilePath(tab.filePath ?? null);
      // 自动展开文件树到该文件所在的各级目录
      if (tab.filePath) {
        const fp = tab.filePath.replace(/\\/g, "/");
        const ws = workspace.replace(/\\/g, "/");
        if (fp.startsWith(ws)) {
          const relPath = fp.slice(ws.length + 1);
          const parts = relPath.split("/").filter(Boolean);
          // 逐级构建路径并加入 expandedPaths
          const pathsToExpand: string[] = [ws];
          let current = ws;
          for (let i = 0; i < parts.length - 1; i++) {
            current = current + "/" + parts[i];
            pathsToExpand.push(current);
          }
          setExpandedPaths((prev) => {
            const next = new Set(prev);
            for (const p of pathsToExpand) next.add(p);
            return next;
          });
        }
      }
    }
  }, [activeTabId, allTabs, workspace]);

  // git 轮询：1s 一次，Phase 1 etag 协商（<1ms），变了才走 Phase 2
  useEffect(() => {
    if (!workspace) {
      setRootEntries([]);
      return;
    }
    setLoading(true);
    setExpandedPaths(new Set([workspace, `${workspace}::changes`]));
    readDirSorted(workspace).then((entries) => {
      setRootEntries(entries);
      setLoading(false);
    });
  }, [workspace]);

  useEffect(() => {
    if (!workspace) {
      setGitStatusMap(null);
      setChangedFiles([]);
      gitEtagRef.current = "";
      return;
    }

    let cancelled = false;
    // 切换工作区时清空旧数据和 etag，强制走 Phase 2
    // 不清空的话，readDirSorted 先完成（loading=false）时 GitChangesSection 会用上一个工作区的 changedFiles 渲染，
    // 点击这些 stale 文件时 handleGitFileClick 用新 workspace 计算 relPath 会得到错误路径 → diff 内容全空
    setGitStatusMap(null);
    setChangedFiles([]);
    gitEtagRef.current = "";

    const poll = async (force = false) => {
      const result = await window.desktop.git.poll(workspace, gitEtagRef.current, force);
      if (cancelled) return;
      gitEtagRef.current = result.etag;
      if (!result.changed || !result.files) return;

      const files = result.files.filter((f) => !f.isDir);
      setGitStatusMap(buildGitStatusMap(result.files, workspace));

      // 合并 numstat 增删行数
      if (result.stats) {
        const enriched = files.map((f) => {
          const key = f.absolutePath.replace(/\\/g, "/").toLowerCase();
          const stat = result.stats![key];
          return {
            ...f,
            additions: stat?.additions ?? 0,
            deletions: stat?.deletions ?? 0,
          };
        });
        setChangedFiles(enriched);
      } else {
        setChangedFiles(files);
      }
    };

    // 立即拉一次
    poll(true);
    // 1s 轮询，每 5 次强制走 Phase 2（兜底：外部编辑器改文件不触发 git index 更新）
    const interval = setInterval(() => {
      pollCountRef.current += 1;
      poll(pollCountRef.current % 5 === 0);
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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

  const openFileInTab = useCallback((prefix: string, path: string) => {
    setSelectedFilePath(path);
    const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
    if (isImageFile(path)) {
      useInspector.getState().openImagePreview(`${prefix}-${path}`, path, name);
    } else if (isBinaryFile(path)) {
      return;
    } else {
      useInspector.getState().openFilePreview(`${prefix}-${path}`, path, name);
    }
  }, []);

  const handleFileClick = useCallback((path: string) => openFileInTab("filetree", path), [openFileInTab]);

  const handleGitFileClick = useCallback(async (file: GitFileStatus) => {
    const absPath = file.absolutePath.replace(/\\/g, "/");
    const ws = workspace.replace(/\\/g, "/");
    const name = absPath.split("/").pop() ?? absPath;
    setSelectedDiffPath(absPath);

    if (file.status === "untracked" || file.isDir) {
      useInspector.getState().openFilePreview(`gitfile-${absPath}`, absPath, name);
      return;
    }

    const relPath = absPath.slice(ws.length + 1);
    const result = await window.desktop.git.diffFile(ws, relPath, file.status, file.staged, file.oldPath);
    if (result.error) {
      useInspector.getState().openFilePreview(`gitfile-${absPath}`, absPath, name);
      return;
    }
    useInspector.getState().openDiffPreview(
      `gitfile-${absPath}`,
      absPath,
      result.original ?? "",
      result.modified ?? "",
      0,
      0,
      name,
    );
  }, [workspace]);

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, path, isDir });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const closeChangesContextMenu = useCallback(() => setChangesContextMenu(null), []);

  // ── Changes 文件右键菜单 ──────────────────────────────────────────
  const [changesContextMenu, setChangesContextMenu] = useState<{
    position: { x: number; y: number };
    file: GitFileStatus;
  } | null>(null);

  const handleChangesContextMenu = useCallback((e: React.MouseEvent, file: GitFileStatus) => {
    e.preventDefault();
    e.stopPropagation();
    setChangesContextMenu({ position: { x: e.clientX, y: e.clientY }, file });
  }, []);

  const getChangesContextMenuItems = useCallback((file: GitFileStatus): ContextMenuItem[] => {
    const absPath = file.absolutePath.replace(/\\/g, "/");
    const items: ContextMenuItem[] = [
      {
        id: "copy-path",
        label: "复制路径",
        icon: Copy,
        action: () => {
          navigator.clipboard.writeText(file.absolutePath).catch(() => {});
        },
      },
      {
        id: "reveal",
        label: "在资源管理器中打开",
        icon: FolderTree,
        action: () => {
          window.desktop?.fs?.revealInExplorer(file.absolutePath);
        },
      },
    ];

    // deleted 文件已不存在，不显示"打开原始文件"
    if (file.status !== "deleted") {
      items.push({
        id: "sep1",
        label: "",
        separator: true,
        action: () => {},
      });
      items.push({
        id: "open-original",
        label: "打开原始文件",
        icon: FileText,
        action: () => {
          const name = absPath.split("/").pop() ?? absPath;
          useInspector.getState().openFilePreview(`original-${absPath}`, absPath, name);
        },
      });
    }

    return items;
  }, []);

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
        navigator.clipboard.writeText(path).catch(() => {});
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
          <>
            <RootFolderItem
              workspace={workspace}
              expandedPaths={expandedPaths}
              selectedFilePath={selectedFilePath}
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
                  selectedFilePath={selectedFilePath}
                  gitStatusMap={gitStatusMap}
                  onToggle={handleToggle}
                  onFileClick={handleFileClick}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </RootFolderItem>
            <GitChangesSection
              workspace={workspace}
              changedFiles={changedFiles}
              expandedPaths={expandedPaths}
              selectedDiffPath={selectedDiffPath}
              onToggle={handleToggle}
              onGitFileClick={handleGitFileClick}
              onContextMenu={handleChangesContextMenu}
            />
          </>
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
    {changesContextMenu && (
      <ContextMenu
        items={getChangesContextMenuItems(changesContextMenu.file)}
        position={changesContextMenu.position}
        onClose={closeChangesContextMenu}
        size="sm"
      />
    )}
    </>
  );
}
