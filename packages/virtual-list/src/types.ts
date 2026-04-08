import type React from 'react';

export interface VirtualListProps<T> {
  rows: T[];
  presetHeight: number;
  renderRow: (row: T, rowIndex: number) => React.ReactElement;
  eachUukey?: (item: T, index: number) => string;
  forceRenderItem?: ((item: T, index: number) => boolean) | number[];
  saveRenderedIndex?: boolean;
  style?: React.CSSProperties;
  className?: string;
  itemStyle?: React.CSSProperties;
  listContainerStyle?: React.CSSProperties;
  containerRef?: React.ForwardedRef<HTMLDivElement>;
  containerDomRef?: React.RefObject<HTMLDivElement>;
  bufferSize?: number;
  extraOfBottom?: React.ReactElement | React.ReactElement[];
  extraOfBottomKey?: string | string[];
  defaultScrollToBottom?: boolean;
  onMounted?: (wrapElement: HTMLDivElement) => void;
}

export interface VirtualListState {
  offset: number;
  viewHeight: number;
}

export interface VerticalRenderRange {
  topIndex: number;
  topBlank: number;
  bottomIndex: number;
  bottomBlank: number;
}

export interface VLManagerConfig {
  len: number;
  presetHeight: number;
  bufferSize: number;
}

export interface IVisibleRow<T> {
  item: T;
  index: number;
  forceRender?: boolean;
}

export interface VLItemWrapProps {
  children: React.ReactNode;
  uukey: string;
  index: number;
  style?: React.CSSProperties;
  extraOfBottom?: boolean;
  forceRender?: boolean;
}

export interface VirtualRowsProps<T> {
  visibleRows: IVisibleRow<T>[];
  eachUukey: (row: T, index: number) => string | number;
  renderRow: (row: T, rowIndex: number) => React.ReactElement;
  itemStyle?: React.CSSProperties;
  randNum: number;
  vnodeKey: (row: T, rowIndex: number) => string;
}

export interface VirtualListContextValue {
  changeHeight: (index: number, height: number) => void;
  globalStateCache: Map<string, unknown>;
  registerDestroy: (callback: () => void) => void;
}
