import { useRef, useEffect } from 'react';

// 滚动条的宽度
const SCROLLBAR_WIDTH = 17;

type ScrollDirection = 'up' | 'down';

interface UseScrollbarDragOptions {
  onDragStart?: () => void;
  onDragging?: (direction?: ScrollDirection) => void;
  onDragEnd?: () => void;
}

export function useScrollbarDrag<T extends HTMLElement>(
  options: UseScrollbarDragOptions = {},
) {
  const containerRef = useRef<T>(null);
  const isDraggingScrollbar = useRef(false);
  const lastScrollTop = useRef(0);

  // 用 ref 存回调，事件处理器始终读取最新引用，useEffect 不再依赖回调变化
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseDown = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const clickX = e.clientX - rect.left;

      if (clickX >= rect.width - SCROLLBAR_WIDTH) {
        isDraggingScrollbar.current = true;
        callbacksRef.current.onDragStart?.();
      }
    };

    const handleScroll = () => {
      if (isDraggingScrollbar.current) {
        const currentScrollTop = container.scrollTop;
        const direction: ScrollDirection =
          currentScrollTop > lastScrollTop.current ? 'down' : 'up';
        lastScrollTop.current = currentScrollTop;
        callbacksRef.current.onDragging?.(direction);
      }
    };

    const handleMouseUp = () => {
      if (isDraggingScrollbar.current) {
        isDraggingScrollbar.current = false;
        callbacksRef.current.onDragEnd?.();
      }
    };

    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('scroll', handleScroll);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('scroll', handleScroll);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return containerRef;
}
