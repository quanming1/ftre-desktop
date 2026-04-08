import React, { memo } from 'react';
import { VLItemWrap } from './VLItemWrap';
import type { VirtualRowsProps } from '../types';
import { isEqual } from '../utils';

export const VirtualRows = memo(
  function VirtualRows<T>({
    visibleRows,
    eachUukey,
    renderRow,
    itemStyle,
    randNum,
    vnodeKey,
  }: VirtualRowsProps<T>) {
    return (
      <>
        {visibleRows.map(({ item, index, forceRender }) => {
          const k = eachUukey(item, index) + '' + randNum;
          return (
            <VLItemWrap
              forceRender={forceRender}
              index={index}
              style={itemStyle || {}}
              key={vnodeKey(item, index)}
              uukey={k}
            >
              {renderRow(item, index)}
            </VLItemWrap>
          );
        })}
      </>
    );
  },
  (prev, curr) => {
    return (
      isEqual(prev.visibleRows, curr.visibleRows) &&
      prev.eachUukey === curr.eachUukey &&
      prev.renderRow === curr.renderRow &&
      isEqual(prev.itemStyle, curr.itemStyle) &&
      prev.randNum === curr.randNum
    );
  }
) as <T>(props: VirtualRowsProps<T>) => React.ReactElement;
