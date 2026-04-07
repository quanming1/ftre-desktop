import { useEffect, useRef, useState } from "react";

/**
 * Throttle a value update.
 * When enabled, updates are throttled to at most once per `delay` ms.
 * When disabled, the latest value is passed through immediately.
 */
export function useThrottledValue<T>(
  value: T,
  delay: number,
  enabled: boolean,
): T {
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
