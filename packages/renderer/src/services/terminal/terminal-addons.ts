/**
 * Addon 加载 — 为 xterm.js Terminal 实例加载所有扩展
 *
 * - FitAddon: 自适应容器大小
 * - WebLinksAddon: URL 可点击，用默认浏览器打开
 * - SearchAddon: 终端内搜索
 * - Unicode11Addon: 中文/emoji 宽字符正确渲染
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';

export interface LoadedAddons {
    fit: FitAddon;
    search: SearchAddon;
}

/**
 * 为 Terminal 实例加载全部 addon 并返回需要引用的实例
 */
export function loadAddons(term: Terminal): LoadedAddons {
    const fit = new FitAddon();
    const search = new SearchAddon();
    const webLinks = new WebLinksAddon((_event, uri) => {
        window.desktop.openExternal(uri);
    });
    const unicode11 = new Unicode11Addon();

    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(webLinks);
    term.loadAddon(unicode11);

    // 启用 unicode11 版本以正确渲染中文/emoji 宽字符
    term.unicode.activeVersion = '11';

    return { fit, search };
}
