import { useCallback, useRef, useState } from "react";
import { cn } from "../utils/cn";

export interface ResizeHandleProps {
  /** Drag direction */
  direction?: "horizontal" | "vertical";
  /** Callback during drag, delta is pixel offset */
  onResize: (delta: number) => void;
  className?: string;
}

export function ResizeHandle({
  direction = "horizontal",
  onResize,
  className,
}: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const startPos = useRef(0);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const isH = direction === "horizontal";

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      startPos.current = isH ? e.clientX : e.clientY;

      const onMove = (ev: MouseEvent) => {
        const current = isH ? ev.clientX : ev.clientY;
        const delta = current - startPos.current;
        startPos.current = current;
        onResizeRef.current(delta);
      };

      const onUp = () => {
        setDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
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
        "shrink-0 relative flex items-center justify-center",
        isH ? "w-[6px] h-full cursor-col-resize" : "w-full h-[6px] cursor-row-resize",
        className,
      )}
    >
      {/* Divider line */}
      <div
        className={cn(
          "transition-colors duration-100",
          isH ? "h-full w-[4px]" : "w-full h-[4px]",
          showHighlight
            ? "bg-[#555]"
            : "bg-[var(--ftre-border,#3c3c3c)]",
        )}
      />
    </div>
  );
}
