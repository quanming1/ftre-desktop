import { useRef, useEffect, useCallback, useMemo } from "react";
import { useScrollbarDrag } from "./useScrollbarDrag";
import { bindRef } from "./bindRef";

/** 距底部多少像素以内视为"在底部"，自动恢复跟随 */
const LOCK_THRESHOLD = 30;
/** wheel 向上解锁后的防抖窗口（ms），此时间内 scroll 事件不恢复锁定 */
const WHEEL_DEBOUNCE_MS = 200;

export function useAutoScrollToBottom(
  deps?: any[],
  config: { autoScrollLockDefault: boolean } = { autoScrollLockDefault: true },
) {
  const containerRef = useRef<HTMLElement>(null);
  const lockRef = useRef(config.autoScrollLockDefault);
  const lastWheelUpTime = useRef(0);

  // 切 session 等场景：重置锁
  useEffect(() => {
    if (!deps) return;
    lockRef.current = config.autoScrollLockDefault;
    lastWheelUpTime.current = 0;
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
    lastWheelUpTime.current = 0;
  }, []);

  // 滚动条拖拽：让 useScrollbarDrag 持有 ref，这样 scroll 事件正常发出
  const dragRef = useScrollbarDrag<HTMLElement>();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // wheel 向上 → 立即解锁 + 记录时间
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        lockRef.current = false;
        lastWheelUpTime.current = Date.now();
      } else if (e.deltaY > 0) {
        // 向下滚 → 清除防抖，允许 scroll handler 恢复锁定
        lastWheelUpTime.current = 0;
      }
    };

    // scroll 事件：防抖窗口内不恢复锁定，避免 wheel unlock 被秒覆盖
    const onScroll = () => {
      if (Date.now() - lastWheelUpTime.current < WHEEL_DEBOUNCE_MS) return;

      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      lockRef.current = dist < LOCK_THRESHOLD;
    };

    // ResizeObserver: 内容高度变化时（如 CodeDiff 异步展开），若锁定在底部则自动跟随
    const ro = new ResizeObserver(() => {
      if (!lockRef.current) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    });
    ro.observe(el);

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ref = useMemo(() => bindRef(containerRef, dragRef), []);

  return { ref, scrollToBottom, resetLock };
}
