import '@testing-library/jest-dom';

// jsdom 不实现 IntersectionObserver — 给测试环境一个最小 stub
if (typeof globalThis.IntersectionObserver === 'undefined') {
    class IO {
        observe() { }
        unobserve() { }
        disconnect() { }
        takeRecords() {
            return [] as IntersectionObserverEntry[];
        }
        root = null;
        rootMargin = '';
        thresholds = [] as ReadonlyArray<number>;
    }
    // @ts-expect-error 测试 stub
    globalThis.IntersectionObserver = IO;
}
