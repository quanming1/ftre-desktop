import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VLManager } from '../vl-manager';

export interface UseVirtualizationOptions {
  count: number;
  getItemHeight: number | ((index: number) => number);
  containerRef: React.RefObject<HTMLElement | null>;
  overscan?: number;
  forceIncludeRange?: { start: number; end: number } | null;
}

export interface VirtualizationResult {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  totalHeight: number;
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void;
}

export function useVirtualization({
  count,
  getItemHeight,
  containerRef,
  overscan = 10,
  forceIncludeRange,
}: UseVirtualizationOptions): VirtualizationResult {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const isFixedHeight = typeof getItemHeight === 'number';
  const fixedHeight = isFixedHeight ? getItemHeight : 0;

  // 始终使用 VLManager，固定高度和动态高度统一处理
  const managerRef = useRef<VLManager | null>(null);
  
  // 确保 manager 存在且配置正确
  if (!managerRef.current || managerRef.current.cache.length !== count) {
    managerRef.current = new VLManager({
      len: count,
      presetHeight: isFixedHeight ? fixedHeight : 50,
      bufferSize: overscan,
    });
  }
  
  const manager = managerRef.current;

  // 动态高度时更新缓存
  useEffect(() => {
    if (!isFixedHeight && manager) {
      for (let i = 0; i < count; i++) {
        manager.setCache(i, (getItemHeight as (index: number) => number)(i));
      }
    }
  }, [isFixedHeight, count, getItemHeight, manager]);

  // 计算可见范围
  const { startIndex, endIndex, topSpacerHeight, bottomSpacerHeight, totalHeight } = useMemo(() => {
    if (count === 0) {
      return { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0, totalHeight: 0 };
    }

    const range = manager.getRenderRange({
      offsetOfTop: scrollTop,
      maxRenderHeight: viewportHeight,
      len: count,
    });

    let start = range.topIndex;
    let end = range.bottomIndex;
    let topSpacer = range.topBlank;
    let bottomSpacer = range.bottomBlank;

    // 应用 forceIncludeRange
    if (forceIncludeRange) {
      const forceStart = Math.max(0, forceIncludeRange.start);
      const forceEnd = Math.min(count, forceIncludeRange.end + 1);
      
      if (forceStart < start) {
        // 需要向上扩展，重新计算 topSpacer
        for (let i = forceStart; i < start; i++) {
          topSpacer -= manager.getCache(i);
        }
        start = forceStart;
      }
      
      if (forceEnd > end) {
        // 需要向下扩展，重新计算 bottomSpacer
        for (let i = end; i < forceEnd; i++) {
          bottomSpacer -= manager.getCache(i);
        }
        end = forceEnd;
      }
    }

    return {
      startIndex: start,
      endIndex: end,
      topSpacerHeight: Math.max(0, topSpacer),
      bottomSpacerHeight: Math.max(0, bottomSpacer),
      totalHeight: manager.getTotalHeight(),
    };
  }, [count, scrollTop, viewportHeight, forceIncludeRange, manager]);

  // 监听滚动和 resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const syncViewport = () => {
      setScrollTop(el.scrollTop);
      setViewportHeight(el.clientHeight);
    };

    syncViewport();
    el.addEventListener('scroll', syncViewport, { passive: true });

    const ro = new ResizeObserver(() => syncViewport());
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', syncViewport);
      ro.disconnect();
    };
  }, [containerRef]);

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = 'auto') => {
      const el = containerRef.current;
      if (!el || index < 0 || index >= count) return;

      let targetTop = 0;
      for (let i = 0; i < index; i++) {
        targetTop += manager.getCache(i);
      }
      const itemHeight = manager.getCache(index);

      const itemBottom = targetTop + itemHeight;
      const viewTop = el.scrollTop;
      const viewBottom = viewTop + el.clientHeight;

      // 已在可视区域内，不滚动
      if (targetTop >= viewTop && itemBottom <= viewBottom) {
        return;
      }

      // 滚动到居中位置
      const scrollTarget = Math.max(
        0,
        targetTop - Math.max(0, (el.clientHeight - itemHeight) / 2)
      );

      el.scrollTo({ top: scrollTarget, behavior });
    },
    [containerRef, count, manager]
  );

  return {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    totalHeight,
    scrollToIndex,
  };
}
