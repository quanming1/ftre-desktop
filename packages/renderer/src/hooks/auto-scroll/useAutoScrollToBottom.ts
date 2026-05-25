import { useRef, useEffect, useCallback, useMemo } from "react";
import { useScrollbarDrag } from "./useScrollbarDrag";
import { bindRef } from "./bindRef";

/**
 * 距底部 < LOCK_THRESHOLD px → 视为"用户在底部 / 想跟随"。
 * 任意输入路径（wheel / 触摸板 / 触屏 / 键盘 / 滚动条拖拽）都会触发 scroll 事件，
 * 在 handler 里重新评估这个距离即可决定是否继续跟随，无需 drift 检测 / wheel 防抖。
 */
const LOCK_THRESHOLD = 100;

export function useAutoScrollToBottom(
  deps?: any[],
  config: { autoScrollLockDefault: boolean } = { autoScrollLockDefault: true },
) {
  const containerRef = useRef<HTMLElement>(null);
  const lockRef = useRef(config.autoScrollLockDefault);

  // 切 session 等场景：重置锁
  useEffect(() => {
    if (!deps) return;
    lockRef.current = config.autoScrollLockDefault;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? []);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el || !lockRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
  }, []);

  /** 用于"新一轮对话开始"时强制重新跟随。 */
  const resetLock = useCallback(() => {
    lockRef.current = true;
  }, []);

  // 滚动条拖拽：让 useScrollbarDrag 持有 ref，这样 scroll 事件正常发出
  const dragRef = useScrollbarDrag<HTMLElement>();

  // scroll handler：唯一的锁状态来源——是否在底部范围内。
  // wheel handler 仅作为"上滚立即解锁"的快速路径，scroll 事件兜底。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      lockRef.current = dist < LOCK_THRESHOLD;
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) lockRef.current = false;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ref = useMemo(() => bindRef(containerRef, dragRef), []);

  return { ref, scrollToBottom, resetLock };
}
