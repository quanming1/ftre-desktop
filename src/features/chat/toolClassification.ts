import type { ToolCallMessage } from '@/types/chat';
import { basename } from '@/utils/pathUtils';

export type ToolCategory = 'file-read' | 'file-write' | 'file-edit' | 'command' | 'search';

export const TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
    read: 'file-read',
    write: 'file-write',
    edit: 'file-edit',
    bash: 'command',
    glob: 'search',
    grep: 'search',
};

export interface ToolDisplayInfo {
    category: ToolCategory;
    icon: string;
    summary: string;
    actionLabel: string;
    hasAction: boolean;
}

export const CATEGORY_ICONS: Record<ToolCategory, string> = {
    'file-read': 'file-text',
    'file-write': 'file-text',
    'file-edit': 'file-diff',
    'command': 'terminal',
    'search': 'search',
};

export const CATEGORY_ACTION_LABELS: Record<ToolCategory, string> = {
    'file-read': '打开文件',
    'file-write': '打开文件',
    'file-edit': '查看差异',
    'command': '',
    'search': '',
};


/** 渲染模式：决定用哪个组件渲染工具调用 */
export type ToolRenderMode = 'inline' | 'file-nav' | 'diff' | 'generic';

/** 工具名 → 渲染模式映射 */
export const TOOL_RENDER_MODE: Record<string, ToolRenderMode> = {
    grep: 'inline',
    glob: 'inline',
    bash: 'inline',
    think: 'inline',
    read: 'file-nav',
    write: 'file-nav',
    read_message: 'file-nav',
    edit: 'diff',
};

export function getToolRenderMode(toolName: string): ToolRenderMode {
    return TOOL_RENDER_MODE[toolName] ?? 'generic';
}

/**
 * Extract the file path from a ToolCallMessage's arguments.
 * Returns null if no valid filePath string is found.
 */
export function getToolFilePath(message: ToolCallMessage): string | null {
    const filePath = message.arguments?.filePath;
    return typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
}

/**
 * Generate a short summary string for a ToolCallMessage.
 * - File tools: display the basename of the file path
 * - bash: truncate command to first 60 characters
 * - search (glob/grep): display the search pattern
 */
export function getToolSummary(message: ToolCallMessage): string {
    const category = TOOL_CATEGORY_MAP[message.name];

    if (category === 'file-read' || category === 'file-write' || category === 'file-edit') {
        const filePath = getToolFilePath(message);
        return filePath ? basename(filePath) : message.name;
    }

    if (category === 'command') {
        const command = message.arguments?.command;
        if (typeof command === 'string') {
            return command.length > 60 ? command.slice(0, 60) + '…' : command;
        }
        return message.name;
    }

    if (category === 'search') {
        const pattern = message.arguments?.pattern;
        if (typeof pattern === 'string') {
            return pattern;
        }
        return message.name;
    }

    return message.name;
}

/**
 * Determine whether a file-category tool has complete arguments for its action.
 * - file-read / file-write: filePath must be present
 * - file-edit: filePath, oldString, AND newString must ALL be present
 * - command / search: always false
 */
function hasCompleteAction(category: ToolCategory, args: Record<string, unknown>): boolean {
    if (category === 'file-read' || category === 'file-write') {
        return typeof args.filePath === 'string' && args.filePath.length > 0;
    }
    if (category === 'file-edit') {
        return (
            typeof args.filePath === 'string' && args.filePath.length > 0 &&
            typeof args.oldString === 'string' &&
            typeof args.newString === 'string'
        );
    }
    return false;
}

/**
 * Get full display info for a ToolCallMessage, including category, icon,
 * summary text, action label, and whether an action button should be shown.
 */
export function getToolDisplayInfo(message: ToolCallMessage): ToolDisplayInfo {
    const category = TOOL_CATEGORY_MAP[message.name] ?? 'command';
    const icon = CATEGORY_ICONS[category];
    const summary = getToolSummary(message);
    const actionLabel = CATEGORY_ACTION_LABELS[category];
    const hasAction = hasCompleteAction(category, message.arguments ?? {});

    return { category, icon, summary, actionLabel, hasAction };
}

// ═══════════════════════════════════════════════════════════════════════
// 工具分组配置
// ═══════════════════════════════════════════════════════════════════════

/** 支持合并分组的工具名称集合（统一归入 "Explore" 组） */
export const GROUPABLE_TOOLS = new Set(['read', 'grep', 'glob']);

/**
 * 分组 key：决定哪些工具会被合并到同一个分组。
 * read/glob/grep 统一归入 "explore" 组。
 */
export function getGroupKey(toolName: string): string {
    if (GROUPABLE_TOOLS.has(toolName)) return 'explore';
    return toolName;
}

/** 分组的显示标题（按 groupKey） */
export const GROUP_DISPLAY_TITLE: Record<string, string> = {
    explore: 'Explore',
};

/** 判断工具是否支持分组 */
export function isGroupableTool(toolName: string): boolean {
    return GROUPABLE_TOOLS.has(toolName);
}

/**
 * 获取分组中每个 item 的标签文本
 * - read: 显示文件路径（basename 或相对路径）
 * - grep: 显示搜索 pattern
 * - glob: 显示 glob pattern
 */
export function getGroupItemLabel(message: ToolCallMessage): string {
    if (message.name === 'read') {
        const filePath = getToolFilePath(message);
        if (filePath) {
            // 显示文件路径后半部分（最多保留 3 段路径）
            const segments = filePath.replace(/\\/g, '/').split('/');
            return segments.length > 3
                ? segments.slice(-3).join('/')
                : segments.join('/');
        }
        return 'unknown file';
    }
    if (message.name === 'grep') {
        const pattern = message.arguments?.pattern;
        return typeof pattern === 'string' ? pattern : 'grep';
    }
    if (message.name === 'glob') {
        const pattern = message.arguments?.pattern;
        return typeof pattern === 'string' ? pattern : 'glob';
    }
    return message.name;
}
