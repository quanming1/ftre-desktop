import React, { Component, createRef } from 'react';
import { VirtualListContext } from './context';
import { VLManager } from './vl-manager';
import { VLItemWrap } from './components/VLItemWrap';
import { VirtualRows } from './components/VirtualRows';
import { combineRef, cx, isScrollElement } from './utils';
import type { VirtualListProps, VirtualListState, IVisibleRow } from './types';

export class VirtualList<T> extends Component<VirtualListProps<T>, VirtualListState> {
  readonly containerRef = createRef<HTMLDivElement>();
  readonly wrapRef = createRef<HTMLDivElement>();
  readonly bottomBlankRef = createRef<HTMLDivElement>();

  private readonly globalStateCache = new Map<string, unknown>();
  private readonly destroyCallbacks: (() => void)[] = [];
  private readonly renderedIndex = new Set<number>();

  private firstFlag = false;
  private startCollectRenderedFlag = false;
  private lastWheelTime = 0;
  private scrollListener: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  protected randNum = Math.random();
  private manager: VLManager;

  constructor(props: VirtualListProps<T>) {
    super(props);
    this.manager = new VLManager({
      len: this.totalLength,
      presetHeight: props.presetHeight,
      bufferSize: props.bufferSize ?? 10,
    });
  }

  state: VirtualListState = {
    offset: 0,
    viewHeight: 400,
  };

  get container() {
    return this.containerRef.current;
  }

  get totalLength() {
    return this.props.rows.length + this.extraOfBottomLength;
  }

  get extraOfBottomLength() {
    return this.props.extraOfBottom
      ? Array.isArray(this.props.extraOfBottom)
        ? this.props.extraOfBottom.length
        : 1
      : 0;
  }

  get isAllRender() {
    return this.props.bufferSize === -1 || this.renderedIndex.size >= this.props.rows.length;
  }

  private handleWheel = (e: WheelEvent) => {
    if (e.deltaY < 0) {
      this.lastWheelTime = Date.now();
    } else {
      this.lastWheelTime = 0;
    }
  };

