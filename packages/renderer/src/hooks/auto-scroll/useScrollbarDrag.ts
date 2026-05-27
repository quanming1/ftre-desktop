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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { onDragStart, onDragging, onDragEnd } = options;

    const handleMouseDown = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const clickX = e.clientX - rect.left;

      if (clickX >= rect.width - SCROLLBAR_WIDTH) {
        isDraggingScrollbar.current = true;
        onDragStart?.();
      }
    };

    const handleScroll = () => {
      if (isDraggingScrollbar.current) {
        const currentScrollTop = container.scrollTop;
        const direction: ScrollDirection =
          currentScrollTop > lastScrollTop.current ? 'down' : 'up';
        lastScrollTop.current = currentScrollTop;
        onDragging?.(direction);
      }
    };

    const handleMouseUp = () => {
      if (isDraggingScrollbar.current) {
        isDraggingScrollbar.current = false;
        onDragEnd?.();
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
  }, [options.onDragStart, options.onDragging, options.onDragEnd]);

  return containerRef;
}
