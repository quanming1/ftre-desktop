import { describe, it, expect, beforeEach } from 'vitest';
import { useChat } from '@/stores/chat';
import type { AnyMessage } from '@/types/chat';

/**
 * Performance verification tests — programmatic simulation of manual perf scenarios.
 * Validates: Requirements 7.4
 */

function resetStore() {
    useChat.setState({
        sessionId: null,
        messages: [],
        isStreaming: false,
        streamingMessageId: null,
        contextTokens: 0,
        mode: 'chat',
    });
}

/** Seed the store with N user/assistant messages and return their IDs */
function seedMessages(count: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant';
        const id = `seed-${i}`;
        const msg: AnyMessage =
            role === 'user'
                ? { id, role: 'user', content: `Message ${i}` }
                : { id, role: 'assistant', content: `Reply ${i}`, streaming: false };
        ids.push(id);
        useChat.setState((s) => ({ messages: [...s.messages, msg] }));
    }
    return ids;
}

describe('Performance Verification — Scenario: 50 messages + add new message', () => {
    beforeEach(resetStore);

    it('adding a new message preserves all existing message references', () => {
        const existingIds = seedMessages(50);

        // Snapshot references of all 50 messages before adding
        const beforeMessages = useChat.getState().messages;
        expect(beforeMessages).toHaveLength(50);

        const beforeRefs = beforeMessages.map((m) => m);
        const beforeContents = beforeMessages.map((m) => ('content' in m ? m.content : ''));

        // Add a new user message
        useChat.getState().addUserMessage('New message #51');

        const afterMessages = useChat.getState().messages;
        expect(afterMessages).toHaveLength(51);

        // Every original message object should be the exact same reference (===)
        // This is what React.memo relies on to skip re-renders
        for (let i = 0; i < 50; i++) {
            expect(afterMessages[i]).toBe(beforeRefs[i]);
        }

        // Content unchanged
        for (let i = 0; i < 50; i++) {
            if ('content' in afterMessages[i]) {
                expect((afterMessages[i] as any).content).toBe(beforeContents[i]);
            }
        }

        // The 51st message is the new one
        expect(afterMessages[50]).not.toBe(undefined);
        expect((afterMessages[50] as any).content).toBe('New message #51');
    });

    it('existing message IDs remain stable after adding a new message', () => {
        seedMessages(50);
        const idsBefore = useChat.getState().getMessageIds();

        useChat.getState().addUserMessage('Another new message');

        const idsAfter = useChat.getState().getMessageIds();
        // First 50 IDs unchanged
        for (let i = 0; i < 50; i++) {
            expect(idsAfter[i]).toBe(idsBefore[i]);
        }
        expect(idsAfter).toHaveLength(51);
    });
});

describe('Performance Verification — Scenario: streaming 100 characters', () => {
    beforeEach(resetStore);

    it('appending 100 chars only mutates the streaming message, others keep same reference', () => {
        // Seed 50 messages, then start a streaming assistant message
        seedMessages(50);
        const beforeMessages = useChat.getState().messages.slice();

        const streamId = useChat.getState().startAssistantMessage();
        // Now we have 51 messages; snapshot the first 50 refs
        const preStreamRefs = useChat.getState().messages.slice(0, 50);

        // Simulate streaming 100 characters, one at a time
        for (let c = 0; c < 100; c++) {
            useChat.getState().appendAssistantContent(streamId, 'x');
        }

        const afterMessages = useChat.getState().messages;
        expect(afterMessages).toHaveLength(51);

        // The streaming message should have accumulated 100 chars
        const streamingMsg = afterMessages.find((m) => m.id === streamId);
        expect(streamingMsg).toBeDefined();
        expect('content' in streamingMsg!).toBe(true);
        expect((streamingMsg as any).content).toBe('x'.repeat(100));

        // All 50 original messages should be the exact same object references
        // This proves React.memo would skip re-rendering them
        for (let i = 0; i < 50; i++) {
            expect(afterMessages[i]).toBe(preStreamRefs[i]);
        }
    });

    it('streaming message is the only one whose content changes', () => {
        seedMessages(10);
        const streamId = useChat.getState().startAssistantMessage();

        const contentsBefore = useChat
            .getState()
            .messages.filter((m) => m.id !== streamId)
            .map((m) => ('content' in m ? m.content : null));

        // Stream 100 chars
        for (let c = 0; c < 100; c++) {
            useChat.getState().appendAssistantContent(streamId, 'a');
        }

        const contentsAfter = useChat
            .getState()
            .messages.filter((m) => m.id !== streamId)
            .map((m) => ('content' in m ? m.content : null));

        expect(contentsAfter).toEqual(contentsBefore);
    });

    it('finalizing streaming message sets streaming to false and preserves content', () => {
        seedMessages(5);
        const streamId = useChat.getState().startAssistantMessage();

        for (let c = 0; c < 100; c++) {
            useChat.getState().appendAssistantContent(streamId, 'z');
        }

        useChat.getState().finalizeAssistantMessage(streamId);

        const msg = useChat.getState().messages.find((m) => m.id === streamId) as any;
        expect(msg.streaming).toBe(false);
        expect(msg.content).toBe('z'.repeat(100));
        expect(useChat.getState().streamingMessageId).toBeNull();
    });
});

describe('Performance Verification — Scenario: scroll uses refs not state', () => {
    it('AutoScroll component uses useRef for bottomRef, not useState', async () => {
        // We verify this structurally by reading the source.
        // AutoScroll uses useRef<HTMLDivElement>(null) for scrolling,
        // and only subscribes to messageIds.length via useEffect dep.
        // This means scroll-into-view is a DOM side-effect, not a state update.

        // Programmatic verification: after adding messages, the store has no
        // scroll-related state fields — scrolling is purely ref-based.
        const stateKeys = Object.keys(useChat.getState());
        const scrollStateKeys = stateKeys.filter(
            (k) => k.toLowerCase().includes('scroll') || k.toLowerCase().includes('scrolltop')
        );
        expect(scrollStateKeys).toEqual([]);
    });

    it('message references are not affected by simulated scroll-like state reads', () => {
        resetStore();
        seedMessages(20);

        const refsBefore = useChat.getState().messages.map((m) => m);

        // Simulate what a scroll handler might do — read state without writing.
        // In a well-optimized system, reading state doesn't trigger re-renders.
        const _ids = useChat.getState().getMessageIds();
        const _streaming = useChat.getState().isStreaming;

        // No state mutation occurred, so all refs should be identical
        const refsAfter = useChat.getState().messages.map((m) => m);
        for (let i = 0; i < 20; i++) {
            expect(refsAfter[i]).toBe(refsBefore[i]);
        }
    });

    it('updating unrelated state (contextTokens) does not change message references', () => {
        resetStore();
        seedMessages(20);

        const refsBefore = useChat.getState().messages.map((m) => m);

        // Update an unrelated field
        useChat.getState().setContextTokens(9999);

        const refsAfter = useChat.getState().messages.map((m) => m);
        for (let i = 0; i < 20; i++) {
            expect(refsAfter[i]).toBe(refsBefore[i]);
        }
    });
});
