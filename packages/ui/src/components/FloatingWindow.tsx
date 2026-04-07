import { useRef, useCallback, useState, type ReactNode } from "react";
import { Minus, Square, X, Copy } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../utils/cn";

export interface FloatingWindowProps {
  /** Window title (supports ReactNode for custom icons etc.) */
  title: ReactNode;
  /** Whether the window is visible */
  visible: boolean;
  /** Close callback */
  onClose: () => void;
  /** Child content */
  children: ReactNode;
  /** Initial position & size */
  defaultRect?: { x: number; y: number; width: number; height: number };
  /** Minimum size */
  minWidth?: number;
  minHeight?: number;
  /** z-index */
  zIndex?: number;
  /** Custom content for the left side of the title bar */
  titleBarExtra?: ReactNode;
  /** Callback after window size changes (triggered on resize mouseup / maximize / restore, not during drag) */
  onResized?: () => void;
  /** CSS variable for titlebar height, default: --titlebar-height */
  titlebarHeightVar?: string;
  /** CSS variable for statusbar height, default: --statusbar-height */
  statusbarHeightVar?: string;
  className?: string;
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
  titlebarHeightVar = "--titlebar-height",
  statusbarHeightVar = "--statusbar-height",
  className,
}: FloatingWindowProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const [maximized, setMaximized] = useState(false);
  const preMaxRect = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const initRect = defaultRect ?? DEFAULT_RECT;

  const handleTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (maximized) return;
      const target = e.target as HTMLElement;
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
    },
    [maximized],
  );

  const handleResizeMouseDown = useCallback(
    (
      e: React.MouseEvent,
      edges: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean },
    ) => {
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
    },
    [maximized, minWidth, minHeight, onResized],
  );

  const handleToggleMaximize = useCallback(() => {
    const win = windowRef.current;
    if (!win) return;

    if (maximized) {
      const r = preMaxRect.current;
      if (r) {
        win.style.left = `${r.x}px`;
        win.style.top = `${r.y}px`;
        win.style.width = `${r.w}px`;
        win.style.height = `${r.h}px`;
      }
      setMaximized(false);
      requestAnimationFrame(() => onResized?.());
    } else {
      const rect = win.getBoundingClientRect();
      preMaxRect.current = {
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
      };
      win.style.left = "0px";
      win.style.top = `var(${titlebarHeightVar})`;
      win.style.width = "100vw";
      win.style.height = `calc(100vh - var(${titlebarHeightVar}) - var(${statusbarHeightVar}))`;
      setMaximized(true);
      requestAnimationFrame(() => onResized?.());
    }
  }, [maximized, onResized, titlebarHeightVar, statusbarHeightVar]);

  const edgeClass = "absolute z-10";

  return (
    <motion.div
      ref={windowRef}
      initial={false}
      animate={{
        opacity: visible ? 1 : 0,
        scale: visible ? 1 : 0.95,
        y: visible ? 0 : -10,
      }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={cn(
        "fixed flex flex-col rounded-md border shadow-2xl overflow-hidden",
        "bg-[var(--ftre-base,#1e1e1e)] border-[var(--ftre-border,#3c3c3c)] shadow-black/60",
        className,
      )}
      style={{
        left: initRect.x,
        top: initRect.y,
        width: initRect.width,
        height: initRect.height,
        zIndex,
        pointerEvents: visible ? "auto" : "none",
        visibility: visible ? "visible" : "hidden",
      }}
    >
      {/* Resize handles (8 directions) */}
      {!maximized && (
        <>
          <div
            className={`${edgeClass} top-0 left-2 right-2 h-[4px] cursor-n-resize`}
            onMouseDown={(e) => handleResizeMouseDown(e, { top: true })}
          />
          <div
            className={`${edgeClass} bottom-0 left-2 right-2 h-[4px] cursor-s-resize`}
            onMouseDown={(e) => handleResizeMouseDown(e, { bottom: true })}
          />
          <div
            className={`${edgeClass} left-0 top-2 bottom-2 w-[4px] cursor-w-resize`}
            onMouseDown={(e) => handleResizeMouseDown(e, { left: true })}
          />
          <div
            className={`${edgeClass} right-0 top-2 bottom-2 w-[4px] cursor-e-resize`}
            onMouseDown={(e) => handleResizeMouseDown(e, { right: true })}
          />
          <div
            className={`${edgeClass} top-0 left-0 w-[8px] h-[8px] cursor-nw-resize`}
            onMouseDown={(e) =>
              handleResizeMouseDown(e, { top: true, left: true })
            }
          />
          <div
            className={`${edgeClass} top-0 right-0 w-[8px] h-[8px] cursor-ne-resize`}
            onMouseDown={(e) =>
              handleResizeMouseDown(e, { top: true, right: true })
            }
          />
          <div
            className={`${edgeClass} bottom-0 left-0 w-[8px] h-[8px] cursor-sw-resize`}
            onMouseDown={(e) =>
              handleResizeMouseDown(e, { bottom: true, left: true })
            }
          />
          <div
            className={`${edgeClass} bottom-0 right-0 w-[8px] h-[8px] cursor-se-resize`}
            onMouseDown={(e) =>
              handleResizeMouseDown(e, { bottom: true, right: true })
            }
          />
        </>
      )}

      {/* Title bar */}
      <div
        className="h-[36px] shrink-0 flex items-center bg-[var(--ftre-base,#1e1e1e)] select-none cursor-move"
        onMouseDown={handleTitleMouseDown}
        onDoubleClick={handleToggleMaximize}
      >
        <div className="px-3 text-[12px] text-[var(--ftre-text-secondary,#cccccc)] truncate flex-1">
          {title}
        </div>
        {titleBarExtra}
        <div className="flex items-center shrink-0 h-full">
          <button
            onClick={onClose}
            className="w-10 h-full flex items-center justify-center text-[var(--ftre-text-ghost,#888e98)] hover:bg-[var(--ftre-accent-ghost,rgba(0,255,136,0.06))] hover:text-[var(--ftre-text-muted,#aab0b8)] transition-colors"
            title="Minimize (Hide)"
          >
            <Minus size={12} strokeWidth={1.5} />
          </button>
          <button
            onClick={handleToggleMaximize}
            className="w-10 h-full flex items-center justify-center text-[var(--ftre-text-ghost,#888e98)] hover:bg-[var(--ftre-accent-ghost,rgba(0,255,136,0.06))] hover:text-[var(--ftre-text-muted,#aab0b8)] transition-colors"
            title={maximized ? "Restore" : "Maximize"}
          >
            {maximized ? (
              <Copy size={10} strokeWidth={1.5} />
            ) : (
              <Square size={9} strokeWidth={1.5} />
            )}
          </button>
          <button
            onClick={onClose}
            className="w-10 h-full flex items-center justify-center text-[var(--ftre-text-ghost,#888e98)] hover:bg-[var(--ftre-error,#f85149)] hover:text-[var(--ftre-text-primary,#e8e8e8)] transition-colors"
            title="Close"
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">{children}</div>
    </motion.div>
  );
}
