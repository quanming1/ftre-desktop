import { useRef, useCallback, useState, type ReactNode } from "react";
import { Minus, Square, X, Copy } from "lucide-react";

/**
 * 通用浮动子窗口组件。
 *
 * 特性：
 * - 标题栏拖拽移动（直接操作 DOM，不触发 React 重渲染）
 * - 四边 + 四角拖拽缩放（直接操作 DOM）
 * - 最小化 / 最大化 / 关闭 按钮
 * - 通过 CSS display 控制显隐，children 永远不会被 unmount
 *
 * 性能设计：
 * - 拖拽/缩放期间零 setState、零 store 写入、零 React 重渲染
 * - 所有中间态通过 DOM style 直接写入
 * - 只在操作结束时（mouseup）才可选地回调通知外部
 */

export interface FloatingWindowProps {
  /** 窗口标题（支持 ReactNode 以自定义图标等） */
  title: ReactNode;
  /** 是否可见 */
  visible: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 子内容 */
  children: ReactNode;
  /** 初始位置 & 尺寸 */
  defaultRect?: { x: number; y: number; width: number; height: number };
  /** 最小尺寸 */
  minWidth?: number;
  minHeight?: number;
  /** z-index */
  zIndex?: number;
  /** 窗口标题栏左侧自定义内容 */
  titleBarExtra?: ReactNode;
  /** 窗口大小变化后回调（拖拽缩放 mouseup / 最大化 / 还原 时触发，不在拖拽中间态触发） */
  onResized?: () => void;
}

const TITLEBAR_H = 36;
const DEFAULT_RECT = { x: 120, y: 80, width: 720, height: 420 };
const DEFAULT_MIN_W = 320;
const DEFAULT_MIN_H = 200;

