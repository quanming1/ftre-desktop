import { useCallback, useRef, useState } from "react";

interface ResizeHandleProps {
  /** 拖拽方向 */
  direction?: "horizontal" | "vertical";
  /** 拖拽时回调，delta 为像素偏移量 */
  onResize: (delta: number) => void;
}

export function ResizeHandle({ direction = "horizontal", onResize }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
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

  return (
    <div
      onMouseDown={onMouseDown}
      className={`shrink-0 relative group ${
        isH ? "w-[3px] cursor-col-resize hover:bg-neon/20" : "h-[3px] cursor-row-resize hover:bg-neon/20"
      } ${dragging ? "bg-neon/30" : "bg-transparent"} transition-colors`}
    >
      {/* 扩大点击区域 */}
      <div className={`absolute ${isH ? "inset-y-0 -left-2 -right-2" : "inset-x-0 -top-2 -bottom-2"}`} />
    </div>
  );
}
