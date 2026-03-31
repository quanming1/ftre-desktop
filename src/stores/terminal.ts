import { create } from 'zustand';

export interface TerminalInstance {
    id: string;
    ptyId: number;
    label: string;
    createdAt: number;
    /** PTY 是否已退出 */
    exited: boolean;
    /** PTY 退出码 */
    exitCode: number | null;
}

/**
 * Terminal Store — thin UI view layer
 *
 * 由全局 terminalManager 驱动，仅用于 React 组件订阅渲染。
 * 所有操作（创建、关闭、重命名、工作区切换）均通过 terminalManager 进行，
 * manager 通过 syncFrom() 将状态推送到此 store。
 */

export interface TerminalState {
    instances: TerminalInstance[];
    activeTerminalId: string | null;
    nextIndex: number;

    /** 由 terminalManager 调用，将全局状态同步到此 store */
    syncFrom: (data: {
        instances: TerminalInstance[];
        activeTerminalId: string | null;
        nextIndex: number;
    }) => void;
}

export function extractDirName(cwd: string): string {
    // Normalize trailing slashes and split on both / and \
    const trimmed = cwd.replace(/[\\/]+$/, '');
    const parts = trimmed.split(/[\\/]/);
    return parts[parts.length - 1] || cwd;
}

export const useTerminal = create<TerminalState>((set) => ({
    instances: [],
    activeTerminalId: null,
    nextIndex: 1,

    syncFrom: (data) => {
        set({
            instances: data.instances,
            activeTerminalId: data.activeTerminalId,
            nextIndex: data.nextIndex,
        });
    },
}));
