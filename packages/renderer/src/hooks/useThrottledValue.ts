import { useEffect, useRef, useState } from "react";

/**
 * 节流 hook：流式期间每 delay ms 更新一次值，
 * enabled 为 false 时立即透传最新值（无延迟）。
 */
export function useThrottledValue<T>(value: T, delay: number, enabled: boolean): T {
  const [throttled, setThrottled] = useState(value);
  const lastUpdate = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!enabled) {
      setThrottled(value);
      return;
    }
    const now = Date.now();
    const elapsed = now - lastUpdate.current;
    if (elapsed >= delay) {
      lastUpdate.current = now;
      setThrottled(value);
    } else {
      clearTimeout(pending.current);
      pending.current = setTimeout(() => {
        lastUpdate.current = Date.now();
        setThrottled(value);
      }, delay - elapsed);
    }
    return () => clearTimeout(pending.current);
  }, [value, delay, enabled]);

  return throttled;
}
