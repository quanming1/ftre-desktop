/**
 * 通用水波纹 hook + 渲染组件
 *
 * 从 SessionPanel 提取，供 Inspector tab 等组件复用。
 * CSS 类 .ftre-ripple / .ftre-ripple--light 定义在 global.css
 */
import { useState, useCallback, useRef } from "react";

export interface RippleItem {
  id: number;
  x: number;
  y: number;
  size: number;
}

export function useRipple() {
  const [ripples, setRipples] = useState<RippleItem[]>([]);
  const idRef = useRef(0);
  const trigger = useCallback((e: React.MouseEvent<Element>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const id = ++idRef.current;
    setRipples((prev) => [
      ...prev,
      { id, x: e.clientX - rect.left - size / 2, y: e.clientY - rect.top - size / 2, size },
    ]);
  }, []);
  const remove = useCallback(
    (id: number) => setRipples((prev) => prev.filter((p) => p.id !== id)),
    [],
  );
  return { ripples, trigger, remove };
}

export function RippleLayer({
  items,
  onEnd,
}: {
  items: RippleItem[];
  onEnd: (id: number) => void;
}) {
  return (
    <>
      {items.map((r) => (
        <span
          key={r.id}
          className="ftre-ripple"
          style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
          onAnimationEnd={() => onEnd(r.id)}
        />
      ))}
    </>
  );
}
