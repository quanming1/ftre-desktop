import { useState, useRef, memo, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, Folder, Trash2, FolderSync, GripVertical } from "lucide-react";
import { useWorkspace } from "@/stores/workspace";

/** Activity Bar 宽度常量，Workbench 布局计算需要引用 */
export const ACTIVITY_BAR_WIDTH = 64;

// ─── 颜色系统 ──────────────────────────────────────────────────────

/**
 * 预设渐变色板 — 柔和低饱和度，深色主题友好
 * 每个 item 根据路径 hash 取一个固定色，保证同一路径颜色不变
 */
const GRADIENT_PALETTE = [
  { from: "#6366f1", to: "#818cf8" }, // indigo
  { from: "#8b5cf6", to: "#a78bfa" }, // violet
  { from: "#ec4899", to: "#f472b6" }, // pink
  { from: "#f59e0b", to: "#fbbf24" }, // amber
  { from: "#10b981", to: "#34d399" }, // emerald
  { from: "#06b6d4", to: "#22d3ee" }, // cyan
  { from: "#3b82f6", to: "#60a5fa" }, // blue
  { from: "#f97316", to: "#fb923c" }, // orange
  { from: "#14b8a6", to: "#2dd4bf" }, // teal
  { from: "#e11d48", to: "#fb7185" }, // rose
  { from: "#a855f7", to: "#c084fc" }, // purple
  { from: "#84cc16", to: "#a3e635" }, // lime
] as const;

/** 稳定 hash：同一路径永远返回同一个颜色索引 */
function pathHash(path: string): number {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) - h + path.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getGradient(path: string) {
  return GRADIENT_PALETTE[pathHash(path) % GRADIENT_PALETTE.length];
}

// ─── 工具函数 ──────────────────────────────────────────────────────

function folderName(fullPath: string): string {
  const normalized = fullPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || fullPath;
}

/**
 * 生成文件夹的缩写标签（最多 3 个字符）
 * - 纯英文名：取前 3 个字符大写，如 "desktop" -> "DES"
 * - 含连字符/下划线/驼峰的名称：取各段首字母，如 "my-app" -> "MA", "myApp" -> "MA"
 * - 中文等非ASCII：取前 2 个字符
 */
function folderAbbrev(fullPath: string): string {
  const name = folderName(fullPath);

  // 尝试按分隔符拆分（连字符、下划线、空格、点号）
  const sepParts = name.split(/[-_.\s]+/).filter(Boolean);
  if (sepParts.length >= 2) {
    return sepParts
      .slice(0, 3)
      .map((s) => s.charAt(0).toUpperCase())
      .join("");
  }

  // 尝试驼峰拆分
  const camelParts = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/\s+/);
  if (camelParts.length >= 2) {
    return camelParts
      .slice(0, 3)
      .map((s) => s.charAt(0).toUpperCase())
      .join("");
  }

  // 检测是否包含非 ASCII 字符（如中文）
  const hasNonAscii = /[^\x00-\x7F]/.test(name);
  if (hasNonAscii) {
    return name.slice(0, 2);
  }

  // 默认：取前 3 个字符
  return name.slice(0, 3).toUpperCase();
}

function shortenPath(fullPath: string): string {
  const normalized = fullPath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 3) return normalized;
  const head = parts[0].includes(":") ? parts[0] + "/" : "/" + parts[0];
  return head + "/.../" + parts.slice(-2).join("/");
}

// ─── Tooltip（Portal）──────────────────────────────────────────────

