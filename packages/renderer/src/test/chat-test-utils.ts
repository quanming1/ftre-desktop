import * as fc from 'fast-check';
import type { AnyMessage, ChatMessage, ToolCallMessage, ActionButtonMessage } from '@/types/chat';

/**
 * 生成 ChatMessage 的 arbitrary
 */
export const chatMessageArbitrary = (): fc.Arbitrary<ChatMessage> =>
    fc.record({
        id: fc.uuid(),
        role: fc.constantFrom('user' as const, 'assistant' as const, 'system' as const),
        content: fc.string(),
        streaming: fc.option(fc.boolean(), { nil: undefined }),
    });

/**
 * 生成 ToolCallMessage 的 arbitrary
 */
export const toolCallMessageArbitrary = (): fc.Arbitrary<ToolCallMessage> =>
    fc.record({
        id: fc.uuid(),
        role: fc.constant('tool' as const),
        toolId: fc.uuid(),
        name: fc.constantFrom('read', 'write', 'edit', 'bash', 'think'),
        arguments: fc.constant({}),
        result: fc.option(fc.string(), { nil: undefined }),
        status: fc.constantFrom('running' as const, 'completed' as const, 'error' as const, 'cancelled' as const),
    });

/**
 * 生成 ActionButtonMessage 的 arbitrary
 */
export const actionButtonMessageArbitrary = (): fc.Arbitrary<ActionButtonMessage> =>
    fc.record({
        id: fc.uuid(),
        role: fc.constant('action_button' as const),
        label: fc.string({ minLength: 1 }),
        step: fc.string(),
        summary: fc.string(),
    });

/**
 * 生成任意类型消息的 arbitrary
 */
export const messageArbitrary = (): fc.Arbitrary<AnyMessage> =>
    fc.oneof(
        chatMessageArbitrary(),
        toolCallMessageArbitrary(),
        actionButtonMessageArbitrary()
    );
