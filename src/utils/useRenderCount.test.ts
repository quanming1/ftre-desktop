import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRenderCount } from './useRenderCount';

describe('useRenderCount', () => {
    it('returns 1 on initial render', () => {
        const { result } = renderHook(() => useRenderCount('TestComponent'));
        expect(result.current).toBe(1);
    });

    it('increments on each re-render', () => {
        const { result, rerender } = renderHook(() => useRenderCount('TestComponent'));
        expect(result.current).toBe(1);

        rerender();
        expect(result.current).toBe(2);

        rerender();
        expect(result.current).toBe(3);
    });

    it('tracks independently per hook instance', () => {
        const { result: r1 } = renderHook(() => useRenderCount('A'));
        const { result: r2 } = renderHook(() => useRenderCount('B'));
        expect(r1.current).toBe(1);
        expect(r2.current).toBe(1);
    });
});
