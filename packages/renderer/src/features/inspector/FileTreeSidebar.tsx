/**
 * FileTreeSidebar — 基于 react-arborist 的文件树侧边栏
 *
 * 特性：
 * - 虚拟滚动（react-window）
 * - 懒加载子目录（onLoadChildren）
 * - git 状态标记 + 染色
 * - Changes 虚拟节点
 * - vscode-icons 图标
 * - 右键菜单
 */
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Copy, Eye, FolderTree } from "lucide-react";
import { Icon } from "@iconify/react";
import { Tree, type NodeRendererProps, type TreeApi } from "react-arborist";
import { useSession } from "@/stores/session";
import { useChat, useSessionId } from "@/stores/chat";
import { useInspector } from "@/stores/inspector";
import { fetchAppConfig } from "@/services/api";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { FileIconView } from "@/components/FileIconView";

// ── 常量 ──────────────────────────────────────────────────────────

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".turbo", "dist", "build", ".next",
  "__pycache__", ".cache", ".vite", "target", ".idea", ".vscode",
]);

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico"]);
const BINARY_EXTS = new Set([
  "exe", "dll", "so", "dylib", "bin", "obj", "o", "a", "lib",
  "zip", "gz", "tar", "rar", "7z", "bz2",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "mp3", "mp4", "avi", "mov", "wav", "flac", "ogg",
  "ttf", "otf", "woff", "woff2", "eot",
  "pyc", "class", "jar", "wasm", "sqlite", "db", "mdb",
]);

// ── Git 状态类型 ──────────────────────────────────────────────────

type GitStatus = "modified" | "untracked" | "added" | "deleted" | "renamed" | "conflict";
type DirGitStatus = "modified" | "untracked" | "mixed" | null;

const GIT_STATUS_LABEL: Record<GitStatus, string> = {
  modified: "M", untracked: "U", added: "A", deleted: "D", renamed: "R", conflict: "C",
};
const GIT_STATUS_COLOR: Record<GitStatus, string> = {
  modified: "text-amber-500", untracked: "text-t-ghost", added: "text-green-600",
  deleted: "text-red-500", renamed: "text-blue-500", conflict: "text-purple-500",
};
const GIT_FILENAME_COLOR: Record<GitStatus, string> = {
  modified: "#d97706", untracked: "#6b7280", added: "#16a34a",
  deleted: "#dc2626", renamed: "#2563eb", conflict: "#9333ea",
};
const DIR_STATUS_COLOR: Record<DirGitStatus, string> = {
  modified: "#d97706", untracked: "#6b7280", mixed: "#6b7280",
};

function buildGitStatusMap(
  files: { absolutePath: string; status: string; isDir: boolean }[],
): Map<string, GitStatus> {
  const map = new Map<string, GitStatus>();
  for (const f of files) {
    const normalized = f.absolutePath.replace(/\\/g, "/");
    map.set(normalized, f.status as GitStatus);
    map.set(normalized.toLowerCase(), f.status as GitStatus);
  }
  return map;
}

function getFileGitStatus(path: string, map: Map<string, GitStatus> | null): GitStatus | null {
  if (!map) return null;
  const normalized = path.replace(/\\/g, "/");
  return map.get(normalized) ?? map.get(normalized.toLowerCase()) ?? null;
}

function getDirGitStatus(path: string, map: Map<string, GitStatus>): DirGitStatus {
  const prefix = path.replace(/\\/g, "/").toLowerCase() + "/";
  let hasModified = false;
  let hasUntracked = false;
  for (const [key, status] of map) {
    if (!key.toLowerCase().startsWith(prefix)) continue;
    if (status === "untracked") hasUntracked = true;
    else hasModified = true;
    if (hasModified && hasUntracked) break;
  }
  if (hasModified && hasUntracked) return "mixed";
  if (hasModified) return "modified";
  if (hasUntracked) return "untracked";
  return null;
}

function getExt(path: string): string {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m?.[1] ?? "";
}
function isImageFile(path: string): boolean { return IMAGE_EXTS.has(getExt(path)); }
function isBinaryFile(path: string): boolean { return BINARY_EXTS.has(getExt(path)); }

// ── 文件树数据类型 ────────────────────────────────────────────────

interface TreeNodeData {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  /** 异步加载的子节点 */
  children?: TreeNodeData[];
}

