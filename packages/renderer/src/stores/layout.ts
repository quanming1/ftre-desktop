import { create } from 'zustand';
import { INSPECTOR_TRACE_TAB_ID, useInspector } from './inspector';

export type LeftPanelType = 'chat' | 'skills' | 'cron' | 'settings';

export type PanelId = 'sessions' | 'chat' | 'inspector';

const STORAGE_KEY = 'ftre-layout-state';

// Range constants for resize clamping
export const SESSIONS_WIDTH_MIN = 140;
export const SESSIONS_WIDTH_MAX = 400;
// Center panel ratio: percentage of available width for the center panel (0-100)
// Default 70% center, 30% side — no min/max clamping, drag freely
export const CENTER_RATIO_DEFAULT = 70;

// Inspector panel 宽度范围
export const INSPECTOR_WIDTH_MIN = 280;
export const INSPECTOR_WIDTH_MAX = 9999;
export const INSPECTOR_WIDTH_DEFAULT = 480;

// 文件树面板宽度范围
export const FILE_TREE_WIDTH_MIN = 140;
export const FILE_TREE_WIDTH_MAX = 500;
export const FILE_TREE_WIDTH_DEFAULT = 200;

const PERSIST_DEBOUNCE_MS = 300;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

interface PersistedLayoutData {
    sessionsWidth: number;      // sessions panel width
    sessionsCollapsed: boolean; // whether sessions panel is collapsed to icon rail
    centerRatio: number;        // percentage (0-100) of center panel width
    minimapEnabled: boolean;
    panelOrder: PanelId[];      // panel arrangement from left to right
    panelVisible: Record<PanelId, boolean>;  // visibility of each panel
    autoFollowFiles: boolean;
    activeLeftPanel: LeftPanelType;
    inspectorWidth: number;     // inspector panel width
    fileTreeWidth: number;      // file tree sidebar width
}

export interface LayoutState extends PersistedLayoutData {
    persist: () => void;
    restore: () => void;

    setSessionsWidth: (w: number) => void;
    toggleSessionsCollapsed: () => void;
    setCenterRatio: (ratio: number) => void;
    setInspectorWidth: (w: number) => void;
    setFileTreeWidth: (w: number) => void;
    toggleMinimap: () => void;
    togglePanelVisible: (panel: PanelId) => void;
    toggleAutoFollowFiles: () => void;
    setActiveLeftPanel: (panel: LeftPanelType) => void;

    /** Session 右键定位 Trace（运行时状态，不持久化） */
    traceFocusSessionId: string | null;
    locateTraceSession: (sessionId: string) => void;
    clearTraceFocus: () => void;

    /** 终端浮动窗口（运行时状态，不持久化） */
    terminalDropdownOpen: boolean;
    toggleTerminalDropdown: () => void;

    /** Agent 群聊浮动窗口（运行时状态，不持久化） */
    agentChatOpen: boolean;
    toggleAgentChat: () => void;

    /** MCP 快捷面板（运行时状态，不持久化） */
    mcpPopoverOpen: boolean;
    toggleMcpPopover: () => void;
    setMcpPopoverOpen: (open: boolean) => void;
}

const DEFAULT_PANEL_ORDER: PanelId[] = ['sessions', 'chat', 'inspector'];
const DEFAULT_PANEL_VISIBLE: Record<PanelId, boolean> = {
    sessions: true,
    chat: true,
    inspector: false,
};

const defaults: PersistedLayoutData = {
    sessionsWidth: 240,
    sessionsCollapsed: false,
    centerRatio: CENTER_RATIO_DEFAULT,
    inspectorWidth: INSPECTOR_WIDTH_DEFAULT,
    minimapEnabled: false,
    panelOrder: DEFAULT_PANEL_ORDER,
    panelVisible: DEFAULT_PANEL_VISIBLE,
    autoFollowFiles: true,
    activeLeftPanel: 'chat' as LeftPanelType,
    fileTreeWidth: FILE_TREE_WIDTH_DEFAULT,
};

function getPersistedData(state: LayoutState): PersistedLayoutData {
    return {
        sessionsWidth: state.sessionsWidth,
        sessionsCollapsed: state.sessionsCollapsed,
        centerRatio: state.centerRatio,
        inspectorWidth: state.inspectorWidth,
        fileTreeWidth: state.fileTreeWidth,
        minimapEnabled: state.minimapEnabled,
        panelOrder: state.panelOrder,
        panelVisible: state.panelVisible,
        autoFollowFiles: state.autoFollowFiles,
        activeLeftPanel: state.activeLeftPanel,
    };
}

