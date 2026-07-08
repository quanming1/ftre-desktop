import { create } from 'zustand';

export type SidebarView = 'explorer' | 'git' | 'extensions';
export type BottomTab = 'terminal' | 'problems' | 'output';
export type LeftPanelType = 'chat' | 'skills' | 'cron' | 'traces' | 'settings';

export type SplitMode = 'ai-center' | 'code-center';
export type PanelId = 'sessions' | 'sidebar' | 'editor' | 'chat' | 'inspector';
export type LayoutMode = 'chat' | 'agent';

const STORAGE_KEY = 'ftre-layout-state';

// Range constants for resize clamping
export const SIDEBAR_WIDTH_MIN = 140;
export const SIDEBAR_WIDTH_MAX = 400;
export const BOTTOM_PANEL_HEIGHT_MIN = 100;
export const BOTTOM_PANEL_HEIGHT_MAX = 500;

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
    activeSidebarView: SidebarView | null;
    sidebarWidth: number;
    sessionsWidth: number;      // sessions panel width
    sessionsCollapsed: boolean; // whether sessions panel is collapsed to icon rail
    centerRatio: number;        // percentage (0-100) of center panel width
    bottomPanelHeight: number;
    sidebarVisible: boolean;
    bottomPanelVisible: boolean;
    activeBottomTab: BottomTab;
    minimapEnabled: boolean;
    splitMode: SplitMode;       // deprecated, kept for migration
    panelOrder: PanelId[];      // panel arrangement from left to right
    panelVisible: Record<PanelId, boolean>;  // visibility of each panel
    autoFollowFiles: boolean;
    layoutMode: LayoutMode;     // 'chat' or 'agent' layout mode
    activeLeftPanel: LeftPanelType;
    inspectorWidth: number;     // inspector panel width
    fileTreeWidth: number;      // file tree sidebar width
}

export interface LayoutState extends PersistedLayoutData {
    persist: () => void;
    restore: () => void;

    setActiveSidebarView: (view: SidebarView | null) => void;
    toggleSidebar: () => void;
    setSidebarWidth: (w: number) => void;
    setSessionsWidth: (w: number) => void;
    toggleSessionsCollapsed: () => void;
    setCenterRatio: (ratio: number) => void;
    setInspectorWidth: (w: number) => void;
    setFileTreeWidth: (w: number) => void;
    setBottomPanelHeight: (h: number) => void;
    toggleBottomPanel: () => void;
    setActiveBottomTab: (tab: BottomTab) => void;
    toggleMinimap: () => void;
    setSplitMode: (mode: SplitMode) => void;
    setPanelOrder: (order: PanelId[]) => void;
    togglePanelVisible: (panel: PanelId) => void;
    toggleAutoFollowFiles: () => void;
    setLayoutMode: (mode: LayoutMode) => void;
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
    sidebar: false,
    editor: false,
    chat: true,
    inspector: false,
};

// 写死为 Agent 模式：只显示会话列表 + 聊天，不再有 IDE（文件树/编辑器）。
const DEFAULT_LAYOUT_MODE: LayoutMode = 'agent';

const MODE_CONFIGS: Record<LayoutMode, {
    panelOrder: PanelId[];
    panelVisible: Record<PanelId, boolean>;
}> = {
    chat: {
        panelOrder: ['sessions', 'sidebar', 'editor', 'chat', 'inspector'],
        panelVisible: { sessions: true, sidebar: true, editor: true, chat: true, inspector: false },
    },
    agent: {
        panelOrder: ['sessions', 'chat', 'inspector'],
        panelVisible: { sessions: true, sidebar: false, editor: false, chat: true, inspector: false },
    },
};

const defaults: PersistedLayoutData = {
    activeSidebarView: 'explorer',
    sidebarWidth: 220,
    sessionsWidth: 240,
    sessionsCollapsed: false,
    centerRatio: CENTER_RATIO_DEFAULT,
    inspectorWidth: INSPECTOR_WIDTH_DEFAULT,
    bottomPanelHeight: 200,
    sidebarVisible: true,
    bottomPanelVisible: false,
    activeBottomTab: 'terminal',
    minimapEnabled: false,
    splitMode: 'ai-center',
    panelOrder: DEFAULT_PANEL_ORDER,
    panelVisible: DEFAULT_PANEL_VISIBLE,
    autoFollowFiles: true,
    layoutMode: DEFAULT_LAYOUT_MODE,
    activeLeftPanel: 'chat' as LeftPanelType,
    inspectorWidth: INSPECTOR_WIDTH_DEFAULT,
    fileTreeWidth: FILE_TREE_WIDTH_DEFAULT,
};

