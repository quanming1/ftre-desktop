import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLayout } from './layout';

// Use fake timers to control debounced persist
beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useLayout.setState({
        activeSidebarView: 'explorer',
        sidebarWidth: 220,
        centerRatio: 70,
        bottomPanelHeight: 200,
        sidebarVisible: true,
        bottomPanelVisible: false,
        activeBottomTab: 'terminal',
        minimapEnabled: false,
        splitMode: 'ai-center',
        layoutMode: 'chat',
        panelOrder: ['sessions', 'sidebar', 'editor', 'chat', 'inspector'],
        panelVisible: { sessions: true, sidebar: true, editor: true, chat: true, inspector: false },
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('layout store — defaults', () => {
    it('has correct default values', () => {
        const s = useLayout.getState();
        expect(s.activeSidebarView).toBe('explorer');
        expect(s.sidebarWidth).toBe(220);
        expect(s.centerRatio).toBe(70);
        expect(s.bottomPanelHeight).toBe(200);
        expect(s.sidebarVisible).toBe(true);
        expect(s.bottomPanelVisible).toBe(false);
        expect(s.activeBottomTab).toBe('terminal');
        expect(s.minimapEnabled).toBe(false);
        expect(s.splitMode).toBe('ai-center');
    });
});

describe('layout store — setters', () => {
    it('setActiveSidebarView changes the view', () => {
        useLayout.getState().setActiveSidebarView('git');
        expect(useLayout.getState().activeSidebarView).toBe('git');
    });

    it('setActiveSidebarView accepts null', () => {
        useLayout.getState().setActiveSidebarView(null);
        expect(useLayout.getState().activeSidebarView).toBeNull();
    });

    it('setSidebarWidth updates width', () => {
        useLayout.getState().setSidebarWidth(300);
        expect(useLayout.getState().sidebarWidth).toBe(300);
    });

    it('setCenterRatio updates ratio', () => {
        useLayout.getState().setCenterRatio(50);
        expect(useLayout.getState().centerRatio).toBe(50);
    });

    it('setCenterRatio allows any value between 10 and 90', () => {
        useLayout.getState().setCenterRatio(15);
        expect(useLayout.getState().centerRatio).toBe(15);
        useLayout.getState().setCenterRatio(85);
        expect(useLayout.getState().centerRatio).toBe(85);
    });

    it('setCenterRatio clamps below 10', () => {
        useLayout.getState().setCenterRatio(5);
        expect(useLayout.getState().centerRatio).toBe(10);
    });

    it('setCenterRatio clamps above 90', () => {
        useLayout.getState().setCenterRatio(95);
        expect(useLayout.getState().centerRatio).toBe(90);
    });

    it('setBottomPanelHeight updates height', () => {
        useLayout.getState().setBottomPanelHeight(350);
        expect(useLayout.getState().bottomPanelHeight).toBe(350);
    });

    it('setActiveBottomTab changes the tab', () => {
        useLayout.getState().setActiveBottomTab('problems');
        expect(useLayout.getState().activeBottomTab).toBe('problems');
    });

    it('setSplitMode switches between ai-center and code-center', () => {
        useLayout.getState().setSplitMode('code-center');
        expect(useLayout.getState().splitMode).toBe('code-center');
        useLayout.getState().setSplitMode('ai-center');
        expect(useLayout.getState().splitMode).toBe('ai-center');
    });
});

describe('layout store — toggles', () => {
    it('toggleSidebar hides when visible', () => {
        useLayout.getState().toggleSidebar();
        expect(useLayout.getState().sidebarVisible).toBe(false);
    });

    it('toggleSidebar shows and restores view when hidden', () => {
        useLayout.getState().setActiveSidebarView(null);
        useLayout.getState().toggleSidebar(); // hide
        useLayout.getState().toggleSidebar(); // show
        expect(useLayout.getState().sidebarVisible).toBe(true);
        expect(useLayout.getState().activeSidebarView).toBe('explorer');
    });

    it('toggleBottomPanel flips visibility', () => {
        expect(useLayout.getState().bottomPanelVisible).toBe(false);
        useLayout.getState().toggleBottomPanel();
        expect(useLayout.getState().bottomPanelVisible).toBe(true);
        useLayout.getState().toggleBottomPanel();
        expect(useLayout.getState().bottomPanelVisible).toBe(false);
    });

    it('toggleMinimap flips enabled state', () => {
        expect(useLayout.getState().minimapEnabled).toBe(false);
        useLayout.getState().toggleMinimap();
        expect(useLayout.getState().minimapEnabled).toBe(true);
        useLayout.getState().toggleMinimap();
        expect(useLayout.getState().minimapEnabled).toBe(false);
    });
});

describe('layout store — auto-persistence on setter calls', () => {
    it('setActiveSidebarView auto-persists', () => {
        useLayout.getState().setActiveSidebarView('git');
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem('ftre-layout-state')!);
        expect(stored.activeSidebarView).toBe('git');
    });

    it('toggleSidebar auto-persists', () => {
        useLayout.getState().toggleSidebar(); // hide
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem('ftre-layout-state')!);
        expect(stored.sidebarVisible).toBe(false);
    });

    it('setSidebarWidth auto-persists', () => {
        useLayout.getState().setSidebarWidth(350);
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem('ftre-layout-state')!);
        expect(stored.sidebarWidth).toBe(350);
    });

    it('setCenterRatio auto-persists', () => {
        useLayout.getState().setCenterRatio(60);
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem('ftre-layout-state')!);
        expect(stored.centerRatio).toBe(60);
    });

    it('setBottomPanelHeight auto-persists', () => {
        useLayout.getState().setBottomPanelHeight(400);
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem('ftre-layout-state')!);
        expect(stored.bottomPanelHeight).toBe(400);
    });

    it('toggleBottomPanel auto-persists', () => {
        useLayout.getState().toggleBottomPanel();
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem('ftre-layout-state')!);
        expect(stored.bottomPanelVisible).toBe(true);
    });

    it('setActiveBottomTab auto-persists', () => {
        useLayout.getState().setActiveBottomTab('problems');
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem('ftre-layout-state')!);
        expect(stored.activeBottomTab).toBe('problems');
    });

    it('toggleMinimap auto-persists', () => {
        useLayout.getState().toggleMinimap();
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem('ftre-layout-state')!);
        expect(stored.minimapEnabled).toBe(true);
    });

    it('debounces rapid persist calls', () => {
        useLayout.getState().setSidebarWidth(300);
        useLayout.getState().setSidebarWidth(310);
        useLayout.getState().setSidebarWidth(320);
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem('ftre-layout-state')!);
        expect(stored.sidebarWidth).toBe(320); // only last value persisted
    });
});

