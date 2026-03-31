import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSession } from './session';
import { useChat } from './chat';

// Mock the API module
vi.mock('@/services/api', () => ({
    fetchSessions: vi.fn(),
    fetchSessionMessages: vi.fn(),
    fetchUsage: vi.fn(),
    deleteSession: vi.fn(),
}));

// Mock stream-manager — session store delegates to it
vi.mock('@/services/stream-manager', () => ({
    streamManager: {
        getOrCreate: vi.fn(),
        switchTo: vi.fn(),
        newSession: vi.fn(),
        removeSession: vi.fn(),
        getActive: vi.fn(),
        replayInto: vi.fn(),
        clearAll: vi.fn(),
        isSessionStreaming: vi.fn(),
    },
}));

import { streamManager as mockStreamManager } from '@/services/stream-manager';

import { fetchSessions, fetchSessionMessages, fetchUsage, deleteSession as apiDeleteSession } from '@/services/api';

const mockFetchSessions = fetchSessions as ReturnType<typeof vi.fn>;
const mockFetchSessionMessages = fetchSessionMessages as ReturnType<typeof vi.fn>;
const mockFetchUsage = fetchUsage as ReturnType<typeof vi.fn>;
const mockDeleteSession = apiDeleteSession as ReturnType<typeof vi.fn>;

function resetStores() {
    useSession.setState({ sessions: [], loading: false });
    useChat.setState({
        sessionId: null,
        messages: [],
        isStreaming: false,
        streamingMessageId: null,
        model: null,
        contextTokens: 0,
        mode: 'chat',
    });
}

const mocked = mockStreamManager as unknown as {
    getOrCreate: ReturnType<typeof vi.fn>;
    switchTo: ReturnType<typeof vi.fn>;
    newSession: ReturnType<typeof vi.fn>;
    removeSession: ReturnType<typeof vi.fn>;
    getActive: ReturnType<typeof vi.fn>;
    replayInto: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    // Default: getOrCreate returns a fresh session-like object
    mocked.getOrCreate.mockReturnValue({
        messages: [],
        isStreaming: false,
        setContextTokens: vi.fn(),
    });
    mocked.getActive.mockReturnValue(null);
});

describe('session store — loadSessions', () => {
    it('loads sessions from API and sets them', async () => {
        const sessions = [
            { session_id: 's1', title: 'Session 1', created_at: 1000 },
            { session_id: 's2', title: 'Session 2', created_at: 2000 },
        ];
        mockFetchSessions.mockResolvedValue(sessions);

        await useSession.getState().loadSessions();

        expect(useSession.getState().sessions).toEqual(sessions);
        expect(useSession.getState().loading).toBe(false);
    });

    it('sets loading=true during fetch and false after', async () => {
        let resolvePromise: (v: any) => void;
        mockFetchSessions.mockReturnValue(new Promise((r) => { resolvePromise = r; }));

        const promise = useSession.getState().loadSessions();
        expect(useSession.getState().loading).toBe(true);

        resolvePromise!([]);
        await promise;
        expect(useSession.getState().loading).toBe(false);
    });

    it('sets loading=false even on error', async () => {
        mockFetchSessions.mockRejectedValue(new Error('network'));

        await useSession.getState().loadSessions().catch(() => { });

        expect(useSession.getState().loading).toBe(false);
    });

    it('passes workspace parameter to API', async () => {
        mockFetchSessions.mockResolvedValue([]);

        await useSession.getState().loadSessions('/my-project');

        expect(mockFetchSessions).toHaveBeenCalledWith('/my-project');
    });
});

describe('session store — switchSession', () => {
    it('fetches events and replays into manager when session has no messages', async () => {
        const events = [
            { type: 'user_input', data: { content: 'hello' } },
            { type: 'message_complete', data: { content: 'hi there' } },
        ];
        mockFetchSessionMessages.mockResolvedValue(events);
        mockFetchUsage.mockResolvedValue(100);

        await useSession.getState().switchSession('s1');

        expect(mocked.replayInto).toHaveBeenCalledWith('s1', events);
        expect(mocked.switchTo).toHaveBeenCalledWith('s1');
    });

    it('directly switches when session already has messages in memory', async () => {
        mocked.getOrCreate.mockReturnValue({
            messages: [{ id: '1', role: 'user', content: 'hi' }],
            isStreaming: false,
            setContextTokens: vi.fn(),
        });

        await useSession.getState().switchSession('s1');

        expect(mocked.switchTo).toHaveBeenCalledWith('s1');
        expect(mockFetchSessionMessages).not.toHaveBeenCalled();
    });

    it('directly switches when session is currently streaming', async () => {
        mocked.getOrCreate.mockReturnValue({
            messages: [],
            isStreaming: true,
            setContextTokens: vi.fn(),
        });

        await useSession.getState().switchSession('s1');

        expect(mocked.switchTo).toHaveBeenCalledWith('s1');
        expect(mockFetchSessionMessages).not.toHaveBeenCalled();
    });
});

describe('session store — deleteSession', () => {
    it('removes session from list and from manager', async () => {
        useSession.setState({
            sessions: [
                { session_id: 's1', title: 'A', created_at: 1 } as any,
                { session_id: 's2', title: 'B', created_at: 2 } as any,
            ],
        });
        mockDeleteSession.mockResolvedValue(true);
        mocked.getActive.mockReturnValue({ sessionId: 's2' });

        await useSession.getState().deleteSession('s1');

        expect(mocked.removeSession).toHaveBeenCalledWith('s1');
        expect(useSession.getState().sessions).toHaveLength(1);
        expect(useSession.getState().sessions[0].session_id).toBe('s2');
    });

    it('creates new session if deleted the active one', async () => {
        useSession.setState({
            sessions: [{ session_id: 's1', title: 'A', created_at: 1 } as any],
        });
        mockDeleteSession.mockResolvedValue(true);
        mocked.getActive.mockReturnValue(null); // no active after removal

        await useSession.getState().deleteSession('s1');

        expect(mocked.removeSession).toHaveBeenCalledWith('s1');
        expect(mocked.newSession).toHaveBeenCalled();
    });
});

describe('session store — newSession', () => {
    it('delegates to streamManager.newSession', () => {
        useSession.getState().newSession();

        expect(mocked.newSession).toHaveBeenCalled();
    });
});

describe('session store — restoreLatest', () => {
    it('loads sessions and switches to the first one', async () => {
        mockFetchSessions.mockResolvedValue([
            { session_id: 's1', title: 'Latest', created_at: 2000 },
            { session_id: 's2', title: 'Older', created_at: 1000 },
        ]);
        mockFetchSessionMessages.mockResolvedValue([]);
        mockFetchUsage.mockResolvedValue(0);

        await useSession.getState().restoreLatest();

        expect(mocked.switchTo).toHaveBeenCalledWith('s1');
    });

    it('does nothing when no sessions exist', async () => {
        mockFetchSessions.mockResolvedValue([]);

        await useSession.getState().restoreLatest();

        expect(mocked.switchTo).not.toHaveBeenCalled();
    });
});