function getPersistedData(state: LayoutState): PersistedLayoutData {
    return {
        activeSidebarView: state.activeSidebarView,
        sidebarWidth: state.sidebarWidth,
        sessionsWidth: state.sessionsWidth,
        sessionsCollapsed: state.sessionsCollapsed,
        centerRatio: state.centerRatio,
        inspectorWidth: state.inspectorWidth,
        fileTreeWidth: state.fileTreeWidth,
        bottomPanelHeight: state.bottomPanelHeight,
        sidebarVisible: state.sidebarVisible,
        bottomPanelVisible: state.bottomPanelVisible,
        activeBottomTab: state.activeBottomTab,
        minimapEnabled: state.minimapEnabled,
        splitMode: state.splitMode,
        panelOrder: state.panelOrder,
        panelVisible: state.panelVisible,
        autoFollowFiles: state.autoFollowFiles,
        layoutMode: state.layoutMode,
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
                // Migrate old splitMode values to new ones
                if (parsed.splitMode && !['ai-center', 'code-center'].includes(parsed.splitMode)) {
                    parsed.splitMode = 'ai-center';
                }
                // Migrate old aiPanelWidth to centerRatio (drop it, use default)
                if ((parsed as any).aiPanelWidth !== undefined && parsed.centerRatio === undefined) {
                    parsed.centerRatio = CENTER_RATIO_DEFAULT;
                }
                // Migrate splitMode to panelOrder if panelOrder doesn't exist
                if (!parsed.panelOrder && parsed.splitMode) {
                    if (parsed.splitMode === 'ai-center') {
                        parsed.panelOrder = ['sessions', 'sidebar', 'chat', 'editor'];
                    } else {
                        parsed.panelOrder = ['sessions', 'sidebar', 'editor', 'chat'];
                    }
                }
                // Validate panelOrder has all 5 panels
                if (parsed.panelOrder && parsed.panelOrder.length !== 5) {
                    parsed.panelOrder = DEFAULT_PANEL_ORDER;
                }
                // Migrate panelVisible if not present
                if (!parsed.panelVisible || !('inspector' in parsed.panelVisible)) {
                    parsed.panelVisible = DEFAULT_PANEL_VISIBLE;
                }
                // Migrate inspectorWidth if not present
                if (typeof parsed.inspectorWidth !== 'number') {
                    parsed.inspectorWidth = INSPECTOR_WIDTH_DEFAULT;
                }
                // Migrate fileTreeWidth if not present
                if (typeof parsed.fileTreeWidth !== 'number') {
                    parsed.fileTreeWidth = FILE_TREE_WIDTH_DEFAULT;
                }
                // Migrate layoutMode if not present
                if (!parsed.layoutMode) {
                    // Infer from old panelVisible state
                    if (parsed.panelVisible?.sidebar === false && parsed.panelVisible?.editor === false) {
                        parsed.layoutMode = 'agent';
                    } else {
                        parsed.layoutMode = 'chat';
                    }
                }
                // 写死 Agent 模式：忽略历史持久化的 IDE 布局，强制只显示 sessions + chat。
                parsed.layoutMode = 'agent';
                parsed.panelOrder = MODE_CONFIGS.agent.panelOrder;
                parsed.panelVisible = MODE_CONFIGS.agent.panelVisible;
                set({ ...defaults, ...parsed });
            }
        } catch {
            // Corrupted data — fall back to defaults (Req 14.4 error handling)
            console.warn('Failed to restore layout state, using defaults');
            set({ ...defaults });
        }
    },

    setActiveSidebarView: (view) => {
        set({ activeSidebarView: view });
        get().persist();
    },

    toggleSidebar: () => {
        const { sidebarVisible, activeSidebarView } = get();
        if (sidebarVisible) {
            set({ sidebarVisible: false });
        } else {
            set({
                sidebarVisible: true,
                activeSidebarView: activeSidebarView ?? 'explorer',
            });
        }
        get().persist();
    },

    setSidebarWidth: (w) => {
        set({ sidebarWidth: Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, w)) });
        get().persist();
    },

    setSessionsWidth: (w) => {
        set({ sessionsWidth: Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, w)) });
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

    setBottomPanelHeight: (h) => {
        set({ bottomPanelHeight: Math.max(BOTTOM_PANEL_HEIGHT_MIN, Math.min(BOTTOM_PANEL_HEIGHT_MAX, h)) });
        get().persist();
    },

    toggleBottomPanel: () => {
        set({ bottomPanelVisible: !get().bottomPanelVisible });
        get().persist();
    },

    setActiveBottomTab: (tab) => {
        set({ activeBottomTab: tab });
        get().persist();
    },

    toggleMinimap: () => {
        set({ minimapEnabled: !get().minimapEnabled });
        get().persist();
    },

    setSplitMode: (mode) => {
        set({ splitMode: mode });
        get().persist();
    },

    setPanelOrder: (order) => {
        set({ panelOrder: order });
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

    setLayoutMode: (_mode) => {
        // 模式已写死为 Agent：忽略任何切回 chat（IDE）的请求，始终保持 agent 布局。
        const config = MODE_CONFIGS.agent;
        set({
            layoutMode: 'agent',
            panelOrder: config.panelOrder,
            panelVisible: config.panelVisible,
        });
        get().persist();
    },

    setActiveLeftPanel: (panel) => {
        set({ activeLeftPanel: panel });
        get().persist();
    },

    traceFocusSessionId: null,
    locateTraceSession: (sessionId) => {
        set({ activeLeftPanel: 'traces', traceFocusSessionId: sessionId });
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