describe('layout store — persist/restore', () => {
    it('persist writes to localStorage and restore reads it back', () => {
        useLayout.getState().setSidebarWidth(300);
        useLayout.getState().setCenterRatio(60);
        useLayout.getState().setActiveSidebarView('git');
        useLayout.getState().toggleMinimap();
        useLayout.getState().persist();
        vi.advanceTimersByTime(300);

        // Reset store to defaults
        useLayout.setState({
            activeSidebarView: 'explorer',
            sidebarWidth: 220,
            centerRatio: 70,
            minimapEnabled: false,
        });

        useLayout.getState().restore();
        const s = useLayout.getState();
        expect(s.sidebarWidth).toBe(300);
        expect(s.centerRatio).toBe(60);
        expect(s.activeSidebarView).toBe('git');
        expect(s.minimapEnabled).toBe(true);
    });

    it('restore with no stored data keeps defaults', () => {
        useLayout.getState().restore();
        const s = useLayout.getState();
        expect(s.sidebarWidth).toBe(220);
        expect(s.centerRatio).toBe(70);
        expect(s.activeSidebarView).toBe('explorer');
    });

    it('restore with corrupted data falls back to defaults', () => {
        useLayout.getState().setSidebarWidth(400); // max clamped value
        localStorage.setItem('ftre-layout-state', 'not-valid-json!!!');
        useLayout.getState().restore();
        expect(useLayout.getState().sidebarWidth).toBe(220);
    });

    it('restore merges partial stored data with defaults', () => {
        localStorage.setItem('ftre-layout-state', JSON.stringify({ sidebarWidth: 350 }));
        useLayout.getState().restore();
        const s = useLayout.getState();
        expect(s.sidebarWidth).toBe(350);
        expect(s.centerRatio).toBe(70); // default
        expect(s.activeBottomTab).toBe('terminal'); // default
    });

    it('restore migrates old splitMode values to ai-center', () => {
        localStorage.setItem('ftre-layout-state', JSON.stringify({ splitMode: 'ai-code' }));
        useLayout.getState().restore();
        expect(useLayout.getState().splitMode).toBe('ai-center');
    });

    it('restore migrates code-only to ai-center', () => {
        localStorage.setItem('ftre-layout-state', JSON.stringify({ splitMode: 'code-only' }));
        useLayout.getState().restore();
        expect(useLayout.getState().splitMode).toBe('ai-center');
    });

    it('restore migrates ai-only to ai-center', () => {
        localStorage.setItem('ftre-layout-state', JSON.stringify({ splitMode: 'ai-only' }));
        useLayout.getState().restore();
        expect(useLayout.getState().splitMode).toBe('ai-center');
    });

    it('restore keeps valid new splitMode values', () => {
        localStorage.setItem('ftre-layout-state', JSON.stringify({ splitMode: 'code-center' }));
        useLayout.getState().restore();
        expect(useLayout.getState().splitMode).toBe('code-center');
    });

    it('restore migrates old aiPanelWidth to default centerRatio', () => {
        localStorage.setItem('ftre-layout-state', JSON.stringify({ aiPanelWidth: 500 }));
        useLayout.getState().restore();
        expect(useLayout.getState().centerRatio).toBe(70); // default, not the old pixel value
    });
});

