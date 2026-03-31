/**
 * 终端按键处理
 *
 * - Ctrl+C: 有选中文本时复制，否则发送中断信号
 * - Ctrl+V: 粘贴剪贴板内容
 * - Ctrl+Shift+C / Ctrl+Shift+V: 备用复制/粘贴快捷键
 * - Ctrl+= / Ctrl+-: 字体缩放
 * - Ctrl+0: 重置字体大小
 */

import type { Terminal } from '@xterm/xterm';
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE } from './terminal-config';

/**
 * 为 Terminal 注册自定义按键处理器
 * @param term xterm.js Terminal 实例
 * @param onFontSizeChange 字体大小变更回调（用于同步所有终端）
 */
export function attachKeybindings(
    term: Terminal,
    onFontSizeChange?: (delta: number) => void,
    onResetFontSize?: () => void,
): void {
    term.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return true;

        // ── Ctrl+C / Ctrl+Shift+C: 复制 ─────────────────────────
        if (event.ctrlKey && event.key === 'c' && term.hasSelection()) {
            navigator.clipboard.writeText(term.getSelection());
            term.clearSelection();
            return false;
        }
        if (event.ctrlKey && event.shiftKey && event.key === 'C') {
            if (term.hasSelection()) {
                navigator.clipboard.writeText(term.getSelection());
                term.clearSelection();
            }
            return false;
        }

        // ── Ctrl+V / Ctrl+Shift+V: 粘贴 ─────────────────────────
        if (event.ctrlKey && (event.key === 'v' || (event.shiftKey && event.key === 'V'))) {
            event.preventDefault();
            navigator.clipboard.readText().then((text) => {
                if (text) term.paste(text);
            });
            return false;
        }

        // ── Ctrl+= / Ctrl+-: 字体缩放 ──────────────────────────
        if (event.ctrlKey && !event.shiftKey && event.key === '=') {
            onFontSizeChange?.(1);
            return false;
        }
        if (event.ctrlKey && !event.shiftKey && event.key === '-') {
            onFontSizeChange?.(-1);
            return false;
        }
        // ── Ctrl+0: 重置字体 ────────────────────────────────────
        if (event.ctrlKey && !event.shiftKey && event.key === '0') {
            onResetFontSize?.();
            return false;
        }

        return true;
    });
}

/**
 * 计算新的字体大小，受 min/max 约束
 */
export function clampFontSize(current: number, delta: number): number {
    return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, current + delta));
}

/**
 * 获取默认字体大小
 */
export function getDefaultFontSize(): number {
    return DEFAULT_FONT_SIZE;
}
