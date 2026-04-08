import React, { memo, useContext, useEffect, useRef } from 'react';
import { VirtualListContext } from '../context';
import type { VLItemWrapProps } from '../types';

export const VLItemWrap = memo(
  function VLItemWrap({
    children,
    style = {},
    index,
    extraOfBottom = false,
    forceRender = false,
  }: VLItemWrapProps) {
    const ref = useRef<HTMLDivElement>(null);
    const { changeHeight } = useContext(VirtualListContext);

    useEffect(() => {
      if (ref.current) {
        const observer = new ResizeObserver(() => {
          if (ref.current) {
            changeHeight(index, ref.current.offsetHeight);
          }
        });
        observer.observe(ref.current);
        return () => {
          observer.disconnect();
        };
      }
    }, [index, changeHeight]);

    return (
      <div
        {...(extraOfBottom ? { 'data-extra-of-bottom': true } : {})}
        {...(forceRender ? { 'data-force-render': true } : {})}
        ref={ref}
        style={style}
        data-vl-item-wrap
        data-virtual-list-row-index={index}
      >
        {children}
      </div>
    );
  },
  (prev, curr) => prev.uukey === curr.uukey
);