async function readDirSorted(dir: string): Promise<TreeNodeData[]> {
  const result = await window.desktop.fs.readDir(dir);
  if (result.error || !result.entries) return [];
  const filtered = result.entries
    .filter((e) => !IGNORED_DIRS.has(e.name) && !e.name.startsWith("."))
    .map((e) => ({
      id: e.path,
      name: e.name,
      path: e.path,
      isDir: e.isDir,
    }));
  return filtered.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ── 图标辅助 ──────────────────────────────────────────────────────

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

function DirGitBadge({ status }: { status: DirGitStatus }) {
  if (!status) return null;
  const label = status === "mixed" ? "*" : status === "modified" ? "M" : "U";
  const color = status === "modified" ? "text-amber-500" : "text-t-ghost";
  return <span className={`ml-auto shrink-0 text-[10px] font-mono font-bold ${color} opacity-60`}>{label}</span>;
}

function FileGitBadge({ status }: { status: GitStatus | null }) {
  if (!status) return null;
  return <span className={`ml-auto shrink-0 text-[10px] font-mono font-bold ${GIT_STATUS_COLOR[status]}`}>{GIT_STATUS_LABEL[status]}</span>;
}

// ── Changes 节点（虚拟节点，不参与 arborist 树） ──────────────────

function GitChangesSection({
  workspace,
  changedFiles,
  expandedPaths,
  selectedDiffPath,
  onToggle,
  onGitFileClick,
}: {
  workspace: string;
  changedFiles: any[];
  expandedPaths: Set<string>;
  selectedDiffPath: string | null;
  onToggle: (path: string) => void;
  onGitFileClick: (file: any) => void;
}) {
  const changesKey = `${workspace}::changes`;
  const isExpanded = expandedPaths.has(changesKey);

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
        className="flex items-center gap-1 w-full text-left text-[12.5px] font-medium hover:bg-hover/60 transition-colors py-[3px] pr-2"
        style={{ paddingLeft: 8 }}
      >
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
        const absPath = file.absolutePath.replace(/\\/g, "/");
        const name = absPath.split("/").pop() ?? absPath;
        const relPath = absPath.slice(workspace.replace(/\\/g, "/").length + 1);
        const status = file.status as GitStatus;
        const isActive = absPath === selectedDiffPath;
        const statusChar = GIT_STATUS_LABEL[status];
        const statusColor = GIT_STATUS_COLOR[status];

        return (
          <button
            key={file.absolutePath}
            onClick={() => onGitFileClick(file)}
            title={relPath}
            className={`flex items-center gap-1 w-full text-left text-[12.5px] transition-colors py-[3px] pr-2 ${
              isActive ? "bg-neon/10 font-medium" : "hover:bg-hover/60"
            }`}
            style={{ paddingLeft: 8 + 16 + 13 }}
          >
            <FileIconView path={absPath} size={16} />
            <span className="truncate" style={{ color: isActive ? "#111827" : GIT_FILENAME_COLOR[status] }}>
              {name}
            </span>
            <span className="ml-auto shrink-0 flex items-center gap-1.5 font-mono text-[10px]">
              {file.additions > 0 && <span className="text-green-600">+{file.additions}</span>}
              {file.deletions > 0 && <span className="text-red-500">-{file.deletions}</span>}
              <span className={`font-bold ${statusColor}`}>{statusChar}</span>
            </span>
          </button>
        );
      })}
    </>
  );
}

// ── react-arborist 节点渲染 ───────────────────────────────────────

