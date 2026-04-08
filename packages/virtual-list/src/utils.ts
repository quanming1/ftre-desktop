import type React from 'react';

export function combineRef<T>(
  ...refList: (React.MutableRefObject<T | null> | React.RefCallback<T> | null | undefined)[]
) {
  return (target: T | null) => {
    refList.forEach((ref) => {
      if (typeof ref === 'function') {
        ref(target);
      } else if (ref) {
        ref.current = target;
      }
    });
  };
}

export function isScrollElement(element: HTMLElement): boolean {
  const { scrollHeight, clientHeight } = element;
  return scrollHeight > clientHeight;
}

export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  wait: number
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastCallTime = 0;

  const throttled = function (this: unknown, ...args: Parameters<T>) {
    const now = Date.now();
    const remaining = wait - (now - lastCallTime);

    if (remaining <= 0 || remaining > wait) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCallTime = now;
      lastArgs = null;
      fn.apply(this, args);
    } else {
      lastArgs = args;
      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          lastCallTime = Date.now();
          timeoutId = null;
          if (lastArgs) {
            fn.apply(this, lastArgs);
            lastArgs = null;
          }
        }, remaining);
      }
    }
  } as T & { cancel: () => void };

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
  };

  return throttled;
}

export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => isEqual(item, b[index]));
  }

  if (Array.isArray(a) || Array.isArray(b)) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => isEqual(aObj[key], bObj[key]));
}

export function cx(...classNames: (string | undefined | null | false)[]): string {
  return classNames.filter(Boolean).join(' ');
}
