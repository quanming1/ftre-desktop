import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import { VirtualList } from './VirtualList';

interface TestItem {
  id: string;
  content: string;
}

const createItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    content: `Content ${i}`,
  }));

describe('VirtualList', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      left: 0,
      right: 100,
      bottom: 500,
      width: 100,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 500,
    });

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      value: 5000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('should render visible items', () => {
      const items = createItems(100);

      render(
        <VirtualList
          rows={items}
          presetHeight={50}
          renderRow={(item) => <div data-testid={item.id}>{item.content}</div>}
          eachUukey={(item) => item.id}
        />
      );

      expect(screen.getByTestId('item-0')).toBeInTheDocument();
    });

    it('should apply className to container', () => {
      const items = createItems(10);

      const { container } = render(
        <VirtualList
          rows={items}
          presetHeight={50}
          className="custom-class"
          renderRow={(item) => <div>{item.content}</div>}
        />
      );

      expect(container.querySelector('.custom-class')).toBeInTheDocument();
    });

    it('should apply style to wrapper', () => {
      const items = createItems(10);

      const { container } = render(
        <VirtualList
          rows={items}
          presetHeight={50}
          style={{ maxHeight: '300px' }}
          renderRow={(item) => <div>{item.content}</div>}
        />
      );

      const wrapper = container.querySelector('[data-vl-wrap]') as HTMLElement;
      expect(wrapper).toBeInTheDocument();
      expect(wrapper.style.maxHeight).toBe('300px');
    });

    it('should render extraOfBottom elements', () => {
      const items = createItems(10);

      render(
        <VirtualList
          rows={items}
          presetHeight={50}
          renderRow={(item) => <div>{item.content}</div>}
          extraOfBottom={<div data-testid="extra">Extra Content</div>}
          extraOfBottomKey="extra-key"
        />
      );

      expect(screen.getByTestId('extra')).toBeInTheDocument();
    });

    it('should render multiple extraOfBottom elements', () => {
      const items = createItems(10);

      render(
        <VirtualList
          rows={items}
          presetHeight={50}
          renderRow={(item) => <div>{item.content}</div>}
          extraOfBottom={[
            <div key="1" data-testid="extra-1">
              Extra 1
            </div>,
            <div key="2" data-testid="extra-2">
              Extra 2
            </div>,
          ]}
          extraOfBottomKey={['key-1', 'key-2']}
        />
      );

      expect(screen.getByTestId('extra-1')).toBeInTheDocument();
      expect(screen.getByTestId('extra-2')).toBeInTheDocument();
    });
  });

  describe('bufferSize', () => {
    it('should render all items when bufferSize is -1', () => {
      const items = createItems(20);

      render(
        <VirtualList
          rows={items}
          presetHeight={50}
          bufferSize={-1}
          renderRow={(item) => <div data-testid={item.id}>{item.content}</div>}
          eachUukey={(item) => item.id}
        />
      );

      expect(screen.getByTestId('item-0')).toBeInTheDocument();
      expect(screen.getByTestId('item-19')).toBeInTheDocument();
    });
  });

  describe('forceRenderItem', () => {
    it('should force render items by index array', () => {
      const items = createItems(100);

      render(
        <VirtualList
          rows={items}
          presetHeight={50}
          forceRenderItem={[99]}
          renderRow={(item) => <div data-testid={item.id}>{item.content}</div>}
          eachUukey={(item) => item.id}
        />
      );

      expect(screen.getByTestId('item-99')).toBeInTheDocument();
    });

    it('should force render items by predicate', () => {
      const items = createItems(100);

      render(
        <VirtualList
          rows={items}
          presetHeight={50}
          forceRenderItem={(_, index) => index === 99}
          renderRow={(item) => <div data-testid={item.id}>{item.content}</div>}
          eachUukey={(item) => item.id}
        />
      );

      expect(screen.getByTestId('item-99')).toBeInTheDocument();
    });
  });

  describe('ref methods', () => {
    it('should expose utils.isAtBottom', () => {
      const items = createItems(100);
      const ref = createRef<VirtualList<TestItem>>();

      render(
        <VirtualList
          ref={ref}
          rows={items}
          presetHeight={50}
          renderRow={(item) => <div>{item.content}</div>}
        />
      );

      expect(ref.current?.utils.isAtBottom).toBeDefined();
      expect(typeof ref.current?.utils.isAtBottom()).toBe('boolean');
    });

    it('should expose scrollToBottom method', () => {
      const items = createItems(100);
      const ref = createRef<VirtualList<TestItem>>();

      render(
        <VirtualList
          ref={ref}
          rows={items}
          presetHeight={50}
          renderRow={(item) => <div>{item.content}</div>}
        />
      );

      expect(ref.current?.scrollToBottom).toBeDefined();
    });

    it('should expose scrollToIndex method', () => {
      const items = createItems(100);
      const ref = createRef<VirtualList<TestItem>>();

      render(
        <VirtualList
          ref={ref}
          rows={items}
          presetHeight={50}
          renderRow={(item) => <div>{item.content}</div>}
        />
      );

      expect(ref.current?.scrollToIndex).toBeDefined();
    });

    it('should expose forceResetUUKey method', () => {
      const items = createItems(100);
      const ref = createRef<VirtualList<TestItem>>();

      render(
        <VirtualList
          ref={ref}
          rows={items}
          presetHeight={50}
          renderRow={(item) => <div>{item.content}</div>}
        />
      );

      expect(ref.current?.forceResetUUKey).toBeDefined();
    });
  });

  describe('onMounted callback', () => {
    it('should call onMounted with wrap element', () => {
      const items = createItems(10);
      const onMounted = vi.fn();

      render(
        <VirtualList
          rows={items}
          presetHeight={50}
          onMounted={onMounted}
          renderRow={(item) => <div>{item.content}</div>}
        />
      );

      expect(onMounted).toHaveBeenCalledTimes(1);
      expect(onMounted.mock.calls[0][0]).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe('empty list', () => {
    it('should render empty list without errors', () => {
      const { container } = render(
        <VirtualList<TestItem>
          rows={[]}
          presetHeight={50}
          renderRow={(item) => <div>{item.content}</div>}
        />
      );

      expect(container.querySelector('[data-vl-wrap]')).toBeInTheDocument();
    });
  });
});
