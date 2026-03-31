import { useRef } from 'react';

/**
 * 开发模式下的渲染计数 Hook
 * 用于追踪组件重渲染次数，验证优化效果
 */
export function useRenderCount(componentName: string): number {
    const count = useRef(0);
    count.current += 1;

    if (process.env.NODE_ENV === 'development') {
        console.debug(`[RenderCount] ${componentName}: ${count.current}`);
    }

    return count.current;
}