function Tooltip({
  anchorRef,
  name,
  shortPath,
  isActive,
  color,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  name: string;
  shortPath: string;
  isActive: boolean;
  color: { from: string; to: string };
}) {
  if (!anchorRef.current) return null;
  const rect = anchorRef.current.getBoundingClientRect();

  return createPortal(
    <div
      className="fixed pointer-events-none z-[9999]"
      style={{
        left: rect.right + 12,
        top: rect.top + rect.height / 2,
        transform: "translateY(-50%)",
      }}
    >
      <div className="px-3 py-2 rounded-lg bg-elevated border border-border-subtle shadow-xl shadow-black/50">
        <div className="flex items-center gap-2">
          <Folder size={13} style={{ color: color.from }} />
          <span className="text-[13px] font-mono font-medium text-t-primary whitespace-nowrap leading-none">
            {name}
          </span>
          {isActive && (
            <span className="text-[10px] font-mono text-neon/70 leading-none">current</span>
          )}
        </div>
        <div className="text-[11px] font-mono text-t-dim mt-1.5 whitespace-nowrap leading-none max-w-[320px] truncate">
          {shortPath}
        </div>
        {!isActive && (
          <div className="text-[10px] text-t-ghost mt-2 leading-none">
            Click to switch · Right-click for options
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── 右键菜单（Portal）────────────────────────────────────────────

function ContextMenu({
  anchorRef,
  onRemove,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onRemove: () => void;
  onClose: () => void;
}) {
  if (!anchorRef.current) return null;
  const rect = anchorRef.current.getBoundingClientRect();

  return createPortal(
    <>
      {/* 透明遮罩捕获点击关闭 */}
      <div className="fixed inset-0 z-[9998]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-[9999]"
        style={{
          left: rect.right + 6,
          top: rect.top,
        }}
      >
        <div className="py-1 rounded-lg bg-elevated border border-border-subtle shadow-xl shadow-black/50 min-w-[160px]">
          <button
            onClick={() => { onRemove(); onClose(); }}
            className="
              w-full flex items-center gap-2.5 px-3 py-1.5
              text-[12px] font-mono text-t-muted
              hover:text-danger hover:bg-danger/8
              transition-colors duration-100
            "
          >
            <Trash2 size={13} />
            <span>Delete Workspace</span>
          </button>
          <button
            onClick={onClose}
            className="
              w-full flex items-center gap-2.5 px-3 py-1.5
              text-[12px] font-mono text-t-muted
              hover:text-t-primary hover:bg-white/[0.05]
              transition-colors duration-100
            "
          >
            <FolderSync size={13} />
            <span>Reveal in Explorer</span>
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─── 拖拽指示线 ────────────────────────────────────────────────────

function DropIndicator({ anchorRef, position }: { anchorRef: React.RefObject<HTMLDivElement | null>; position: "before" | "after" }) {
  if (!anchorRef.current) return null;
  const rect = anchorRef.current.getBoundingClientRect();
  const y = position === "before" ? rect.top - 2 : rect.bottom + 2;

  return createPortal(
    <div
      className="fixed pointer-events-none z-[9997]"
      style={{
        left: rect.left + 4,
        top: y,
        width: rect.width - 8,
        height: 2,
        borderRadius: 1,
        background: "#00ff88",
        boxShadow: "0 0 6px rgba(0,255,136,0.5)",
      }}
    />,
    document.body,
  );
}

// ─── 单个文件夹按钮 ────────────────────────────────────────────────

const FolderButton = memo(function FolderButton({
  path,
  index,
  isActive,
  onClick,
  onRemove,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  isDragOver,
  dropPosition,
}: {
  path: string;
  index: number;
  isActive: boolean;
  onClick: () => void;
  onRemove: () => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (index: number) => void;
  isDragOver: boolean;
  dropPosition: "before" | "after" | null;
}) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const abbrev = useMemo(() => folderAbbrev(path), [path]);
  const name = folderName(path);
  const shortPath = useMemo(() => shortenPath(path), [path]);
  const color = useMemo(() => getGradient(path), [path]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(true);
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    onDragStart(index);
  }, [index, onDragStart]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    onDragOver(index, e);
  }, [index, onDragOver]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    onDrop(index);
  }, [index, onDrop]);

  // active: 渐变明亮 + 四边边框  inactive: 渐变极淡
  const activeOpacity = 0.3;
  const inactiveOpacity = 0.08;
  const hoverOpacity = 0.14;
  const opacity = isActive ? activeOpacity : hovered ? hoverOpacity : inactiveOpacity;

  return (
    <div
      ref={ref}
      className="relative shrink-0"
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={onDragEnd}
      onDrop={handleDrop}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
    >
      {/* 拖拽指示线 */}
      {isDragOver && dropPosition && (
        <DropIndicator anchorRef={ref} position={dropPosition} />
      )}

      <button
        onClick={onClick}
        onContextMenu={handleContextMenu}
        aria-label={name}
        className={`
          relative flex items-center justify-center
          w-[46px] h-[46px] rounded-lg overflow-hidden
          transition-all duration-200 cursor-pointer
          ${isActive ? "" : "hover:shadow-sm"}
        `}
        style={isActive ? {
          border: `1.5px solid ${color.from}60`,
          boxShadow: `0 0 10px ${color.from}25`,
        } : undefined}
      >
        {/* 渐变背景层 */}
        <div
          className="absolute inset-0 rounded-lg transition-opacity duration-200"
          style={{
            background: `linear-gradient(135deg, ${color.from}, ${color.to})`,
            opacity,
          }}
        />

        {/* 缩写文字 */}
        <span
          className="relative z-10 font-mono font-bold leading-none select-none transition-opacity duration-200"
          style={{
            fontSize: abbrev.length >= 3 ? "11px" : "13px",
            color: color.from,
            opacity: isActive ? 1 : hovered ? 0.75 : 0.5,
            textShadow: isActive ? `0 0 8px ${color.from}50` : "none",
            letterSpacing: abbrev.length >= 3 ? "0.5px" : "0.8px",
          }}
        >
          {abbrev}
        </span>
      </button>

      {/* 拖拽把手指示 — hover 时在按钮底部显示 */}
      {hovered && !menuOpen && (
        <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 pointer-events-none opacity-30">
          <GripVertical size={10} className="text-t-ghost" />
        </div>
      )}

      {/* Tooltip */}
      {hovered && !menuOpen && (
        <Tooltip anchorRef={ref} name={name} shortPath={shortPath} isActive={isActive} color={color} />
      )}

      {/* 右键菜单 */}
      {menuOpen && (
        <ContextMenu anchorRef={ref} onRemove={onRemove} onClose={() => setMenuOpen(false)} />
      )}
    </div>
  );
});

// ─── Activity Bar ──────────────────────────────────────────────────

export function ActivityBar() {
  const rootPath = useWorkspace((s) => s.rootPath);
  const recentFolders = useWorkspace((s) => s.recentFolders);
  const setRootPath = useWorkspace((s) => s.setRootPath);
  const removeRecentFolder = useWorkspace((s) => s.removeRecentFolder);
  const reorderFolders = useWorkspace((s) => s.reorderFolders);

  // ── 拖拽状态 ──
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<"before" | "after" | null>(null);

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((index: number, e: React.DragEvent) => {
    if (dragIndex === null || dragIndex === index) {
      setDragOverIndex(null);
      setDropPosition(null);
      return;
    }
    setDragOverIndex(index);
    // 根据鼠标位置决定是放在目标的上面还是下面
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropPosition(e.clientY < midY ? "before" : "after");
  }, [dragIndex]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
    setDropPosition(null);
  }, []);

  const handleDrop = useCallback((targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      handleDragEnd();
      return;
    }
    // 计算实际插入位置
    let toIndex = targetIndex;
    if (dropPosition === "after") {
      toIndex = targetIndex + (dragIndex < targetIndex ? 0 : 1);
    } else {
      toIndex = targetIndex - (dragIndex < targetIndex ? 1 : 0);
    }
    // 边界保护
    toIndex = Math.max(0, Math.min(toIndex, recentFolders.length - 1));
    reorderFolders(dragIndex, toIndex);
    handleDragEnd();
  }, [dragIndex, dropPosition, recentFolders.length, reorderFolders, handleDragEnd]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const result = await window.desktop.fs.selectFolder();
      if (result?.path) {
        setRootPath(result.path);
      }
    } catch { /* ignore */ }
  }, [setRootPath]);

  return (
    <div
      className="h-full bg-surface flex flex-col items-center py-3 gap-2 border-r border-border shrink-0 overflow-y-auto overflow-x-hidden scrollbar-none"
      style={{ width: ACTIVITY_BAR_WIDTH }}
    >
      {recentFolders.map((folder, index) => (
        <FolderButton
          key={folder}
          path={folder}
          index={index}
          isActive={rootPath === folder}
          onClick={() => setRootPath(folder)}
          onRemove={() => removeRecentFolder(folder)}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDrop={handleDrop}
          isDragOver={dragOverIndex === index}
          dropPosition={dragOverIndex === index ? dropPosition : null}
        />
      ))}

      {/* 底部：打开新文件夹 */}
      <div className="flex-1" />
      <button
        onClick={handleOpenFolder}
        title="打开文件夹"
        aria-label="打开文件夹"
        className="
          flex items-center justify-center
          w-[46px] h-[46px] rounded-lg shrink-0
          text-t-ghost hover:text-t-muted hover:bg-white/[0.05]
          border border-dashed border-border/50 hover:border-border-subtle
          transition-all duration-200
        "
      >
        <FolderOpen size={18} strokeWidth={1.5} />
      </button>
    </div>
  );
}
