/**
 * xterm 主题工厂 — 根据 resolved mode 生成 ITheme 对象
 *
 * 背景/前景/光标/选区从 CSS Token 读取；
 * ANSI 16 色按 resolved mode 返回预设映射表。
 */

import type { ITheme } from '@xterm/xterm';

// ═══════════════════════════════════════════════════════════════════════
// ANSI 16 色预设
// ═══════════════════════════════════════════════════════════════════════

/** Dark 模式 ANSI 色 — 与原 TERM_THEME 硬编码值字节级相等 */
const ANSI_DARK: Pick<
    ITheme,
    | 'black' | 'brightBlack'
    | 'white' | 'brightWhite'
    | 'blue' | 'brightBlue'
    | 'green' | 'brightGreen'
    | 'red' | 'brightRed'
    | 'yellow' | 'brightYellow'
    | 'cyan' | 'brightCyan'
    | 'magenta' | 'brightMagenta'
> = {
    black: '#1e1e1e',
    brightBlack: '#6e7681',
    white: '#ddd',
    brightWhite: '#ffffff',
    blue: '#00bbff',
    brightBlue: '#60a5fa',
    green: '#00ff88',
    brightGreen: '#4ade80',
    red: '#ff4444',
    brightRed: '#ff6666',
    yellow: '#ffaa00',
    brightYellow: '#ffd700',
    cyan: '#00bbff',
    brightCyan: '#93c5fd',
    magenta: '#c084fc',
    brightMagenta: '#d8b4fe',
};

/** Light 模式 ANSI 色 — 适配浅色背景的可读性 */
const ANSI_LIGHT: typeof ANSI_DARK = {
    black: '#1a1a1a',
    brightBlack: '#6e7681',
    // ⚠️ 在浅色终端中，ANSI "white" 语义是"最亮的前景色"，
    // 但物理上必须是深色才能在浅色背景上可读。
    // 不能用 #f8f9fa / #ffffff — 那样就是白字白背景。
    white: '#6e7681',
    brightWhite: '#1f2328',
    blue: '#0969da',
    brightBlue: '#218bff',
    green: '#116329',
    brightGreen: '#1a7f37',
    red: '#cf222e',
    brightRed: '#a40e26',
    yellow: '#9a6700',
    brightYellow: '#7c4d00',
    cyan: '#0550ae',
    brightCyan: '#0969da',
    magenta: '#8250df',
    brightMagenta: '#6639ba',
};

// ═══════════════════════════════════════════════════════════════════════
// 工厂函数
// ═══════════════════════════════════════════════════════════════════════

function getAnsiColors(resolved: 'light' | 'dark'): typeof ANSI_DARK {
    return resolved === 'dark' ? ANSI_DARK : ANSI_LIGHT;
}

/**
 * 根据 resolved mode 生成 xterm ITheme 对象。
 * 背景/前景/光标/选区从 CSS Token 读取（确保与全局 Token 一致），
 * ANSI 16 色使用预设映射表。
 */
export function getTerminalTheme(resolved: 'light' | 'dark'): ITheme {
    const style = getComputedStyle(document.documentElement);
    const v = (name: string) => style.getPropertyValue(name).trim();

    return {
        background: v('--ftre-bg-base'),
        foreground: v('--ftre-text-primary'),
        cursor: v('--ftre-accent-default'),
        selectionBackground: v('--ftre-selection-bg'),
        ...getAnsiColors(resolved),
    };
}
