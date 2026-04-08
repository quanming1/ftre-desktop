import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useCacheState } from './useCacheState';
import { VirtualListContext } from '../context';

const createWrapper = (cache: Map<string, unknown>) => {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <VirtualListContext.Provider
        value={{
          changeHeight: () => {},
          globalStateCache: cache,
          registerDestroy: () => {},
        }}
      >
        {children}
      </VirtualListContext.Provider>
    );
  };
};

describe('useCacheState', () => {
  it('should return initial value when cache is empty', () => {
    const cache = new Map();
    const { result } = renderHook(() => useCacheState('initial', 'test-key'), {
      wrapper: createWrapper(cache),
    });

    expect(result.current[0]).toBe('initial');
  });

  it('should return cached value when available', () => {
    const cache = new Map([['test-key', 'cached-value']]);
    const { result } = renderHook(() => useCacheState('initial', 'test-key'), {
      wrapper: createWrapper(cache),
    });

    expect(result.current[0]).toBe('cached-value');
  });

  it('should update state and cache', () => {
    const cache = new Map();
    const { result } = renderHook(() => useCacheState('initial', 'test-key'), {
      wrapper: createWrapper(cache),
    });

    act(() => {
      result.current[1]('updated');
    });

    expect(result.current[0]).toBe('updated');
    expect(cache.get('test-key')).toBe('updated');
  });

  it('should support function updater', () => {
    const cache = new Map();
    const { result } = renderHook(() => useCacheState(0, 'counter'), {
      wrapper: createWrapper(cache),
    });

    act(() => {
      result.current[1]((prev) => prev + 1);
    });

    expect(result.current[0]).toBe(1);
    expect(cache.get('counter')).toBe(1);
  });

  it('should support lazy initial value', () => {
    const cache = new Map();
    const initializer = () => 'lazy-value';
    const { result } = renderHook(() => useCacheState(initializer, 'lazy-key'), {
      wrapper: createWrapper(cache),
    });

    expect(result.current[0]).toBe('lazy-value');
    expect(cache.get('lazy-key')).toBe('lazy-value');
  });

  it('should not overwrite cache on mount if value exists', () => {
    const cache = new Map([['existing-key', 'existing-value']]);
    const { result } = renderHook(() => useCacheState('new-value', 'existing-key'), {
      wrapper: createWrapper(cache),
    });

    expect(result.current[0]).toBe('existing-value');
  });
});
