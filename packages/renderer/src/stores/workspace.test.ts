import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkspace } from './workspace';
import { useEditor } from './editor';
import { useDiagnostics } from './diagnostics';
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

// Mock 后端 config API：workspace.restore 从 default_workspace 初始化（不再读 Electron store）
vi.mock('@/services/api', () => ({
    fetchAppConfig: vi.fn(),
}));

import { fetchAppConfig } from '@/services/api';
const mockFetchConfig = vi.mocked(fetchAppConfig);

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
    mockFetchConfig.mockReset();
    vi.mocked(terminalManager.switchWorkspace).mockReset();
});

describe('workspace store — setRootPath', () => {
    it('sets rootPath', () => {
        useWorkspace.getState().setRootPath('/project-a');
        expect(useWorkspace.getState().rootPath).toBe('/project-a');
    });

    it('does NOT persist rootPath（默认值只来自后端 config，不写 Electron store）', () => {
        useWorkspace.getState().setRootPath('/project-a');
        expect(useWorkspace.getState().rootPath).toBe('/project-a');
        expect(mockStoreSet).not.toHaveBeenCalled();
    });

    it('does NOT run cleanup when setting rootPath for the first time (prev is null)', () => {
        const suspendEditor = vi.spyOn(useEditor.getState(), 'suspendForWorkspace');

        useWorkspace.getState().setRootPath('/project-a');

        expect(suspendEditor).not.toHaveBeenCalled();
        expect(terminalManager.switchWorkspace).not.toHaveBeenCalled();
        suspendEditor.mockRestore();
    });

    it('runs full cleanup when switching from one workspace to another', () => {
        // Set initial workspace
        useWorkspace.setState({ rootPath: '/project-a' });

        // Spy on all cleanup targets
        const suspendEditor = vi.spyOn(useEditor.getState(), 'suspendForWorkspace');
        const closeAllFiles = vi.spyOn(useEditor.getState(), 'closeAllFiles');
        const resumeEditor = vi.spyOn(useEditor.getState(), 'resumeForWorkspace');
        const clearDiagnostics = vi.spyOn(useDiagnostics.getState(), 'clear');
        const clearNotifications = vi.spyOn(useNotification.getState(), 'clearAll');

        useWorkspace.getState().setRootPath('/project-b');

        // 编辑器：挂起旧 → 清空 → 恢复新
        expect(suspendEditor).toHaveBeenCalledWith('/project-a');
        expect(closeAllFiles).toHaveBeenCalled();
        expect(resumeEditor).toHaveBeenCalledWith('/project-b');
        // 终端：通知全局 terminalManager 切换工作区
        expect(terminalManager.switchWorkspace).toHaveBeenCalledWith('/project-b');
        // 诊断、通知清空
        expect(clearDiagnostics).toHaveBeenCalled();
        expect(clearNotifications).toHaveBeenCalled();

        suspendEditor.mockRestore();
        closeAllFiles.mockRestore();
        resumeEditor.mockRestore();
        clearDiagnostics.mockRestore();
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
    it('restores rootPath from backend default_workspace', async () => {
        mockFetchConfig.mockResolvedValue({ default_workspace: '/backend-default' });

        await useWorkspace.getState().restore();

        expect(useWorkspace.getState().rootPath).toBe('/backend-default');
        expect(useWorkspace.getState().restored).toBe(true);
    });

    it('sets restored=true with no rootPath when config has no default_workspace', async () => {
        mockFetchConfig.mockResolvedValue({});

        await useWorkspace.getState().restore();

        expect(useWorkspace.getState().rootPath).toBeNull();
        expect(useWorkspace.getState().restored).toBe(true);
    });

    it('sets restored=true on fetch error', async () => {
        mockFetchConfig.mockRejectedValue(new Error('config fetch error'));

        await useWorkspace.getState().restore();

        expect(useWorkspace.getState().restored).toBe(true);
    });

    it('does not restore twice', async () => {
        mockFetchConfig.mockResolvedValue({ default_workspace: '/backend-default' });

        await useWorkspace.getState().restore();
        mockFetchConfig.mockResolvedValue({ default_workspace: '/other-project' });
        await useWorkspace.getState().restore();

        // Still the first value
        expect(useWorkspace.getState().rootPath).toBe('/backend-default');
        expect(mockFetchConfig).toHaveBeenCalledTimes(1);
    });
});