describe('layout store — range clamping', () => {
    it('setSidebarWidth clamps to min 140', () => {
        useLayout.getState().setSidebarWidth(50);
        expect(useLayout.getState().sidebarWidth).toBe(140);
    });

    it('setSidebarWidth clamps to max 400', () => {
        useLayout.getState().setSidebarWidth(999);
        expect(useLayout.getState().sidebarWidth).toBe(400);
    });

    it('setBottomPanelHeight clamps to min 100', () => {
        useLayout.getState().setBottomPanelHeight(30);
        expect(useLayout.getState().bottomPanelHeight).toBe(100);
    });

    it('setBottomPanelHeight clamps to max 500', () => {
        useLayout.getState().setBottomPanelHeight(900);
        expect(useLayout.getState().bottomPanelHeight).toBe(500);
    });
});

describe('layout store — layoutMode (VAC tests)', () => {
    // VAC-1: Default mode is Chat
    it('VAC-1: defaults to chat mode', () => {
        const s = useLayout.getState();
        expect(s.layoutMode).toBe('chat');
    });

    // VAC-2: Agent mode shows only Sessions, Chat, and Inspector
    it('VAC-2: setLayoutMode to agent hides sidebar and editor', () => {
        useLayout.getState().setLayoutMode('agent');
        const s = useLayout.getState();
        expect(s.layoutMode).toBe('agent');
        expect(s.panelOrder).toEqual(['sessions', 'chat', 'inspector']);
        expect(s.panelVisible.sessions).toBe(true);
        expect(s.panelVisible.sidebar).toBe(false);
        expect(s.panelVisible.editor).toBe(false);
        expect(s.panelVisible.chat).toBe(true);
        expect(s.panelVisible.inspector).toBe(false);
    });

    // VAC-3: Chat mode shows all four panels
    it('VAC-3: setLayoutMode to chat shows all panels', () => {
        // First switch to agent mode
        useLayout.getState().setLayoutMode('agent');
        // Then switch back to chat mode
        useLayout.getState().setLayoutMode('chat');
        const s = useLayout.getState();
        expect(s.layoutMode).toBe('chat');
        expect(s.panelOrder).toEqual(['sessions', 'sidebar', 'editor', 'chat']);
        expect(s.panelVisible.sessions).toBe(true);
        expect(s.panelVisible.sidebar).toBe(true);
        expect(s.panelVisible.editor).toBe(true);
        expect(s.panelVisible.chat).toBe(true);
    });

    // VAC-4: Mode persists after refresh
    it('VAC-4: setLayoutMode auto-persists', () => {
        useLayout.getState().setLayoutMode('agent');
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem('ftre-layout-state')!);
        expect(stored.layoutMode).toBe('agent');
    });

    it('VAC-4: layoutMode restores correctly', () => {
        useLayout.getState().setLayoutMode('agent');
        vi.advanceTimersByTime(300);
        // Reset store
        useLayout.setState({ layoutMode: 'chat' });
        // Restore from localStorage
        useLayout.getState().restore();
        expect(useLayout.getState().layoutMode).toBe('agent');
    });

    // VAC-7: Legacy data migration
    it('VAC-7: restore without layoutMode defaults to chat', () => {
        localStorage.setItem('ftre-layout-state', JSON.stringify({
            sidebarWidth: 300,
            panelVisible: { sessions: true, sidebar: true, editor: true, chat: true },
        }));
        useLayout.getState().restore();
        expect(useLayout.getState().layoutMode).toBe('chat');
    });

    it('VAC-7: restore infers agent mode from panelVisible', () => {
        localStorage.setItem('ftre-layout-state', JSON.stringify({
            sidebarWidth: 300,
            panelVisible: { sessions: true, sidebar: false, editor: false, chat: true },
        }));
        useLayout.getState().restore();
        expect(useLayout.getState().layoutMode).toBe('agent');
    });

    it('VAC-7: restore preserves existing layoutMode', () => {
        localStorage.setItem('ftre-layout-state', JSON.stringify({
            layoutMode: 'agent',
            panelVisible: { sessions: true, sidebar: true, editor: true, chat: true },
        }));
        useLayout.getState().restore();
        expect(useLayout.getState().layoutMode).toBe('agent');
    });
});