function TreeNodeRenderer({
  node,
  style,
  tree,
}: NodeRendererProps<TreeNodeData>) {
  const data = node.data;
  const gitStatusMap = (tree as any).gitStatusMap as Map<string, GitStatus> | null;
  const selectedFilePath = (tree as any).selectedFilePath as string | null;
  const onFileClick = (tree as any).onFileClick as (path: string) => void;
  const onContextMenu = (tree as any).onContextMenu as (e: React.MouseEvent, path: string, isDir: boolean) => void;

  const padding = 8 + node.level * 16;

  if (data.isDir) {
    const dirStatus = gitStatusMap ? getDirGitStatus(data.path, gitStatusMap) : null;
    return (
      <div
        style={style}
        onClick={() => node.toggle()}
        onContextMenu={(e) => onContextMenu(e, data.path, true)}
        className="flex items-center gap-1 w-full text-left text-[12.5px] hover:bg-hover/60 transition-colors py-[3px] pr-2 cursor-pointer"
        onDoubleClick={() => node.toggle()}
      >
        <div style={{ paddingLeft: padding }} className="flex items-center gap-1 w-full">
          <span style={{ display: "inline-flex", width: 13, height: 13, alignItems: "center", justifyContent: "center" }} className="shrink-0">
            <Icon icon="vscode-icons:chevron-right" width={13} height={13} className={`text-t-ghost transition-transform duration-150 ${node.isOpen ? "rotate-90" : ""}`} />
          </span>
          {node.isOpen ? <FolderOpenIcon size={16} /> : <FolderIcon size={16} />}
          <span className="truncate" style={{ color: dirStatus ? DIR_STATUS_COLOR[dirStatus] : "#374151" }}>{data.name}</span>
          <DirGitBadge status={dirStatus} />
        </div>
      </div>
    );
  }

  const isActive = data.path === selectedFilePath;
  const fileStatus = gitStatusMap ? getFileGitStatus(data.path, gitStatusMap) : null;

  return (
    <div
      style={style}
      onClick={() => onFileClick(data.path)}
      onContextMenu={(e) => onContextMenu(e, data.path, false)}
      className={`flex items-center gap-1 w-full text-left text-[12.5px] transition-colors py-[3px] pr-2 cursor-pointer ${
        isActive ? "bg-neon/10 font-medium" : "hover:bg-hover/60"
      }`}
    >
      <div style={{ paddingLeft: padding + 13 }} className="flex items-center gap-1 w-full">
        <FileIconView path={data.path} size={16} />
        <span className="truncate" style={{ color: isActive ? "#111827" : (fileStatus ? GIT_FILENAME_COLOR[fileStatus] : "#4b5563") }}>{data.name}</span>
        <FileGitBadge status={fileStatus} />
      </div>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────

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

  const workspace = sessionId ? sessionWorkspace : (pendingWorkspace || "");

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

  // 文件树状态
  const [treeData, setTreeData] = useState<TreeNodeData[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);

  // git 状态
  const [gitStatusMap, setGitStatusMap] = useState<Map<string, GitStatus> | null>(null);
  const [changedFiles, setChangedFiles] = useState<any[]>([]);
  const gitEtagRef = useRef<string>("");
  const pollCountRef = useRef(0);

  // 右键菜单
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    path: string;
    isDir: boolean;
  } | null>(null);

  // treeApi ref
  const treeApiRef = useRef<TreeApi<TreeNodeData> | null>(null);

  // active tab 同步
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
    setSelectedFilePath(null);
    setSelectedDiffPath(null);
    if (tab.type === "diff") {
      setSelectedDiffPath(tab.filePath ?? null);
    } else if (tab.type === "file" || tab.type === "image") {
      setSelectedFilePath(tab.filePath ?? null);
      if (tab.filePath) {
        const fp = tab.filePath.replace(/\\/g, "/");
        const ws = workspace.replace(/\\/g, "/");
        if (fp.startsWith(ws)) {
          const relPath = fp.slice(ws.length + 1);
          const parts = relPath.split("/").filter(Boolean);
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

  // 加载根目录
  useEffect(() => {
    if (!workspace) {
      setTreeData([]);
      return;
    }
    setLoading(true);
    setExpandedPaths(new Set([workspace]));
    readDirSorted(workspace).then((entries) => {
      setTreeData(entries);
      setLoading(false);
    });
  }, [workspace]);

  // git 轮询
  useEffect(() => {
    if (!workspace) {
      setGitStatusMap(null);
      setChangedFiles([]);
      gitEtagRef.current = "";
      return;
    }

    let cancelled = false;
    gitEtagRef.current = "";

    const poll = async (force = false) => {
      const result = await window.desktop.git.poll(workspace, gitEtagRef.current, force);
      if (cancelled) return;
      gitEtagRef.current = result.etag;
      if (!result.changed || !result.files) return;

      const files = result.files.filter((f: any) => !f.isDir);
      setGitStatusMap(buildGitStatusMap(result.files));

      if (result.stats) {
        const enriched = files.map((f: any) => {
          const key = f.absolutePath.replace(/\\/g, "/").toLowerCase();
          const stat = result.stats![key];
          return { ...f, additions: stat?.additions ?? 0, deletions: stat?.deletions ?? 0 };
        });
        setChangedFiles(enriched);
      } else {
        setChangedFiles(files);
      }
    };

    poll(true);
    const interval = setInterval(() => {
      pollCountRef.current += 1;
      poll(pollCountRef.current % 5 === 0);
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [workspace]);

  // 懒加载：onToggle 时异步加载子节点，更新 treeData
  const loadChildrenAndUpdate = useCallback(async (nodeId: string) => {
    const children = await readDirSorted(nodeId);
    // 递归更新 treeData，把 children 挂到对应节点
    const updateNode = (nodes: TreeNodeData[]): TreeNodeData[] =>
      nodes.map((n) => {
        if (n.id === nodeId) {
          return { ...n, children };
        }
        if (n.children) {
          return { ...n, children: updateNode(n.children) };
        }
        return n;
      });
    setTreeData((prev) => updateNode(prev));
  }, []);

  // 扩展 treeApi 以传递自定义数据
  const handleToggle = useCallback((nodeId: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
        // 异步加载子节点
        loadChildrenAndUpdate(nodeId);
      }
      return next;
    });
  }, [loadChildrenAndUpdate]);

  // react-arborist onToggle
  const onTreeToggle = useCallback((id: string) => {
    handleToggle(id);
  }, [handleToggle]);

  const handleFileClick = useCallback((path: string) => {
    setSelectedFilePath(path);
    const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
    if (isImageFile(path)) {
      useInspector.getState().openImagePreview(`filetree-${path}`, path, name);
    } else if (isBinaryFile(path)) {
      return;
    } else {
      useInspector.getState().openFilePreview(`filetree-${path}`, path, name);
    }
  }, []);

  const handleGitFileClick = useCallback(async (file: any) => {
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
      `gitfile-${absPath}`, absPath,
      result.original ?? "", result.modified ?? "",
      0, 0, name,
    );
  }, [workspace]);

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, path, isDir });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const getContextMenuItems = useCallback((path: string, isDir: boolean): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (!isDir) {
      items.push({ id: "open", label: "预览", icon: Eye, action: () => handleFileClick(path) });
    }
    items.push({
      id: "reveal", label: "在资源管理器中打开", icon: FolderTree,
      action: () => { window.desktop?.fs?.revealInExplorer(path); },
    });
    items.push({ id: "sep1", label: "", separator: true, action: () => {} });
    items.push({
      id: "copy-path", label: "复制路径", icon: Copy,
      action: () => { navigator.clipboard.writeText(path); },
    });
    return items;
  }, [handleFileClick]);

  // react-arborist 初始展开状态
  const initialOpenState = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const p of expandedPaths) map[p] = true;
    return map;
  }, [expandedPaths]);

  if (!workspace) {
    return (
      <div className="w-full h-full flex items-center justify-center text-[12px] text-t-ghost p-4 text-center">
        未设置工作区
      </div>
    );
  }

  // 根目录包装：工作区名称作为根节点
  const rootData: TreeNodeData[] = [{
    id: workspace,
    name: workspace.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? workspace,
    path: workspace,
    isDir: true,
    children: treeData,
  }];

  // 扩展 treeApi 以传递自定义数据
  const treeRef = (api: TreeApi<TreeNodeData> | null) => {
    if (api) {
      (api as any).gitStatusMap = gitStatusMap;
      (api as any).selectedFilePath = selectedFilePath;
      (api as any).onFileClick = handleFileClick;
      (api as any).onContextMenu = handleContextMenu;
    }
    treeApiRef.current = api;
  };

  return (
    <>
      <div className="h-full w-full flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto filetree-scroll">
          {loading ? (
            <div className="text-[12px] text-t-ghost px-3 py-2">加载中...</div>
          ) : (
            <Tree
              ref={treeRef}
              data={rootData}
              width="100%"
              height={100000}
              indent={16}
              rowHeight={26}
              openByDefault={false}
              onToggle={onTreeToggle}
              initialOpenState={initialOpenState}
              disableDrag
              disableDrop
              disableSearch
              selection={selectedFilePath ?? undefined}
            >
              {TreeNodeRenderer}
            </Tree>
          )}
        </div>

        {!loading && (
          <div className="shrink-0 max-h-[40%] overflow-y-auto filetree-scroll border-t border-border">
            <GitChangesSection
              workspace={workspace}
              changedFiles={changedFiles}
              expandedPaths={expandedPaths}
              selectedDiffPath={selectedDiffPath}
              onToggle={handleToggle}
              onGitFileClick={handleGitFileClick}
            />
          </div>
        )}
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
