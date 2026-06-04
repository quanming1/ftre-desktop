import { useCallback, useRef, useState } from "react";
import { cn } from "../utils/cn";

export interface ResizeHandleProps {
  /** Drag direction */
  direction?: "horizontal" | "vertical";
  /**
   * Drag callback. delta is the requested pixel offset for this tick.
   * Optionally return the *actually applied* delta (after clamping) so the
   * handle can keep cursor and divider aligned at min/max bounds. If nothing
   * is returned, the full delta is assumed to have been applied.
   */
  onResize: (delta: number) => number | void;
  /** Fires on mousedown (drag begin). */
  onResizeStart?: () => void;
  /** Fires on mouseup (drag end). */
  onResizeEnd?: () => void;
  className?: string;
}

export function ResizeHandle({
  direction = "horizontal",
  onResize,
  onResizeStart,
  onResizeEnd,
  className,
}: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const startPos = useRef(0);
  const onResizeRef = useRef(onResize);
  const onResizeStartRef = useRef(onResizeStart);
  const onResizeEndRef = useRef(onResizeEnd);
  onResizeRef.current = onResize;
  onResizeStartRef.current = onResizeStart;
  onResizeEndRef.current = onResizeEnd;

  const isH = direction === "horizontal";

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      onResizeStartRef.current?.();
      startPos.current = isH ? e.clientX : e.clientY;

      const onMove = (ev: MouseEvent) => {
        const current = isH ? ev.clientX : ev.clientY;
        const delta = current - startPos.current;
        if (delta === 0) return;
        const applied = onResizeRef.current(delta);
        // If the consumer reports the actually applied delta (e.g. after
        // clamping width to min/max), only advance startPos by that much so
        // the cursor stays glued to the divider when the user reverses.
        const effective = typeof applied === "number" ? applied : delta;
        startPos.current += effective;
      };

      const onUp = () => {
        setDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        onResizeEndRef.current?.();
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = isH ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [isH],
  );

  const showHighlight = hovered || dragging;

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "shrink-0 relative flex items-center justify-center group",
        isH ? "w-[6px] h-full cursor-col-resize" : "w-full h-[6px] cursor-row-resize",
        className,
      )}
    >
      {/*
        分隔条 — 默认隐藏；hover/drag 时显示一根细线。
        - hover 80ms 延迟淡入，避免鼠标划过时一闪；
        - 用 mask 在两端做柔化，避免和上下边界形成硬接缝；
        - drag 时立即可见、更醒目。
      */}
      <div
        style={
          isH
            ? {
                WebkitMaskImage:
                  "linear-gradient(to bottom, transparent, black 8%, black 92%, transparent)",
                maskImage:
                  "linear-gradient(to bottom, transparent, black 8%, black 92%, transparent)",
              }
            : {
                WebkitMaskImage:
                  "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
                maskImage:
                  "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
              }
        }
        className={cn(
          "transition-opacity ease-out bg-[var(--ftre-accent-default,#5a82ff)]",
          isH ? "h-full w-[2px]" : "w-full h-[2px]",
          dragging
            ? "opacity-100 duration-75"
            : showHighlight
              ? "opacity-90 duration-200 delay-[80ms]"
              : "opacity-0 duration-150",
        )}
      />
    </div>
  );
}
