import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolCallMessage } from '@/types/chat';
import { useEditor, buildDiffId } from '@/stores/editor';
import { useNotification } from '@/stores/notification';

// ── Mocks ────────────────────────────────────────────────────────────

// Mock pathUtils
vi.mock('@/utils/pathUtils', () => ({
    resolveFilePath: (p: string) => (p.startsWith('/') ? p : `/workspace/${p}`),
    basename: (p: string) => p.split('/').pop() ?? p,
}));

// Mock workspace store (needed by resolveFilePath's real impl, but we mock pathUtils directly)
vi.mock('@/stores/workspace', () => ({
    useWorkspace: { getState: () => ({ rootPath: '/workspace' }) },
}));

// Provide window.desktop.fs mock
const mockReadFile = vi.fn();
Object.defineProperty(globalThis, 'window', {
    value: {
        desktop: {
            fs: {
                readFile: mockReadFile,
            },
        },
    },
    writable: true,
});

// Now import the module under test (after mocks are set up)
import { handleOpenFile, handleShowDiff, activateExistingDiff } from './toolActions';

/** Helper to build a minimal ToolCallMessage */
function makeEditMsg(
    overrides: Partial<ToolCallMessage> & { arguments?: Record<string, unknown> } = {},
): ToolCallMessage {
    return {
        id: 'msg-1',
        role: 'tool',
        toolId: 'tool-1',
        name: 'edit',
        arguments: {
            filePath: 'src/app.ts',
            oldString: 'hello',
            newString: 'world',
            ...overrides.arguments,
        },
        status: 'completed',
        ...overrides,
    };
}

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    // Reset editor store
    useEditor.setState({
        pendingDiffs: [],
        groups: [{ id: 'default', openFiles: [], activeFile: null }],
        activeGroupId: 'default',
        openFiles: [],
        activeFile: null,
    });
    // Reset notification store
    useNotification.setState({ notifications: [] });
});


// ─── handleOpenFile ─────────────────────────────────────────────────

describe('handleOpenFile', () => {
    it('opens file in editor on success', async () => {
        mockReadFile.mockResolvedValue({
            content: 'file content',
            language: 'typescript',
            error: null,
        });

        await handleOpenFile('src/app.ts');

        const state = useEditor.getState();
        expect(state.openFiles).toHaveLength(1);
        expect(state.openFiles[0].path).toBe('/workspace/src/app.ts');
        expect(state.openFiles[0].name).toBe('app.ts');
        expect(state.openFiles[0].language).toBe('typescript');
        expect(state.openFiles[0].content).toBe('file content');
    });

    it('shows error notification when file read fails', async () => {
        mockReadFile.mockResolvedValue({ error: 'not found', content: '', language: '' });

        await handleOpenFile('missing.ts');

        const notifs = useNotification.getState().notifications;
        expect(notifs).toHaveLength(1);
        expect(notifs[0].level).toBe('error');
        expect(notifs[0].message).toContain('missing.ts');
    });

    it('shows error notification when IPC throws', async () => {
        mockReadFile.mockRejectedValue(new Error('IPC crash'));

        await handleOpenFile('crash.ts');

        const notifs = useNotification.getState().notifications;
        expect(notifs).toHaveLength(1);
        expect(notifs[0].level).toBe('error');
        expect(notifs[0].message).toContain('crash.ts');
    });

    it('resolves relative path to absolute', async () => {
        mockReadFile.mockResolvedValue({ content: '', language: 'plaintext', error: null });

        await handleOpenFile('relative/file.ts');

        expect(mockReadFile).toHaveBeenCalledWith('/workspace/relative/file.ts');
    });

    it('keeps absolute path as-is', async () => {
        mockReadFile.mockResolvedValue({ content: '', language: 'plaintext', error: null });

        await handleOpenFile('/absolute/file.ts');

        expect(mockReadFile).toHaveBeenCalledWith('/absolute/file.ts');
    });
});

// ─── handleShowDiff ─────────────────────────────────────────────────

