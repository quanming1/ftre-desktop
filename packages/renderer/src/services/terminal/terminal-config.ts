/**
 * 终端常量、配置和类型定义
 */

import type { ITerminalOptions } from '@xterm/xterm';
import { getTerminalTheme } from './terminal-theme';

// ═══════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════

export interface TerminalInstanceInfo {
    id: string;
    ptyId: number;
    label: string;
    createdAt: number;
    /** PTY 是否已退出 */
    exited: boolean;
    /** PTY 退出码（null 表示还在运行） */
    exitCode: number | null;
}

/** 终端实例 —— 包含 xterm.js 对象和所有关联资源 */
export interface ManagedTerminal {
    /** 逻辑信息（同步到 store 的数据） */
    info: TerminalInstanceInfo;
    /** xterm.js Terminal 实例 */
    term: import('@xterm/xterm').Terminal;
    /** FitAddon 实例 */
    fit: import('@xterm/addon-fit').FitAddon;
    /** SearchAddon 实例 */
    search: import('@xterm/addon-search').SearchAddon;
    /** xterm onData 清理（用户输入 → PTY） */
    cleanupOnData: () => void;
    /** PTY data IPC 清理函数 */
    cleanupData: () => void;
    /** PTY exit IPC 清理函数 */
    cleanupExit: () => void;
    /** 退出后按任意键重启的监听清理 */
    cleanupRestartListener: (() => void) | null;
    /** ResizeObserver（挂载时才有） */
    observer: ResizeObserver | null;
    /** 当前 DOM 容器引用 */
    container: HTMLDivElement | null;
    /** 是否需要在容器可见时做 refit */
    needsRefit: boolean;
    /** 所属工作区 */
    workspace: string;
}

/** 工作区终端分组 */
export interface WorkspaceTerminals {
    terminals: Map<string, ManagedTerminal>;
    activeTerminalId: string | null;
    nextIndex: number;
}

// ═══════════════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════════════

export const DEFAULT_FONT_SIZE = 13;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 28;

export const TERM_OPTIONS: ITerminalOptions = {
    fontSize: DEFAULT_FONT_SIZE,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
};

/**
 * 获取包含动态主题的完整终端选项。
 * 必须在 DOM 就绪后调用（getTerminalTheme 依赖 getComputedStyle）。
 */
export function getTerminalOptionsWithTheme(resolved: 'light' | 'dark'): ITerminalOptions {
    return {
        ...TERM_OPTIONS,
        theme: getTerminalTheme(resolved),
    };
}

// ═══════════════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════════════

let idCounter = 0;

export function generateId(): string {
    idCounter += 1;
    return `term-${idCounter}-${Date.now()}`;
}

export function extractDirName(cwd: string): string {
    const trimmed = cwd.replace(/[\\/]+$/, '');
    const parts = trimmed.split(/[\\/]/);
    return parts[parts.length - 1] || cwd;
}

export function isContainerVisible(el: HTMLElement): boolean {
    return el.offsetWidth > 0 && el.offsetHeight > 0;
}
