import { useShortcut } from '../stores/shortcut';
import { useLayout } from '../stores/layout';
import { useEditor } from '../stores/editor';
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

    // Ctrl+P → Quick Open (file palette)
    register({
        id: 'quickOpen',
        keys: 'ctrl+p',
        label: '快速打开',
        category: '通用',
        context: 'global',
        execute: () => {
            window.dispatchEvent(new CustomEvent('ftre:toggle-file-palette'));
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

    // Ctrl+Shift+F → Search in Files (opens global palette with content tab)
    register({
        id: 'searchInFiles',
        keys: 'ctrl+shift+f',
        label: '在文件中搜索',
        category: '通用',
        context: 'global',
        execute: () => {
            useGlobalSearch.getState().openWithCategory('content');
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

    // Ctrl+\ → Split Editor
    // context: global — this is a globally available action (not editor-only),
    // and useGlobalShortcuts always dispatches with 'global' context.
    register({
        id: 'splitEditor',
        keys: 'ctrl+\\',
        label: '拆分编辑器',
        category: '编辑器',
        context: 'global',
        execute: () => {
            useEditor.getState().splitEditor();
        },
    });

    // Ctrl+N → New Untitled File
    register({
        id: 'newUntitledFile',
        keys: 'ctrl+n',
        label: '新建无标题文件',
        category: '通用',
        context: 'global',
        execute: () => {
            useEditor.getState().createUntitledFile();
        },
    });

    // Toggle Minimap
    register({
        id: 'toggleMinimap',
        keys: '',
        label: '切换小地图',
        category: '视图',
        context: 'global',
        execute: () => {
            useLayout.getState().toggleMinimap();
        },
    });

    // Toggle Auto Follow Files
    register({
        id: 'toggleAutoFollowFiles',
        keys: '',
        label: '切换自动跟随文件（AI 编辑/写入）',
        category: 'AI',
        context: 'global',
        execute: () => {
            useLayout.getState().toggleAutoFollowFiles();
        },
    });
}
