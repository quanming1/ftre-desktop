import { useCallback, useContext, useState } from 'react';
import { VirtualListContext } from '../context';

export function useCacheState<T>(
  initialValue: T | (() => T),
  cacheKey: string
): [T, (value: T | ((prev: T) => T)) => void] {
  const { globalStateCache } = useContext(VirtualListContext);

  const [state, setState] = useState<T>(() => {
    if (globalStateCache.has(cacheKey)) {
      return globalStateCache.get(cacheKey) as T;
    }
    const value = typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue;
    globalStateCache.set(cacheKey, value);
    return value;
  });

  const setCacheState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const nextValue = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
        globalStateCache.set(cacheKey, nextValue);
        return nextValue;
      });
    },
    [cacheKey, globalStateCache]
  );

  return [state, setCacheState];
}
