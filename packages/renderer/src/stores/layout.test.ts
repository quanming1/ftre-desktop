import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLayout } from './layout';
import { INSPECTOR_TRACE_TAB_ID, useInspector } from './inspector';

// Use fake timers to control debounced persist
beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useLayout.setState({
        sessionsWidth: 240,
        centerRatio: 70,
        minimapEnabled: false,
        panelOrder: ['sessions', 'chat', 'inspector'],
        panelVisible: { sessions: true, chat: true, inspector: false },
    });
    useInspector.setState({ activeTabId: null });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('layout store — defaults', () => {
    it('has correct default values', () => {
        const s = useLayout.getState();
        expect(s.centerRatio).toBe(70);
        expect(s.minimapEnabled).toBe(false);
    });
});

describe('layout store — setters', () => {
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

});

describe('layout store — toggles', () => {
    it('toggleMinimap flips enabled state', () => {
        expect(useLayout.getState().minimapEnabled).toBe(false);
        useLayout.getState().toggleMinimap();
        expect(useLayout.getState().minimapEnabled).toBe(true);
        useLayout.getState().toggleMinimap();
        expect(useLayout.getState().minimapEnabled).toBe(false);
    });
});

describe('layout store — trace inspector', () => {
    it('locateTraceSession opens the fixed Traces tab on the right', () => {
        useLayout.setState({ activeLeftPanel: 'skills' });

        useLayout.getState().locateTraceSession('ws_sess_1');

        const state = useLayout.getState();
        expect(state.activeLeftPanel).toBe('chat');
        expect(state.panelVisible.inspector).toBe(true);
        expect(state.traceFocusSessionId).toBe('ws_sess_1');
        expect(useInspector.getState().activeTabId).toBe(INSPECTOR_TRACE_TAB_ID);
    });
});

describe('layout store — auto-persistence on setter calls', () => {
    it('setCenterRatio auto-persists', () => {
        useLayout.getState().setCenterRatio(60);
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem('ftre-layout-state')!);
        expect(stored.centerRatio).toBe(60);
    });

    it('toggleMinimap auto-persists', () => {
        useLayout.getState().toggleMinimap();
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem('ftre-layout-state')!);
        expect(stored.minimapEnabled).toBe(true);
    });

    it('debounces rapid persist calls', () => {
        useLayout.getState().setSessionsWidth(300);
        useLayout.getState().setSessionsWidth(310);
        useLayout.getState().setSessionsWidth(320);
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem('ftre-layout-state')!);
        expect(stored.sessionsWidth).toBe(320); // only last value persisted
    });
});

describe('layout store — persist/restore', () => {
    it('persist writes to localStorage and restore reads it back', () => {
        useLayout.getState().setSessionsWidth(300);
        useLayout.getState().setCenterRatio(60);
        useLayout.getState().toggleMinimap();
        useLayout.getState().persist();
        vi.advanceTimersByTime(300);

        // Reset store to defaults
        useLayout.setState({
            sessionsWidth: 240,
            centerRatio: 70,
            minimapEnabled: false,
        });

        useLayout.getState().restore();
        const s = useLayout.getState();
        expect(s.sessionsWidth).toBe(300);
        expect(s.centerRatio).toBe(60);
        expect(s.minimapEnabled).toBe(true);
    });

    it('restore with no stored data keeps defaults', () => {
        useLayout.getState().restore();
        const s = useLayout.getState();
        expect(s.centerRatio).toBe(70);
        expect(s.sessionsWidth).toBe(240);
    });

    it('restore with corrupted data falls back to defaults', () => {
        useLayout.getState().setSessionsWidth(400); // max clamped value
        localStorage.setItem('ftre-layout-state', 'not-valid-json!!!');
        useLayout.getState().restore();
        expect(useLayout.getState().sessionsWidth).toBe(240);
    });

    it('restore merges partial stored data with defaults', () => {
        localStorage.setItem('ftre-layout-state', JSON.stringify({ sessionsWidth: 350 }));
        useLayout.getState().restore();
        const s = useLayout.getState();
        expect(s.sessionsWidth).toBe(350);
        expect(s.centerRatio).toBe(70); // default
    });

    it('restore migrates old aiPanelWidth to default centerRatio', () => {
        localStorage.setItem('ftre-layout-state', JSON.stringify({ aiPanelWidth: 500 }));
        useLayout.getState().restore();
        expect(useLayout.getState().centerRatio).toBe(70); // default, not the old pixel value
    });
});

describe('layout store — range clamping', () => {
    it('setSessionsWidth clamps to min 140', () => {
        useLayout.getState().setSessionsWidth(50);
        expect(useLayout.getState().sessionsWidth).toBe(140);
    });

    it('setSessionsWidth clamps to max 400', () => {
        useLayout.getState().setSessionsWidth(999);
        expect(useLayout.getState().sessionsWidth).toBe(400);
    });

});
