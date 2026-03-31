import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useScrollbarDrag } from './useScrollbarDrag';
import { bindRef } from './bindRef';

/** wheel 事件防抖时间（毫秒），在此时间内不进行自动滚动，防止用户向上滚动时抖动 */
const WHEEL_DEBOUNCE_MS = 200;
/** 距离底部多少像素以内时，自动恢复滚动锁定 */
const FORCE_LOCK_DISTANCE = 100;
/** 距离底部多少像素以内视为"已到底"，用于处理亚像素精度问题 */
const SNAP_TO_BOTTOM_THRESHOLD = 10;

export function useAutoScrollToBottom(
  deps?: React.DependencyList,
  config = {
    autoScrollLockDefault: true,
  },
) {
  const containerRef = useRef<HTMLElement>(null);
  const autoScrollLock = useRef(config.autoScrollLockDefault); // 自动滚动锁，true为自动滚动到最下，默认开启
  const lastWheelTopTime = useRef<number>(0); // 上一次wheel的时间，WHEEL_DEBOUNCE_MS 以内不进行滚动防止抖动

  useEffect(() => {
    if (!deps) return;
    autoScrollLock.current = config.autoScrollLockDefault;
    lastWheelTopTime.current = 0;
  }, deps ?? []);

  const scrollbarDragRef = useScrollbarDrag({
    onDragging: (direction) => {
      if (direction === 'up') {
        autoScrollLock.current = false;
      } else if (direction === 'down') {
        lastWheelTopTime.current = 0;
      }
    },
  });

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'instant') => {
    const container = containerRef.current;
    if (!container || !autoScrollLock.current) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    // 距离底部很近时强制用 instant，避免 smooth 动画因距离太短而不生效或被打断
    const effectiveBehavior =
      distanceFromBottom > 0 && distanceFromBottom <= SNAP_TO_BOTTOM_THRESHOLD
        ? 'instant'
        : behavior;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: effectiveBehavior,
    });
  }, []);

  /** 强制重置锁状态（用于"新一轮对话开始"等场景） */
  const resetLock = useCallback(() => {
    autoScrollLock.current = true;
    lastWheelTopTime.current = 0;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        lastWheelTopTime.current = Date.now();
        autoScrollLock.current = false;
      } else if (e.deltaY > 0) {
        lastWheelTopTime.current = 0;
      }
    };

    const handleScroll = () => {
      if (Date.now() - lastWheelTopTime.current < WHEEL_DEBOUNCE_MS) {
        return;
      }

      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      if (distanceFromBottom < FORCE_LOCK_DISTANCE) {
        autoScrollLock.current = true;
      }
    };

    container.addEventListener('wheel', handleWheel);
    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('scroll', handleScroll);
    };
  }, [containerRef.current]);

  // 稳定 ref 引用，避免每次渲染都创建新 callback 导致下游 mergedRef 重建
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRef = useMemo(() => bindRef(containerRef, scrollbarDragRef), []);

  return {
    ref: stableRef,
    scrollToBottom,
    resetLock,
  };
}
