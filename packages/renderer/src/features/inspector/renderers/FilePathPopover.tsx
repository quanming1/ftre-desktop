import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Loader2, RotateCw } from "lucide-react";
import type { FileEntry } from "@ftre/shared";
import {
  filterTreeEntries,
  TreeItem,
  type TreeNode,
} from "../FileTreeSidebar";

interface FilePathPopoverProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  rootPath: string;
  currentFilePath: string;
  onClose: () => void;
  onOpenFile: (entry: FileEntry) => void;
}

type RootDirectoryState = {
  status: "loading" | "ready" | "error";
  entries: TreeNode[];
  message?: string;
};

const POPOVER_WIDTH = 360;
const MAX_POPOVER_HEIGHT = 360;

function normalizePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized) return "";
  if (/^[A-Za-z]:\/$/.test(normalized) || normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

function pathKey(value: string): string {
  const normalized = normalizePath(value);
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")
    ? normalized.toLowerCase()
    : normalized;
}

function joinPath(base: string, part: string): string {
  const normalizedBase = normalizePath(base);
  if (!normalizedBase || normalizedBase === "/") return `/${part}`;
  if (/^[A-Za-z]:\/$/.test(normalizedBase)) return `${normalizedBase}${part}`;
  return `${normalizedBase}/${part}`;
}

function parentPath(value: string): string {
  const normalized = normalizePath(value);
  if (!normalized || normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) return normalized;
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return "";
  if (slash === 0) return "/";
  if (slash === 2 && /^[A-Za-z]:\//.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, slash);
}

/** 当前文件所在目录下的路径段，用于让复用的 TreeItem 自动展开。 */
function autoExpandedDirectories(rootPath: string, currentFilePath: string): string[] {
  const root = normalizePath(rootPath);
  const current = normalizePath(currentFilePath);
  if (!root || !current) return [];
  const rootKey = pathKey(root);
  const currentKey = pathKey(current);
  const prefix = rootKey.endsWith("/") ? rootKey : `${rootKey}/`;
  if (!currentKey.startsWith(prefix)) return [];

  const relative = current.slice(root.length).replace(/^\/+/, "");
  const parts = relative.split("/").filter(Boolean);
  parts.pop();
  const result: string[] = [];
  let cursor = root;
  for (const part of parts) {
    cursor = joinPath(cursor, part);
    result.push(cursor);
  }
  return result;
}

export function FilePathPopover({
  open,
  anchorEl,
  rootPath,
  currentFilePath,
  onClose,
  onOpenFile,
}: FilePathPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const generationRef = useRef(0);
  const requestIdRef = useRef(0);
  const [rootState, setRootState] = useState<RootDirectoryState | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [position, setPosition] = useState<CSSProperties>({});

  const updatePosition = useCallback(() => {
    if (!anchorEl || typeof window === "undefined") return;
    const rect = anchorEl.getBoundingClientRect();
    const width = Math.min(POPOVER_WIDTH, Math.max(240, window.innerWidth - 16));
    const belowSpace = window.innerHeight - rect.bottom;
    const top = belowSpace >= MAX_POPOVER_HEIGHT + 8
      ? rect.bottom + 4
      : Math.max(8, rect.top - MAX_POPOVER_HEIGHT - 4);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    setPosition({ left, top, width, maxHeight: `min(${MAX_POPOVER_HEIGHT}px, calc(100vh - 16px))` });
  }, [anchorEl]);

  const readDirectory = useCallback(async (directoryPath: string): Promise<TreeNode[]> => {
    const listDirectory = typeof window !== "undefined" ? window.desktop?.fs?.listDirectory : undefined;
    if (typeof listDirectory !== "function") throw new Error("当前环境不可读取目录");
    const result = await listDirectory(directoryPath);
    if (result.error) throw new Error(result.error.message);
    return filterTreeEntries(result.entries ?? []);
  }, []);

  const toggleDirectory = useCallback((directoryPath: string) => {
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      const key = pathKey(directoryPath);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleTreeContextMenu = useCallback(() => {
    // 路径浮层只读，不复用左侧树的文件操作菜单。
  }, []);

  const loadRootDirectory = useCallback((directoryPath: string, generation: number) => {
    const requestId = ++requestIdRef.current;
    setRootState({ status: "loading", entries: [] });
    const listDirectory = typeof window !== "undefined" ? window.desktop?.fs?.listDirectory : undefined;
    if (typeof listDirectory !== "function") {
      setRootState({ status: "error", entries: [], message: "当前环境不可读取目录" });
      return;
    }

    void listDirectory(directoryPath)
      .then((result) => {
        if (generation !== generationRef.current || requestId !== requestIdRef.current) return;
        if (result.error) {
          setRootState({ status: "error", entries: [], message: result.error.message });
          return;
        }
        setRootState({ status: "ready", entries: filterTreeEntries(result.entries ?? []) });
      })
      .catch(() => {
        if (generation !== generationRef.current || requestId !== requestIdRef.current) return;
        setRootState({ status: "error", entries: [], message: "读取目录失败" });
      });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const handleViewportChange = () => updatePosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const generation = ++generationRef.current;
    setRootState(null);
    setExpandedPaths(new Set(autoExpandedDirectories(rootPath, currentFilePath).map(pathKey)));
    loadRootDirectory(rootPath, generation);
    return () => {
      generationRef.current += 1;
    };
  }, [currentFilePath, loadRootDirectory, open, rootPath]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !popoverRef.current?.contains(target) && target !== anchorEl && !anchorEl?.contains(target)) {
        onClose();
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorEl, onClose, open]);

  if (!open || !anchorEl || typeof document === "undefined") return null;

  const selectedPath = normalizePath(currentFilePath);
  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`浏览目录 ${rootPath}`}
      className="fixed z-[100] min-h-0 overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-[0_12px_36px_rgba(15,23,42,0.18)]"
      style={position}
    >
      <div className="max-h-[min(360px,calc(100vh-16px))] min-h-0 overflow-y-auto p-1" role="tree" aria-label={`目录 ${rootPath}`}>
        {!rootState || rootState.status === "loading" ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-[11px] text-t-ghost">
            <Loader2 size={14} className="animate-spin" />
            <span>读取目录中…</span>
          </div>
        ) : rootState.status === "error" ? (
          <div className="flex flex-col items-center gap-2 px-3 py-6 text-[11px] text-red-500">
            <AlertCircle size={16} />
            <span>{rootState.message}</span>
            <button type="button" onClick={() => loadRootDirectory(rootPath, generationRef.current)} className="rounded-md bg-red-50 px-2 py-1 hover:bg-red-100">
              <RotateCw size={12} className="mr-1 inline" />重试
            </button>
          </div>
        ) : rootState.entries.length > 0 ? (
          rootState.entries.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              expandedPaths={expandedPaths}
              selectedFilePath={selectedPath}
              gitStatusMap={null}
              dirVersion={0}
              getDirVersion={() => 0}
              onToggle={toggleDirectory}
              onFileClick={(_path, selectedNode) => {
                onOpenFile(selectedNode);
                onClose();
              }}
              onContextMenu={handleTreeContextMenu}
              readDirectory={readDirectory}
            />
          ))
        ) : (
          <div className="px-3 py-6 text-center text-[11px] text-t-ghost">目录为空</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export { autoExpandedDirectories, normalizePath, parentPath, pathKey };
