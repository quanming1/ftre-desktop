import { createContext, useContext, useEffect } from 'react';
import type { VirtualListContextValue } from './types';

export const VirtualListContext = createContext<VirtualListContextValue>({
  changeHeight: () => {},
  globalStateCache: new Map(),
  registerDestroy: () => {},
});

export const useVirtualListContext = () => useContext(VirtualListContext);

export const useVirtualListDestroy = (callback: () => void) => {
  const context = useContext(VirtualListContext);
  useEffect(() => {
    context.registerDestroy(callback);
  }, []);
};
