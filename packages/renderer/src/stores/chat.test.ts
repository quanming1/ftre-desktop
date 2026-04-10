import { describe, it, expect, beforeEach } from 'vitest';
import { useChat } from './chat';
import type { ChatMessage, ToolCallMessage } from '@/types/chat';

function resetStore() {
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

beforeEach(() => {
    resetStore();
});

describe('chat store — message add/remove', () => {
    it('addUserMessage appends a user message', () => {
        useChat.getState().addUserMessage('hello');
        const msgs = useChat.getState().messages;
        expect(msgs).toHaveLength(1);
        expect(msgs[0].role).toBe('user');
        expect((msgs[0] as ChatMessage).content).toBe('hello');
    });

    it('addUserMessage preserves codeRefs', () => {
        const ref = { filePath: '/a.ts', fileName: 'a.ts', startLine: 1, endLine: 5, content: 'code' };
        useChat.getState().addUserMessage('check this', [ref]);
        const msg = useChat.getState().messages[0] as ChatMessage;
        expect(msg.codeRefs).toHaveLength(1);
        expect(msg.codeRefs![0].filePath).toBe('/a.ts');
    });

    it('addSystemMessage appends a system message', () => {
        useChat.getState().addSystemMessage('system info');
        const msgs = useChat.getState().messages;
        expect(msgs).toHaveLength(1);
        expect(msgs[0].role).toBe('system');
        expect((msgs[0] as ChatMessage).content).toBe('system info');
    });

    it('addToolCall appends a tool call message', () => {
        const id = useChat.getState().addToolCall('tool-1', 'readFile', { path: '/a.ts' });
        const msgs = useChat.getState().messages;
        expect(msgs).toHaveLength(1);
        const msg = msgs[0] as ToolCallMessage;
        expect(msg.role).toBe('tool');
        expect(msg.toolId).toBe('tool-1');
        expect(msg.name).toBe('readFile');
        expect(msg.status).toBe('running');
        expect(typeof id).toBe('string');
    });

    it('updateToolResult updates a tool call message', () => {
        useChat.getState().addToolCall('tool-1', 'readFile', {});
        useChat.getState().updateToolResult('tool-1', 'file content', 'completed');
        const msg = useChat.getState().messages[0] as ToolCallMessage;
        expect(msg.result).toBe('file content');
        expect(msg.status).toBe('completed');
    });

    it('updateToolResult defaults status to completed', () => {
        useChat.getState().addToolCall('tool-1', 'readFile', {});
        useChat.getState().updateToolResult('tool-1', 'ok');
        expect((useChat.getState().messages[0] as ToolCallMessage).status).toBe('completed');
    });
});

describe('chat store — streaming message', () => {
    it('startAssistantMessage creates a streaming assistant message', () => {
        const id = useChat.getState().startAssistantMessage();
        const msgs = useChat.getState().messages;
        expect(msgs).toHaveLength(1);
        const msg = msgs[0] as ChatMessage;
        expect(msg.role).toBe('assistant');
        expect(msg.content).toBe('');
        expect(msg.streaming).toBe(true);
        expect(msg.id).toBe(id);
    });

    it('appendAssistantContent appends to the streaming message', () => {
        const id = useChat.getState().startAssistantMessage();
        useChat.getState().appendAssistantContent(id, 'Hello');
        useChat.getState().appendAssistantContent(id, ' world');
        const msg = useChat.getState().messages[0] as ChatMessage;
        expect(msg.content).toBe('Hello world');
    });

    it('finalizeAssistantMessage sets streaming to false', () => {
        const id = useChat.getState().startAssistantMessage();
        useChat.getState().appendAssistantContent(id, 'done');
        useChat.getState().finalizeAssistantMessage(id);
        const msg = useChat.getState().messages[0] as ChatMessage;
        expect(msg.streaming).toBe(false);
        expect(msg.content).toBe('done');
    });

    it('appendAssistantContent does not affect other messages', () => {
        useChat.getState().addUserMessage('hi');
        const id = useChat.getState().startAssistantMessage();
        useChat.getState().appendAssistantContent(id, 'response');
        expect((useChat.getState().messages[0] as ChatMessage).content).toBe('hi');
        expect((useChat.getState().messages[1] as ChatMessage).content).toBe('response');
    });
});

describe('chat store — clearMessages', () => {
    it('resets messages, sessionId, and contextTokens', () => {
        useChat.getState().setSessionId('sess-1');
        useChat.getState().addUserMessage('hello');
        useChat.getState().setContextTokens(500);

        useChat.getState().clearMessages();

        const s = useChat.getState();
        expect(s.messages).toHaveLength(0);
        expect(s.sessionId).toBeNull();
        expect(s.contextTokens).toBe(0);
    });
});

describe('chat store — mode switching', () => {
    it('defaults to chat mode', () => {
        expect(useChat.getState().mode).toBe('chat');
    });

    it('setMode switches to plan', () => {
        useChat.getState().setMode('plan');
        expect(useChat.getState().mode).toBe('plan');
    });

    it('setMode switches back to chat', () => {
        useChat.getState().setMode('plan');
        useChat.getState().setMode('chat');
        expect(useChat.getState().mode).toBe('chat');
    });
});

describe('chat store — streaming flag', () => {
    it('setStreaming toggles isStreaming', () => {
        useChat.getState().setStreaming(true);
        expect(useChat.getState().isStreaming).toBe(true);
        useChat.getState().setStreaming(false);
        expect(useChat.getState().isStreaming).toBe(false);
    });
});

describe('chat store — selector helpers', () => {
    it('getMessageById returns message by id', () => {
        useChat.getState().addUserMessage('hello');
        const id = useChat.getState().messages[0].id;
        const msg = useChat.getState().getMessageById(id);
        expect(msg).toBeDefined();
        expect(msg?.id).toBe(id);
    });

    it('getMessageById returns undefined for non-existent id', () => {
        const msg = useChat.getState().getMessageById('non-existent');
        expect(msg).toBeUndefined();
    });

    it('getMessageIds returns array of message ids', () => {
        useChat.getState().addUserMessage('first');
        useChat.getState().addUserMessage('second');
        const ids = useChat.getState().getMessageIds();
        expect(ids).toHaveLength(2);
        expect(ids[0]).toBe(useChat.getState().messages[0].id);
        expect(ids[1]).toBe(useChat.getState().messages[1].id);
    });
});

describe('chat store — streamingMessageId', () => {
    it('startAssistantMessage sets streamingMessageId', () => {
        const id = useChat.getState().startAssistantMessage();
        expect(useChat.getState().streamingMessageId).toBe(id);
    });

    it('finalizeAssistantMessage clears streamingMessageId', () => {
        const id = useChat.getState().startAssistantMessage();
        useChat.getState().finalizeAssistantMessage(id);
        expect(useChat.getState().streamingMessageId).toBeNull();
    });
});

describe('chat store — syncFrom', () => {
    it('syncFrom replaces all synced fields at once', () => {
        // Pre-populate some state
        useChat.getState().addUserMessage('old message');
        useChat.getState().setStreaming(true);

        const messages: import('@/types/chat').AnyMessage[] = [
            { id: 'ext-1', role: 'user', content: 'hello from session' },
            { id: 'ext-2', role: 'assistant', content: 'hi', streaming: false },
        ];

        useChat.getState().syncFrom({
            sessionId: 'sess-abc',
            messages,
            isStreaming: false,
            streamingMessageId: null,
            contextTokens: 999,
            retryState: null,
        });

        const s = useChat.getState();
        expect(s.sessionId).toBe('sess-abc');
        expect(s.messages).toBe(messages); // same reference
        expect(s.messages).toHaveLength(2);
        expect(s.isStreaming).toBe(false);
        expect(s.streamingMessageId).toBeNull();
        expect(s.contextTokens).toBe(999);
    });

    it('syncFrom does not affect model or mode', () => {
        useChat.getState().setModel('gpt-4');
        useChat.getState().setMode('plan');

        useChat.getState().syncFrom({
            sessionId: 'sess-1',
            messages: [],
            isStreaming: false,
            streamingMessageId: null,
            contextTokens: 0,
            retryState: null,
        });

        expect(useChat.getState().model).toBe('gpt-4');
        expect(useChat.getState().mode).toBe('plan');
    });
});
