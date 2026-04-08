import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { combineRef, isScrollElement, throttle, isEqual, cx } from './utils';

describe('combineRef', () => {
  it('should call function refs with target', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const combined = combineRef(fn1, fn2);

    const target = document.createElement('div');
    combined(target);

    expect(fn1).toHaveBeenCalledWith(target);
    expect(fn2).toHaveBeenCalledWith(target);
  });

  it('should set object refs', () => {
    const ref1 = { current: null };
    const ref2 = { current: null };
    const combined = combineRef(ref1, ref2);

    const target = document.createElement('div');
    combined(target);

    expect(ref1.current).toBe(target);
    expect(ref2.current).toBe(target);
  });

  it('should handle null refs', () => {
    const fn = vi.fn();
    const combined = combineRef(null, fn, undefined);

    const target = document.createElement('div');
    combined(target);

    expect(fn).toHaveBeenCalledWith(target);
  });

  it('should handle null target', () => {
    const ref = { current: document.createElement('div') };
    const fn = vi.fn();
    const combined = combineRef(ref, fn);

    combined(null);

    expect(ref.current).toBe(null);
    expect(fn).toHaveBeenCalledWith(null);
  });
});

describe('isScrollElement', () => {
  it('should return true for scrollable element', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 500 });
    Object.defineProperty(el, 'clientHeight', { value: 300 });

    expect(isScrollElement(el)).toBe(true);
  });

  it('should return false for non-scrollable element', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 300 });
    Object.defineProperty(el, 'clientHeight', { value: 300 });

    expect(isScrollElement(el)).toBe(false);
  });
});

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call function immediately on first call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should throttle subsequent calls', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    throttled();
    throttled();

    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should call with latest arguments after wait', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a');
    throttled('b');
    throttled('c');

    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenLastCalledWith('c');
  });

  it('should allow cancel', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    throttled();
    throttled.cancel();

    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('isEqual', () => {
  it('should return true for same primitives', () => {
    expect(isEqual(1, 1)).toBe(true);
    expect(isEqual('a', 'a')).toBe(true);
    expect(isEqual(true, true)).toBe(true);
    expect(isEqual(null, null)).toBe(true);
    expect(isEqual(undefined, undefined)).toBe(true);
  });

  it('should return false for different primitives', () => {
    expect(isEqual(1, 2)).toBe(false);
    expect(isEqual('a', 'b')).toBe(false);
    expect(isEqual(true, false)).toBe(false);
    expect(isEqual(null, undefined)).toBe(false);
  });

  it('should compare arrays', () => {
    expect(isEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(isEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(isEqual([1, 2, 3], [1, 3, 2])).toBe(false);
  });

  it('should compare nested arrays', () => {
    expect(isEqual([[1], [2]], [[1], [2]])).toBe(true);
    expect(isEqual([[1], [2]], [[1], [3]])).toBe(false);
  });

  it('should compare objects', () => {
    expect(isEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(isEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(isEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('should compare nested objects', () => {
    expect(isEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(isEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it('should handle mixed types', () => {
    expect(isEqual([1], { 0: 1 })).toBe(false);
    expect(isEqual({ a: 1 }, null)).toBe(false);
  });
});

describe('cx', () => {
  it('should join class names', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c');
  });

  it('should filter falsy values', () => {
    expect(cx('a', false, 'b', null, 'c', undefined, '')).toBe('a b c');
  });

  it('should handle empty input', () => {
    expect(cx()).toBe('');
  });
});