export function FloatingWindow({
  title,
  visible,
  onClose,
  children,
  defaultRect,
  minWidth = DEFAULT_MIN_W,
  minHeight = DEFAULT_MIN_H,
  zIndex = 45,
  titleBarExtra,
  onResized,
}: FloatingWindowProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const [maximized, setMaximized] = useState(false);
  // 最大化前的位置，用于恢复
  const preMaxRect = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const initRect = defaultRect ?? DEFAULT_RECT;

  // ── 拖拽移动 ──────────────────────────────────────────────────────
  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (maximized) return; // 最大化时不允许拖拽
    const target = e.target as HTMLElement;
    // 点到按钮上不拖拽
    if (target.closest("button")) return;
    e.preventDefault();

    const win = windowRef.current;
    if (!win) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = win.getBoundingClientRect();
    const origLeft = rect.left;
    const origTop = rect.top;

    const onMove = (ev: MouseEvent) => {
      win.style.left = `${origLeft + (ev.clientX - startX)}px`;
      win.style.top = `${origTop + (ev.clientY - startY)}px`;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [maximized]);

  // ── 拖拽缩放 ──────────────────────────────────────────────────────
  const handleResizeMouseDown = useCallback((e: React.MouseEvent, edges: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean }) => {
    if (maximized) return;
    e.preventDefault();
    e.stopPropagation();

    const win = windowRef.current;
    if (!win) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = win.getBoundingClientRect();
    const origW = rect.width;
    const origH = rect.height;
    const origLeft = rect.left;
    const origTop = rect.top;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      let newW = origW;
      let newH = origH;
      let newLeft = origLeft;
      let newTop = origTop;

      if (edges.right) newW = Math.max(minWidth, origW + dx);
      if (edges.bottom) newH = Math.max(minHeight, origH + dy);
      if (edges.left) {
        const w = Math.max(minWidth, origW - dx);
        newLeft = origLeft + (origW - w);
        newW = w;
      }
      if (edges.top) {
        const h = Math.max(minHeight, origH - dy);
        newTop = origTop + (origH - h);
        newH = h;
      }

      win.style.width = `${newW}px`;
      win.style.height = `${newH}px`;
      win.style.left = `${newLeft}px`;
      win.style.top = `${newTop}px`;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      onResized?.();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [maximized, minWidth, minHeight, onResized]);

  // ── 最大化 / 还原 ─────────────────────────────────────────────────
  const handleToggleMaximize = useCallback(() => {
    const win = windowRef.current;
    if (!win) return;

    if (maximized) {
      // 还原
      const r = preMaxRect.current;
      if (r) {
        win.style.left = `${r.x}px`;
        win.style.top = `${r.y}px`;
        win.style.width = `${r.w}px`;
        win.style.height = `${r.h}px`;
      }
      setMaximized(false);
      // 延迟一帧让 DOM 更新完再回调
      requestAnimationFrame(() => onResized?.());
    } else {
      // 记住当前位置
      const rect = win.getBoundingClientRect();
      preMaxRect.current = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      // 全屏（留出顶部 titlebar 和底部 statusbar 的空间）
      win.style.left = "0px";
      win.style.top = "var(--titlebar-height)";
      win.style.width = "100vw";
      win.style.height = "calc(100vh - var(--titlebar-height) - var(--statusbar-height))";
      setMaximized(true);
      requestAnimationFrame(() => onResized?.());
    }
  }, [maximized, onResized]);

  // 缩放手柄的样式工厂
  const edgeClass = "absolute z-10";

  return (
    <div
      ref={windowRef}
      className="fixed flex flex-col bg-[#1a1a1a] border border-white/[0.08] rounded-xl shadow-2xl shadow-black/60 overflow-hidden"
      style={{
        left: initRect.x,
        top: initRect.y,
        width: initRect.width,
        height: initRect.height,
        zIndex,
        display: visible ? "flex" : "none",
      }}
    >
      {/* ── 缩放手柄（8 个方向）── */}
      {!maximized && (
        <>
          {/* 四边 */}
          <div className={`${edgeClass} top-0 left-2 right-2 h-[4px] cursor-n-resize`} onMouseDown={(e) => handleResizeMouseDown(e, { top: true })} />
          <div className={`${edgeClass} bottom-0 left-2 right-2 h-[4px] cursor-s-resize`} onMouseDown={(e) => handleResizeMouseDown(e, { bottom: true })} />
          <div className={`${edgeClass} left-0 top-2 bottom-2 w-[4px] cursor-w-resize`} onMouseDown={(e) => handleResizeMouseDown(e, { left: true })} />
          <div className={`${edgeClass} right-0 top-2 bottom-2 w-[4px] cursor-e-resize`} onMouseDown={(e) => handleResizeMouseDown(e, { right: true })} />
          {/* 四角 */}
          <div className={`${edgeClass} top-0 left-0 w-[8px] h-[8px] cursor-nw-resize`} onMouseDown={(e) => handleResizeMouseDown(e, { top: true, left: true })} />
          <div className={`${edgeClass} top-0 right-0 w-[8px] h-[8px] cursor-ne-resize`} onMouseDown={(e) => handleResizeMouseDown(e, { top: true, right: true })} />
          <div className={`${edgeClass} bottom-0 left-0 w-[8px] h-[8px] cursor-sw-resize`} onMouseDown={(e) => handleResizeMouseDown(e, { bottom: true, left: true })} />
          <div className={`${edgeClass} bottom-0 right-0 w-[8px] h-[8px] cursor-se-resize`} onMouseDown={(e) => handleResizeMouseDown(e, { bottom: true, right: true })} />
        </>
      )}

      {/* ── 标题栏 ── */}
      <div
        className="h-[36px] shrink-0 flex items-center bg-[#1a1a1a] select-none cursor-move"
        onMouseDown={handleTitleMouseDown}
        onDoubleClick={handleToggleMaximize}
      >
        <div className="px-3 text-[12px] text-t-secondary font-sans truncate flex-1">{title}</div>
        {titleBarExtra}
        {/* 窗口控制按钮 */}
        <div className="flex items-center shrink-0 h-full">
          <button
            onClick={onClose}
            className="w-10 h-full flex items-center justify-center text-t-ghost hover:bg-white/[0.08] hover:text-t-muted transition-colors"
            title="最小化（隐藏）"
          >
            <Minus size={12} strokeWidth={1.5} />
          </button>
          <button
            onClick={handleToggleMaximize}
            className="w-10 h-full flex items-center justify-center text-t-ghost hover:bg-white/[0.08] hover:text-t-muted transition-colors"
            title={maximized ? "还原" : "最大化"}
          >
            {maximized ? <Copy size={10} strokeWidth={1.5} /> : <Square size={9} strokeWidth={1.5} />}
          </button>
          <button
            onClick={onClose}
            className="w-10 h-full flex items-center justify-center text-t-ghost hover:bg-[#c42b1c] hover:text-white transition-colors"
            title="关闭"
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* ── 内容区 ── */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
