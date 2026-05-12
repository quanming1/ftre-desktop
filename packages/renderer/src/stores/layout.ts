import { create } from 'zustand';

export type SidebarView = 'explorer' | 'git' | 'extensions';
export type BottomTab = 'terminal' | 'problems' | 'output';

export type SplitMode = 'ai-center' | 'code-center';
export type PanelId = 'sessions' | 'sidebar' | 'editor' | 'chat';
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

const PERSIST_DEBOUNCE_MS = 300;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

interface PersistedLayoutData {
    activeSidebarView: SidebarView | null;
    sidebarWidth: number;
    sessionsWidth: number;      // sessions panel width
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
}

export interface LayoutState extends PersistedLayoutData {
    persist: () => void;
    restore: () => void;

    setActiveSidebarView: (view: SidebarView | null) => void;
    toggleSidebar: () => void;
    setSidebarWidth: (w: number) => void;
    setSessionsWidth: (w: number) => void;
    setCenterRatio: (ratio: number) => void;
    setBottomPanelHeight: (h: number) => void;
    toggleBottomPanel: () => void;
    setActiveBottomTab: (tab: BottomTab) => void;
    toggleMinimap: () => void;
    setSplitMode: (mode: SplitMode) => void;
    setPanelOrder: (order: PanelId[]) => void;
    togglePanelVisible: (panel: PanelId) => void;
    toggleAutoFollowFiles: () => void;
    setLayoutMode: (mode: LayoutMode) => void;

    /** 终端浮动窗口（运行时状态，不持久化） */
    terminalDropdownOpen: boolean;
    toggleTerminalDropdown: () => void;

    /** Agent 群聊浮动窗口（运行时状态，不持久化） */
    agentChatOpen: boolean;
    toggleAgentChat: () => void;

    /** 任务监控浮动窗口（运行时状态，不持久化） */
    taskPanelOpen: boolean;
    toggleTaskPanel: () => void;
}

const DEFAULT_PANEL_ORDER: PanelId[] = ['sessions', 'sidebar', 'editor', 'chat'];
const DEFAULT_PANEL_VISIBLE: Record<PanelId, boolean> = {
    sessions: true,
    sidebar: true,
    editor: true,
    chat: true,
};

const DEFAULT_LAYOUT_MODE: LayoutMode = 'chat';

const MODE_CONFIGS: Record<LayoutMode, {
    panelOrder: PanelId[];
    panelVisible: Record<PanelId, boolean>;
}> = {
    chat: {
        panelOrder: ['sessions', 'sidebar', 'editor', 'chat'],
        panelVisible: { sessions: true, sidebar: true, editor: true, chat: true },
    },
    agent: {
        panelOrder: ['sessions', 'chat'],
        panelVisible: { sessions: true, sidebar: false, editor: false, chat: true },
    },
};

const defaults: PersistedLayoutData = {
    activeSidebarView: 'explorer',
    sidebarWidth: 220,
    sessionsWidth: 240,
    centerRatio: CENTER_RATIO_DEFAULT,
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
};

function getPersistedData(state: LayoutState): PersistedLayoutData {
    return {
        activeSidebarView: state.activeSidebarView,
        sidebarWidth: state.sidebarWidth,
        sessionsWidth: state.sessionsWidth,
        centerRatio: state.centerRatio,
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
                // Validate panelOrder has all 4 panels
                if (parsed.panelOrder && parsed.panelOrder.length !== 4) {
                    parsed.panelOrder = DEFAULT_PANEL_ORDER;
                }
                // Migrate panelVisible if not present
                if (!parsed.panelVisible) {
                    parsed.panelVisible = DEFAULT_PANEL_VISIBLE;
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

    setCenterRatio: (ratio) => {
        // Clamp between 10% and 90% to keep both panels minimally usable
        set({ centerRatio: Math.max(10, Math.min(90, ratio)) });
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

    setLayoutMode: (mode) => {
        const config = MODE_CONFIGS[mode];
        set({
            layoutMode: mode,
            panelOrder: config.panelOrder,
            panelVisible: config.panelVisible,
        });
        get().persist();
    },

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

    // 任务监控浮动窗口 — 运行时状态，不写 localStorage
    taskPanelOpen: false,
    toggleTaskPanel: () => {
        set({ taskPanelOpen: !get().taskPanelOpen });
    },
}));
