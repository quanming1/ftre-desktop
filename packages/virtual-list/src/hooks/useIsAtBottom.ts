import { useLayoutEffect, useRef, useState } from 'react';
import { throttle } from '../utils';

export function useIsAtBottom(
  wrapRef: React.RefObject<HTMLDivElement | null>,
  distance: number = 10
): boolean {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const cleanupRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const checkIsAtBottom = () => {
      const { scrollHeight, scrollTop, offsetHeight } = wrap;
      return scrollHeight - scrollTop - offsetHeight < distance;
    };

    setIsAtBottom(checkIsAtBottom());

    const handleChange = throttle(() => {
      setIsAtBottom(checkIsAtBottom());
    }, 200);

    const observer = new ResizeObserver(handleChange);
    observer.observe(wrap);
    wrap.addEventListener('scroll', handleChange);

    cleanupRef.current = () => {
      wrap.removeEventListener('scroll', handleChange);
      observer.disconnect();
      handleChange.cancel();
    };

    return () => {
      cleanupRef.current?.();
    };
  }, [wrapRef, distance]);

  return isAtBottom;
}
