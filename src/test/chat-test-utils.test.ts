import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    chatMessageArbitrary,
    toolCallMessageArbitrary,
    actionButtonMessageArbitrary,
    messageArbitrary,
} from './chat-test-utils';

describe('chat message arbitraries', () => {
    it('chatMessageArbitrary generates valid ChatMessage objects', () => {
        fc.assert(
            fc.property(chatMessageArbitrary(), (msg) => {
                expect(msg.id).toBeDefined();
                expect(['user', 'assistant', 'system']).toContain(msg.role);
                expect(typeof msg.content).toBe('string');
            }),
            { numRuns: 100 }
        );
    });

    it('toolCallMessageArbitrary generates valid ToolCallMessage objects', () => {
        fc.assert(
            fc.property(toolCallMessageArbitrary(), (msg) => {
                expect(msg.role).toBe('tool');
                expect(msg.toolId).toBeDefined();
                expect(['read', 'write', 'edit', 'bash', 'think']).toContain(msg.name);
                expect(['running', 'completed', 'error', 'cancelled']).toContain(msg.status);
            }),
            { numRuns: 100 }
        );
    });

    it('actionButtonMessageArbitrary generates valid ActionButtonMessage objects', () => {
        fc.assert(
            fc.property(actionButtonMessageArbitrary(), (msg) => {
                expect(msg.role).toBe('action_button');
                expect(msg.label.length).toBeGreaterThan(0);
            }),
            { numRuns: 100 }
        );
    });

    it('messageArbitrary generates one of the three message types', () => {
        fc.assert(
            fc.property(messageArbitrary(), (msg) => {
                expect(msg.id).toBeDefined();
                const validRoles = ['user', 'assistant', 'system', 'tool', 'action_button'];
                expect(validRoles).toContain(msg.role);
            }),
            { numRuns: 100 }
        );
    });
});
