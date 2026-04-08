import type { VerticalRenderRange, VLManagerConfig } from './types';

export class VLManager {
  protected len: number;
  protected presetHeight: number;
  protected bufferSize: number;
  cache: number[] = [];

  constructor(config: VLManagerConfig) {
    this.len = config.len;
    this.presetHeight = config.presetHeight;
    this.bufferSize = config.bufferSize;
    this.cache = new Array(this.len).fill(config.presetHeight);
  }

  get MAX_OVERSCAN_SIZE() {
    return this.bufferSize * this.presetHeight;
  }

  getRenderRange = (config: {
    offsetOfTop: number;
    maxRenderHeight: number;
    len: number;
  }): VerticalRenderRange => {
    this.len = config.len;
    
    // 同步缓存长度
    if (this.cache.length !== this.len) {
      const newCache = new Array(this.len).fill(this.presetHeight);
      for (let i = 0; i < Math.min(this.cache.length, this.len); i++) {
        newCache[i] = this.cache[i];
      }
      this.cache = newCache;
    }

    if (this.len === 0) {
      return { topIndex: 0, topBlank: 0, bottomIndex: 0, bottomBlank: 0 };
    }

    const { offsetOfTop, maxRenderHeight } = config;

    // 1. 找到第一个与可视区域相交的项
    let firstVisibleIndex = 0;
    let heightBeforeFirst = 0;
    while (firstVisibleIndex < this.len) {
      const itemHeight = this.cache[firstVisibleIndex];
      if (heightBeforeFirst + itemHeight > offsetOfTop) {
        break;
      }
      heightBeforeFirst += itemHeight;
      firstVisibleIndex++;
    }

    // 2. 找到最后一个与可视区域相交的项
    let lastVisibleIndex = firstVisibleIndex;
    let heightSoFar = heightBeforeFirst;
    const endOffset = offsetOfTop + maxRenderHeight;
    while (lastVisibleIndex < this.len && heightSoFar < endOffset) {
      heightSoFar += this.cache[lastVisibleIndex];
      lastVisibleIndex++;
    }

    // 3. 向上扩展 overscan（基于像素）
    let topIndex = firstVisibleIndex;
    let overscanUp = 0;
    while (topIndex > 0 && overscanUp < this.MAX_OVERSCAN_SIZE) {
      topIndex--;
      overscanUp += this.cache[topIndex];
    }

    // 4. 向下扩展 overscan（基于像素）
    let bottomIndex = lastVisibleIndex;
    let overscanDown = 0;
    while (bottomIndex < this.len && overscanDown < this.MAX_OVERSCAN_SIZE) {
      overscanDown += this.cache[bottomIndex];
      bottomIndex++;
    }

    // 5. 计算 topBlank：topIndex 之前所有项的高度
    let topBlank = 0;
    for (let i = 0; i < topIndex; i++) {
      topBlank += this.cache[i];
    }

    // 6. 计算 bottomBlank：bottomIndex 之后所有项的高度
    let bottomBlank = 0;
    for (let i = bottomIndex; i < this.len; i++) {
      bottomBlank += this.cache[i];
    }

    return { topIndex, topBlank, bottomIndex, bottomBlank };
  };

  setCache = (index: number, height: number): boolean => {
    const isSame = this.cache[index] === height;
    this.cache[index] = height;
    return isSame;
  };

  getCache = (index: number): number => {
    return this.cache[index] ?? this.presetHeight;
  };

  getTotalHeight = (): number => {
    return this.cache.reduce((a, b) => a + b, 0);
  };
}
