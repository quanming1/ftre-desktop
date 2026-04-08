import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useVirtualization } from './useVirtualization';

function createMockContainer(options: { clientHeight: number; scrollTop: number }) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientHeight', { value: options.clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: options.scrollTop, writable: true });
  el.scrollTo = vi.fn(({ top }) => {
    (el as any).scrollTop = top;
  });
  return el;
}

describe('useVirtualization', () => {
  describe('fixed height', () => {
    it('should calculate visible range for fixed height items', () => {
      const container = createMockContainer({ clientHeight: 300, scrollTop: 0 });
      
      const { result } = renderHook(() => {
        const ref = useRef<HTMLElement>(container);
        return useVirtualization({
          count: 100,
          getItemHeight: 30,
          containerRef: ref,
          overscan: 5,
        });
      });

      expect(result.current.startIndex).toBe(0);
      expect(result.current.endIndex).toBeGreaterThan(10);
      expect(result.current.topSpacerHeight).toBe(0);
      expect(result.current.totalHeight).toBe(3000);
    });

    it('should calculate correct spacer heights', () => {
      const container = createMockContainer({ clientHeight: 300, scrollTop: 600 });
      
      const { result } = renderHook(() => {
        const ref = useRef<HTMLElement>(container);
        return useVirtualization({
          count: 100,
          getItemHeight: 30,
          containerRef: ref,
          overscan: 5,
        });
      });

      expect(result.current.startIndex).toBeLessThan(20);
      expect(result.current.topSpacerHeight).toBe(result.current.startIndex * 30);
      expect(result.current.bottomSpacerHeight).toBe((100 - result.current.endIndex) * 30);
    });

    it('should include forceIncludeRange', () => {
      const container = createMockContainer({ clientHeight: 300, scrollTop: 0 });
      
      const { result } = renderHook(() => {
        const ref = useRef<HTMLElement>(container);
        return useVirtualization({
          count: 100,
          getItemHeight: 30,
          containerRef: ref,
          overscan: 5,
          forceIncludeRange: { start: 80, end: 85 },
        });
      });

      expect(result.current.endIndex).toBeGreaterThanOrEqual(86);
    });

    it('should handle empty list', () => {
      const container = createMockContainer({ clientHeight: 300, scrollTop: 0 });
      
      const { result } = renderHook(() => {
        const ref = useRef<HTMLElement>(container);
        return useVirtualization({
          count: 0,
          getItemHeight: 30,
          containerRef: ref,
        });
      });

      expect(result.current.startIndex).toBe(0);
      expect(result.current.endIndex).toBe(0);
      expect(result.current.totalHeight).toBe(0);
    });

    it('should clamp forceIncludeRange to valid bounds', () => {
      const container = createMockContainer({ clientHeight: 300, scrollTop: 0 });
      
      const { result } = renderHook(() => {
        const ref = useRef<HTMLElement>(container);
        return useVirtualization({
          count: 50,
          getItemHeight: 30,
          containerRef: ref,
          forceIncludeRange: { start: -10, end: 100 },
        });
      });

      expect(result.current.startIndex).toBe(0);
      expect(result.current.endIndex).toBe(50);
    });
  });

  describe('dynamic height', () => {
    it('should calculate visible range for dynamic height items', () => {
      const container = createMockContainer({ clientHeight: 300, scrollTop: 0 });
      const getHeight = (i: number) => (i % 2 === 0 ? 40 : 60);
      
      const { result } = renderHook(() => {
        const ref = useRef<HTMLElement>(container);
        return useVirtualization({
          count: 100,
          getItemHeight: getHeight,
          containerRef: ref,
          overscan: 5,
        });
      });

      expect(result.current.startIndex).toBe(0);
      expect(result.current.endIndex).toBeGreaterThan(5);
      expect(result.current.topSpacerHeight).toBe(0);
      expect(result.current.totalHeight).toBe(50 * 40 + 50 * 60);
    });

    it('should calculate correct spacer heights for dynamic items', () => {
      const container = createMockContainer({ clientHeight: 300, scrollTop: 500 });
      const getHeight = () => 50;
      
      const { result } = renderHook(() => {
        const ref = useRef<HTMLElement>(container);
        return useVirtualization({
          count: 100,
          getItemHeight: getHeight,
          containerRef: ref,
          overscan: 3,
        });
      });

      let expectedTop = 0;
      for (let i = 0; i < result.current.startIndex; i++) {
        expectedTop += 50;
      }
      expect(result.current.topSpacerHeight).toBe(expectedTop);
    });
  });

  describe('scrollToIndex', () => {
    it('should scroll to index for fixed height', () => {
      const container = createMockContainer({ clientHeight: 300, scrollTop: 0 });
      
      const { result } = renderHook(() => {
        const ref = useRef<HTMLElement>(container);
        return useVirtualization({
          count: 100,
          getItemHeight: 30,
          containerRef: ref,
        });
      });

      act(() => {
        result.current.scrollToIndex(50);
      });

      expect(container.scrollTo).toHaveBeenCalled();
    });

    it('should not scroll if item is already visible', () => {
      const container = createMockContainer({ clientHeight: 300, scrollTop: 0 });
      
      const { result } = renderHook(() => {
        const ref = useRef<HTMLElement>(container);
        return useVirtualization({
          count: 100,
          getItemHeight: 30,
          containerRef: ref,
        });
      });

      act(() => {
        result.current.scrollToIndex(5);
      });

      expect(container.scrollTo).not.toHaveBeenCalled();
    });

    it('should handle invalid index', () => {
      const container = createMockContainer({ clientHeight: 300, scrollTop: 0 });
      
      const { result } = renderHook(() => {
        const ref = useRef<HTMLElement>(container);
        return useVirtualization({
          count: 100,
          getItemHeight: 30,
          containerRef: ref,
        });
      });

      act(() => {
        result.current.scrollToIndex(-1);
        result.current.scrollToIndex(200);
      });

      expect(container.scrollTo).not.toHaveBeenCalled();
    });
  });
});
