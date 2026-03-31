import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkspace } from './workspace';
import { useEditor } from './editor';
import { useSearch } from './search';
import { useLayout } from './layout';
import { useDiagnostics } from './diagnostics';
import { useOutput } from './output';
import { useNotification } from './notification';
import { terminalManager } from '@/services/terminal';

// Mock stream-manager to avoid side effects
vi.mock('@/services/stream-manager', () => ({
    streamManager: {
        switchWorkspace: vi.fn(),
        clearAll: vi.fn(),
        getActive: vi.fn(),
        newSession: vi.fn(),
    },
}));

// Mock terminal module to avoid side effects
vi.mock('@/services/terminal', () => ({
    terminalManager: {
        switchWorkspace: vi.fn(),
        createTerminal: vi.fn(),
        closeTerminal: vi.fn(),
        closeAllTerminals: vi.fn(),
        setActiveTerminal: vi.fn(),
        setActiveWorkspace: vi.fn(),
        disposeAll: vi.fn(),
    },
}));

// Mock window.desktop.store
const mockStoreGet = vi.fn();
const mockStoreSet = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
    // Reset workspace store
    useWorkspace.setState({ rootPath: null, restored: false, recentFolders: [] });
    // Provide window.desktop mock
    (window as any).desktop = {
        store: { get: mockStoreGet, set: mockStoreSet },
    };
    mockStoreGet.mockReset();
    mockStoreSet.mockReset().mockResolvedValue(undefined);
    vi.mocked(terminalManager.switchWorkspace).mockReset();
});

describe('workspace store — setRootPath', () => {
    it('sets rootPath', () => {
        useWorkspace.getState().setRootPath('/project-a');
        expect(useWorkspace.getState().rootPath).toBe('/project-a');
    });

    it('persists path via window.desktop.store.set', () => {
        useWorkspace.getState().setRootPath('/project-a');
        expect(mockStoreSet).toHaveBeenCalledWith('lastWorkspace', '/project-a');
    });

    it('does NOT run cleanup when setting rootPath for the first time (prev is null)', () => {
        const suspendEditor = vi.spyOn(useEditor.getState(), 'suspendForWorkspace');
        const clearResults = vi.spyOn(useSearch.getState(), 'clearResults');

        useWorkspace.getState().setRootPath('/project-a');

        expect(suspendEditor).not.toHaveBeenCalled();
        expect(clearResults).not.toHaveBeenCalled();
        expect(terminalManager.switchWorkspace).not.toHaveBeenCalled();
        suspendEditor.mockRestore();
        clearResults.mockRestore();
    });

    it('runs full cleanup when switching from one workspace to another', () => {
        // Set initial workspace
        useWorkspace.setState({ rootPath: '/project-a' });

        // Spy on all cleanup targets
        const suspendEditor = vi.spyOn(useEditor.getState(), 'suspendForWorkspace');
        const closeAllFiles = vi.spyOn(useEditor.getState(), 'closeAllFiles');
        const resumeEditor = vi.spyOn(useEditor.getState(), 'resumeForWorkspace');
        const clearResults = vi.spyOn(useSearch.getState(), 'clearResults');
        const setActiveSidebarView = vi.spyOn(useLayout.getState(), 'setActiveSidebarView');
        const clearDiagnostics = vi.spyOn(useDiagnostics.getState(), 'clear');
        const clearOutput = vi.spyOn(useOutput.getState(), 'clearAllChannels');
        const clearNotifications = vi.spyOn(useNotification.getState(), 'clearAll');

        useWorkspace.getState().setRootPath('/project-b');

        // 编辑器：挂起旧 → 清空 → 恢复新
        expect(suspendEditor).toHaveBeenCalledWith('/project-a');
        expect(closeAllFiles).toHaveBeenCalled();
        expect(resumeEditor).toHaveBeenCalledWith('/project-b');
        // 搜索清空
        expect(clearResults).toHaveBeenCalled();
        // 终端：通知全局 terminalManager 切换工作区
        expect(terminalManager.switchWorkspace).toHaveBeenCalledWith('/project-b');
        // 侧边栏切到 explorer
        expect(setActiveSidebarView).toHaveBeenCalledWith('explorer');
        // 诊断、输出、通知清空
        expect(clearDiagnostics).toHaveBeenCalled();
        expect(clearOutput).toHaveBeenCalled();
        expect(clearNotifications).toHaveBeenCalled();

        suspendEditor.mockRestore();
        closeAllFiles.mockRestore();
        resumeEditor.mockRestore();
        clearResults.mockRestore();
        setActiveSidebarView.mockRestore();
        clearDiagnostics.mockRestore();
        clearOutput.mockRestore();
        clearNotifications.mockRestore();
    });

    it('does NOT run cleanup when setting the same path again', () => {
        useWorkspace.setState({ rootPath: '/project-a' });
        const suspendEditor = vi.spyOn(useEditor.getState(), 'suspendForWorkspace');

        useWorkspace.getState().setRootPath('/project-a');

        expect(suspendEditor).not.toHaveBeenCalled();
        expect(terminalManager.switchWorkspace).not.toHaveBeenCalled();
        suspendEditor.mockRestore();
    });
});

describe('workspace store — restore', () => {
    it('restores rootPath from persisted storage', async () => {
        mockStoreGet.mockResolvedValue({ value: '/saved-project' });

        await useWorkspace.getState().restore();

        expect(useWorkspace.getState().rootPath).toBe('/saved-project');
        expect(useWorkspace.getState().restored).toBe(true);
    });

    it('sets restored=true even when no saved value', async () => {
        mockStoreGet.mockResolvedValue({ value: null });

        await useWorkspace.getState().restore();

        expect(useWorkspace.getState().rootPath).toBeNull();
        expect(useWorkspace.getState().restored).toBe(true);
    });

    it('sets restored=true on error', async () => {
        mockStoreGet.mockRejectedValue(new Error('storage error'));

        await useWorkspace.getState().restore();

        expect(useWorkspace.getState().restored).toBe(true);
    });

    it('does not restore twice', async () => {
        mockStoreGet.mockResolvedValue({ value: '/saved-project' });

        await useWorkspace.getState().restore();
        mockStoreGet.mockResolvedValue({ value: '/other-project' });
        await useWorkspace.getState().restore();

        // Still the first value
        expect(useWorkspace.getState().rootPath).toBe('/saved-project');
        expect(mockStoreGet).toHaveBeenCalledTimes(1);
    });
});