  public scrollToBottom(
    behavior: 'auto' | 'smooth' | 'instant' = 'smooth',
    retryFlag = false
  ): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.bottomBlankRef.current) {
        resolve(false);
        return;
      }

      const doScroll = () => {
        this.bottomBlankRef.current?.scrollIntoView({
          behavior,
          block: 'end',
        });
      };

      if (retryFlag) {
        for (let i = 0; i <= 5; i++) {
          setTimeout(() => {
            if (!this.utils.isAtBottom()) {
              doScroll();
            } else {
              this.handleCalcState();
              resolve(true);
            }
          }, i * 50);
        }
      } else {
        doScroll();
        resolve(true);
      }
    });
  }

  public scrollToIndex(index: number, behavior: 'auto' | 'smooth' | 'instant' = 'smooth') {
    const wrapEl = this.wrapRef.current;
    if (!wrapEl) return;

    let offset = 0;
    for (let i = 0; i < index && i < this.manager.cache.length; i++) {
      offset += this.manager.cache[i];
    }

    wrapEl.scrollTo({ top: offset, behavior });
  }

  componentDidMount() {
    const scrollParent = this.wrapRef.current!;

    const handleChange = () => {
      if (this.isAllRender && this.firstFlag) return;
      this.firstFlag = true;
      const top =
        scrollParent.getBoundingClientRect().top - this.container!.getBoundingClientRect().top;
      if (Math.abs(this.state.offset - top) >= this.props.presetHeight) {
        this.handleCalcState();
      }
    };

    scrollParent.addEventListener('scroll', handleChange);
    this.scrollListener = () => scrollParent.removeEventListener('scroll', handleChange);

    this.resizeObserver = new ResizeObserver(handleChange);
    this.resizeObserver.observe(scrollParent);

    scrollParent.addEventListener('wheel', this.handleWheel);

    this.props.onMounted?.(scrollParent);

    if (this.props.defaultScrollToBottom) {
      this.scrollToBottom('instant', true);
    }
  }

  protected handleCalcState = () => {
    const scrollParent = this.wrapRef.current!;
    const newViewHeight = scrollParent.clientHeight;
    const newOffset =
      scrollParent.getBoundingClientRect().top - this.container!.getBoundingClientRect().top;
    if (newViewHeight !== this.state.viewHeight || newOffset !== this.state.offset) {
      this.setState({
        viewHeight: newViewHeight,
        offset: newOffset,
      });
    }
  };

  componentWillUnmount() {
    this.scrollListener?.();
    this.resizeObserver?.disconnect();
    this.globalStateCache.clear();
    this.destroyCallbacks.forEach((callback) => callback?.());
    this.wrapRef.current?.removeEventListener('wheel', this.handleWheel);
  }

  private getForceRenderIdx(): number[] {
    const { rows, forceRenderItem } = this.props;
    const forceRenderIdxSet = new Set<number>(
      this.props.saveRenderedIndex ? this.renderedIndex : undefined
    );

    if (typeof forceRenderItem === 'function') {
      rows.forEach((row, index) => {
        if (forceRenderItem(row, index)) {
          forceRenderIdxSet.add(index);
        }
      });
    } else if (Array.isArray(forceRenderItem)) {
      forceRenderItem.forEach((idx) => forceRenderIdxSet.add(idx));
    }

    for (let i = 0; i < this.extraOfBottomLength; i++) {
      forceRenderIdxSet.add(i + this.props.rows.length);
    }

    return Array.from(forceRenderIdxSet);
  }

  protected getVisibleRows() {
    if (this.isAllRender) {
      const allItems = [
        ...this.props.rows,
        ...(Array.isArray(this.props.extraOfBottom) ? this.props.extraOfBottom : []),
      ];
      return {
        visibleRows: allItems.map((row, index) => ({
          item: row as T,
          index,
          forceRender: false,
        })),
        range: {
          topIndex: 0,
          bottomIndex: this.props.rows.length,
          topBlank: 0,
          bottomBlank: 0,
        },
      };
    }

    const { rows } = this.props;
    const { offset, viewHeight } = this.state;
    const forceRenderIdx = this.getForceRenderIdx();

    const range = this.manager.getRenderRange({
      offsetOfTop: offset,
      maxRenderHeight: viewHeight,
      len: this.totalLength,
    });

    const visibleRowsWrapList: IVisibleRow<T>[] = rows
      .slice(range.topIndex, range.bottomIndex)
      .map((row, i) => ({
        item: row,
        index: range.topIndex + i,
        forceRender: forceRenderIdx.includes(range.topIndex + i),
      }));

    forceRenderIdx.forEach((index) => {
      if (!visibleRowsWrapList.find((item) => item.index === index) && rows[index]) {
        const item = rows[index];
        visibleRowsWrapList.push({
          item,
          index,
          forceRender: true,
        });
        if (index < range.topIndex || index >= range.bottomIndex) {
          range.bottomBlank -= this.manager.cache[index] || 0;
        }
        range.bottomBlank = Math.max(range.bottomBlank, 0);
      }
    });

    visibleRowsWrapList.sort((a, b) => a.index - b.index);

    return { visibleRows: visibleRowsWrapList, range };
  }

  changeHeight = (index: number, height: number) => {
    if (this.manager) {
      const isSame = this.manager.setCache(index, height);
      if (!isSame) {
        this.handleCalcState();
      }
    }
  };

  forceResetUUKey = () => {
    this.randNum = Math.random();
    this.forceUpdate();
  };

  registerDestroy = (callback: () => void) => {
    if (!this.destroyCallbacks.includes(callback)) {
      this.destroyCallbacks.push(callback);
    }
  };

  public utils = {
    isAtBottom: (distance: number = 10): boolean => {
      if (!this.wrapRef.current) return false;
      if (!isScrollElement(this.wrapRef.current)) return true;
      return (
        this.wrapRef.current.scrollHeight -
          this.wrapRef.current.scrollTop -
          this.wrapRef.current.offsetHeight <
        distance
      );
    },

    scrollToBottomIfNotAtBottom: (
      distance: number = 100,
      behavior: 'auto' | 'smooth' | 'instant' = 'instant'
    ) => {
      if (this.utils.isAtBottom(distance) && Date.now() - this.lastWheelTime > 500) {
        this.scrollToBottom(behavior);
      }
    },

    getScrollTop: (): number => {
      return this.wrapRef.current?.scrollTop ?? 0;
    },

    setScrollTop: (top: number) => {
      if (this.wrapRef.current) {
        this.wrapRef.current.scrollTop = top;
      }
    },
  };

  render() {
    const {
      renderRow,
      style,
      className,
      extraOfBottom: extraOfBottom_,
      extraOfBottomKey: extraOfBottomKey_,
    } = this.props;
    const { visibleRows, range } = this.getVisibleRows();

    if (this.props.defaultScrollToBottom && range.bottomIndex === this.props.rows.length) {
      this.startCollectRenderedFlag = true;
    } else if (!this.props.defaultScrollToBottom) {
      this.startCollectRenderedFlag = true;
    }

    if (this.props.saveRenderedIndex && !this.isAllRender && this.startCollectRenderedFlag) {
      visibleRows.forEach((item) => {
        this.renderedIndex.add(item.index);
      });
    }

    const eachUukey = this.props.eachUukey || ((_, index) => String(index));
    const extraOfBottom = Array.isArray(extraOfBottom_) ? extraOfBottom_ : [extraOfBottom_];
    const extraOfBottomKey = Array.isArray(extraOfBottomKey_)
      ? extraOfBottomKey_
      : [extraOfBottomKey_];

    return (
      <VirtualListContext.Provider
        value={{
          changeHeight: this.changeHeight,
          globalStateCache: this.globalStateCache,
          registerDestroy: this.registerDestroy,
        }}
      >
        <div
          ref={combineRef(this.wrapRef, this.props.containerDomRef)}
          style={{ overflow: 'auto', overflowX: 'hidden', ...style }}
          data-vl-wrap
          className="vl-wrap"
        >
          <div
            ref={this.containerRef}
            style={{ position: 'relative', ...(this.props.listContainerStyle || {}) }}
            className={cx(className)}
          >
            <div data-top-blank style={{ height: range.topBlank }} />
            <VirtualRows
              visibleRows={visibleRows}
              eachUukey={eachUukey}
              renderRow={renderRow}
              itemStyle={this.props.itemStyle}
              randNum={this.randNum}
              vnodeKey={(_, index) => `vl-item::${index}`}
            />

            {extraOfBottom.map((extraOfBottomItem, i) => {
              const index = i + this.props.rows.length;
              const key = `extra-of-bottom::${extraOfBottomKey[i]}-${index}`;
              return (
                <VLItemWrap
                  key={`extra-of-bottom::${index}`}
                  extraOfBottom
                  index={index}
                  uukey={key}
                >
                  {extraOfBottomItem}
                </VLItemWrap>
              );
            })}

            <div data-bottom-blank ref={this.bottomBlankRef} style={{ height: range.bottomBlank }} />
          </div>
        </div>
      </VirtualListContext.Provider>
    );
  }
}
