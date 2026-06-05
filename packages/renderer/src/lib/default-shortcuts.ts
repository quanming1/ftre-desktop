import { useShortcut } from '../stores/shortcut';
import { useLayout } from '../stores/layout';
import { useGlobalSearch } from '../stores/global-search';

/**
 * Registers all default keyboard shortcut bindings.
 * Should be called once on app mount (e.g. in a useEffect in Workbench).
 */
export function registerDefaultShortcuts(): void {
    const { register } = useShortcut.getState();

    // Ctrl+K → Global Search
    register({
        id: 'globalSearch',
        keys: 'ctrl+k',
        label: '全局搜索',
        category: '通用',
        context: 'global',
        execute: () => {
            useGlobalSearch.getState().toggle();
        },
    });

    // Ctrl+Shift+P → Command Palette
    register({
        id: 'commandPalette',
        keys: 'ctrl+shift+p',
        label: '命令面板',
        category: '通用',
        context: 'global',
        execute: () => {
            window.dispatchEvent(new CustomEvent('ftre:toggle-command-palette'));
        },
    });

    // Ctrl+` → Toggle Terminal Dropdown
    register({
        id: 'toggleTerminal',
        keys: 'ctrl+`',
        label: '切换终端',
        category: '视图',
        context: 'global',
        execute: () => {
            useLayout.getState().toggleTerminalDropdown();
        },
    });

    // Ctrl+B → Toggle Sidebar
    register({
        id: 'toggleSidebar',
        keys: 'ctrl+b',
        label: '切换侧边栏',
        category: '视图',
        context: 'global',
        execute: () => {
            useLayout.getState().toggleSidebar();
        },
    });

    // 重启应用（重新加载渲染进程）
    register({
        id: 'reloadApp',
        keys: '',
        label: '重启应用',
        category: '通用',
        context: 'global',
        execute: () => {
            window.location.reload();
        },
    });
}