describe('handleShowDiff', () => {
    it('returns early when filePath is missing', async () => {
        const msg = makeEditMsg({ arguments: { oldString: 'a', newString: 'b' } });
        await handleShowDiff(msg);

        expect(mockReadFile).not.toHaveBeenCalled();
        expect(useEditor.getState().pendingDiffs).toHaveLength(0);
    });

    it('returns early when oldString is missing', async () => {
        const msg = makeEditMsg({ arguments: { filePath: 'f.ts', newString: 'b' } });
        await handleShowDiff(msg);

        expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('returns early when newString is missing', async () => {
        const msg = makeEditMsg({ arguments: { filePath: 'f.ts', oldString: 'a' } });
        await handleShowDiff(msg);

        expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('activates existing DiffEntry instead of creating new one', async () => {
        const msg = makeEditMsg();
        const fullPath = '/workspace/src/app.ts';
        const diffId = buildDiffId('tool-1', fullPath);

        // Pre-populate a DiffEntry
        const tabPath = `diff:${fullPath}`;
        useEditor.getState().openFile({
            path: tabPath,
            name: 'app.ts (Diff)',
            language: '',
            content: 'modified',
        });
        useEditor.getState().addDiff({
            id: diffId,
            filePath: fullPath,
            tabPath,
            originalContent: 'original',
            newContent: 'modified',
            toolName: 'edit',
            isApproximate: false,
        });

        await handleShowDiff(msg);

        // Should NOT have called readFile (reused existing diff)
        expect(mockReadFile).not.toHaveBeenCalled();
        // Should have activated the diff tab
        expect(useEditor.getState().activeFile).toBe(tabPath);
    });

    it('constructs diff when oldString found in current content (file not yet modified)', async () => {
        mockReadFile.mockResolvedValue({
            content: 'say hello to the world',
            language: 'plaintext',
            error: null,
        });

        const msg = makeEditMsg();
        await handleShowDiff(msg);

        const diffs = useEditor.getState().pendingDiffs;
        expect(diffs).toHaveLength(1);
        expect(diffs[0].originalContent).toBe('say hello to the world');
        expect(diffs[0].newContent).toBe('say world to the world');
        expect(diffs[0].isApproximate).toBe(true);
    });

    it('constructs diff when newString found in current content (file already modified)', async () => {
        mockReadFile.mockResolvedValue({
            content: 'say world to the world',
            language: 'plaintext',
            error: null,
        });

        // oldString='hello' is NOT in content, but newString='world' IS
        const msg = makeEditMsg();
        await handleShowDiff(msg);

        const diffs = useEditor.getState().pendingDiffs;
        expect(diffs).toHaveLength(1);
        // Reverse: replace first 'world' back to 'hello'
        expect(diffs[0].originalContent).toBe('say hello to the world');
        expect(diffs[0].newContent).toBe('say world to the world');
    });

    it('shows error when neither oldString nor newString found', async () => {
        mockReadFile.mockResolvedValue({
            content: 'completely different content',
            language: 'plaintext',
            error: null,
        });

        const msg = makeEditMsg();
        await handleShowDiff(msg);

        expect(useEditor.getState().pendingDiffs).toHaveLength(0);
        const notifs = useNotification.getState().notifications;
        expect(notifs).toHaveLength(1);
        expect(notifs[0].message).toContain('无法构造差异视图');
    });

    it('shows error notification when file read fails', async () => {
        mockReadFile.mockResolvedValue({ error: 'not found', content: '', language: '' });

        const msg = makeEditMsg();
        await handleShowDiff(msg);

        const notifs = useNotification.getState().notifications;
        expect(notifs).toHaveLength(1);
        expect(notifs[0].level).toBe('error');
        expect(notifs[0].message).toContain('src/app.ts');
    });

    it('catches IPC exceptions and shows error notification', async () => {
        mockReadFile.mockRejectedValue(new Error('IPC crash'));

        const msg = makeEditMsg();
        await handleShowDiff(msg);

        const notifs = useNotification.getState().notifications;
        expect(notifs).toHaveLength(1);
        expect(notifs[0].level).toBe('error');
    });

    it('uses replaceAll=true to replace all occurrences', async () => {
        mockReadFile.mockResolvedValue({
            content: 'aaa',
            language: 'plaintext',
            error: null,
        });

        const msg = makeEditMsg({
            arguments: {
                filePath: 'src/app.ts',
                oldString: 'a',
                newString: 'b',
                replaceAll: true,
            },
        });
        await handleShowDiff(msg);

        const diffs = useEditor.getState().pendingDiffs;
        expect(diffs[0].newContent).toBe('bbb');
    });

    it('uses replaceAll=false to replace only first occurrence', async () => {
        mockReadFile.mockResolvedValue({
            content: 'aaa',
            language: 'plaintext',
            error: null,
        });

        const msg = makeEditMsg({
            arguments: {
                filePath: 'src/app.ts',
                oldString: 'a',
                newString: 'b',
                replaceAll: false,
            },
        });
        await handleShowDiff(msg);

        const diffs = useEditor.getState().pendingDiffs;
        expect(diffs[0].newContent).toBe('baa');
    });

    it('marks fallback-constructed diff as isApproximate=true', async () => {
        mockReadFile.mockResolvedValue({
            content: 'hello world',
            language: 'plaintext',
            error: null,
        });

        const msg = makeEditMsg();
        await handleShowDiff(msg);

        expect(useEditor.getState().pendingDiffs[0].isApproximate).toBe(true);
    });

    it('generates correct diffId from toolId and resolved path', async () => {
        mockReadFile.mockResolvedValue({
            content: 'hello world',
            language: 'plaintext',
            error: null,
        });

        const msg = makeEditMsg();
        await handleShowDiff(msg);

        const diffs = useEditor.getState().pendingDiffs;
        expect(diffs[0].id).toBe('tool-1:/workspace/src/app.ts');
    });
});

// ─── activateExistingDiff ───────────────────────────────────────────

describe('activateExistingDiff', () => {
    it('opens file and sets active for existing diff', () => {
        const diffId = 'tool-1:/workspace/src/app.ts';
        const tabPath = 'diff:/workspace/src/app.ts';
        useEditor.getState().addDiff({
            id: diffId,
            filePath: '/workspace/src/app.ts',
            tabPath,
            originalContent: 'old',
            newContent: 'new',
            toolName: 'edit',
            isApproximate: false,
        });

        activateExistingDiff(diffId);

        const state = useEditor.getState();
        expect(state.activeFile).toBe(tabPath);
        expect(state.openFiles).toHaveLength(1);
        expect(state.openFiles[0].content).toBe('new');
    });

    it('does nothing when diffId not found', () => {
        activateExistingDiff('nonexistent-id');

        const state = useEditor.getState();
        expect(state.openFiles).toHaveLength(0);
        expect(state.activeFile).toBeNull();
    });
});