export const useLayout = create<LayoutState>((set, get) => ({
    ...defaults,

    persist: () => {
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            try {
                const data = getPersistedData(get());
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            } catch {
                // localStorage write failure — silently ignore (Req 14.2 error handling)
            }
        }, PERSIST_DEBOUNCE_MS);
    },

    restore: () => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as Partial<PersistedLayoutData>;
                // Migrate old aiPanelWidth to centerRatio (drop it, use default)
                if ((parsed as any).aiPanelWidth !== undefined && parsed.centerRatio === undefined) {
                    parsed.centerRatio = CENTER_RATIO_DEFAULT;
                }
                // Migrate inspectorWidth if not present
                if (typeof parsed.inspectorWidth !== 'number') {
                    parsed.inspectorWidth = INSPECTOR_WIDTH_DEFAULT;
                }
                // Migrate fileTreeWidth if not present
                if (typeof parsed.fileTreeWidth !== 'number') {
                    parsed.fileTreeWidth = FILE_TREE_WIDTH_DEFAULT;
                }
                // Traces 已迁移到右侧 Inspector 固定 Tab。
                if ((parsed.activeLeftPanel as string | undefined) === 'traces') {
                    parsed.activeLeftPanel = 'chat';
                }
                // 当前客户端只保留 sessions + chat 的 Agent 布局；旧 IDE 布局不再恢复。
                parsed.panelOrder = DEFAULT_PANEL_ORDER;
                parsed.panelVisible = DEFAULT_PANEL_VISIBLE;
                set({ ...defaults, ...parsed });
            }
        } catch {
            // Corrupted data — fall back to defaults (Req 14.4 error handling)
            console.warn('Failed to restore layout state, using defaults');
            set({ ...defaults });
        }
    },

    setSessionsWidth: (w) => {
        set({ sessionsWidth: Math.max(SESSIONS_WIDTH_MIN, Math.min(SESSIONS_WIDTH_MAX, w)) });
        get().persist();
    },

    toggleSessionsCollapsed: () => {
        set({ sessionsCollapsed: !get().sessionsCollapsed });
        get().persist();
    },

    setCenterRatio: (ratio) => {
        set({ centerRatio: Math.max(10, Math.min(90, ratio)) });
        get().persist();
    },

    setInspectorWidth: (w) => {
        set({ inspectorWidth: Math.max(INSPECTOR_WIDTH_MIN, Math.min(INSPECTOR_WIDTH_MAX, w)) });
        get().persist();
    },

    setFileTreeWidth: (w) => {
        set({ fileTreeWidth: Math.max(FILE_TREE_WIDTH_MIN, Math.min(FILE_TREE_WIDTH_MAX, w)) });
        get().persist();
    },

    toggleMinimap: () => {
        set({ minimapEnabled: !get().minimapEnabled });
        get().persist();
    },

    togglePanelVisible: (panel) => {
        const { panelVisible } = get();
        set({ panelVisible: { ...panelVisible, [panel]: !panelVisible[panel] } });
        get().persist();
    },

    toggleAutoFollowFiles: () => {
        set({ autoFollowFiles: !get().autoFollowFiles });
        get().persist();
    },

    setActiveLeftPanel: (panel) => {
        set({ activeLeftPanel: panel });
        get().persist();
    },

    traceFocusSessionId: null,
    locateTraceSession: (sessionId) => {
        set((state) => ({
            activeLeftPanel: 'chat',
            traceFocusSessionId: sessionId,
            panelVisible: { ...state.panelVisible, inspector: true },
        }));
        useInspector.getState().setActiveTab(INSPECTOR_TRACE_TAB_ID);
        get().persist();
    },
    clearTraceFocus: () => set({ traceFocusSessionId: null }),

    // 终端浮动窗口 — 运行时状态，不写 localStorage
    terminalDropdownOpen: false,
    toggleTerminalDropdown: () => {
        set({ terminalDropdownOpen: !get().terminalDropdownOpen });
    },

    // Agent 群聊浮动窗口 — 运行时状态，不写 localStorage
    agentChatOpen: false,
    toggleAgentChat: () => {
        set({ agentChatOpen: !get().agentChatOpen });
    },

    // MCP 快捷面板 — 运行时状态，不写 localStorage
    mcpPopoverOpen: false,
    toggleMcpPopover: () => {
        set({ mcpPopoverOpen: !get().mcpPopoverOpen });
    },
    setMcpPopoverOpen: (open) => {
        set({ mcpPopoverOpen: open });
    },
}));
