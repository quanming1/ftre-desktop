import { describe, it, expect, beforeEach } from 'vitest';
import { useOutput } from './output';

describe('output store', () => {
    beforeEach(() => {
        // Reset to initial state
        useOutput.setState({
            channels: [
                { name: 'Ftre', lines: [] },
                { name: 'AI Agent', lines: [] },
                { name: 'MCP', lines: [] },
            ],
            activeChannel: 'Ftre',
        });
    });

    it('initializes with 3 preset channels', () => {
        const { channels } = useOutput.getState();
        expect(channels).toHaveLength(3);
        expect(channels.map((c) => c.name)).toEqual(['Ftre', 'AI Agent', 'MCP']);
        channels.forEach((ch) => expect(ch.lines).toEqual([]));
    });

    it('defaults activeChannel to Ftre', () => {
        expect(useOutput.getState().activeChannel).toBe('Ftre');
    });

    it('addLine appends to the correct channel', () => {
        useOutput.getState().addLine('Ftre', 'hello');
        useOutput.getState().addLine('Ftre', 'world');
        useOutput.getState().addLine('MCP', 'mcp log');

        const { channels } = useOutput.getState();
        expect(channels.find((c) => c.name === 'Ftre')!.lines).toEqual(['hello', 'world']);
        expect(channels.find((c) => c.name === 'MCP')!.lines).toEqual(['mcp log']);
        expect(channels.find((c) => c.name === 'AI Agent')!.lines).toEqual([]);
    });

    it('addLine does nothing for unknown channel', () => {
        useOutput.getState().addLine('Unknown', 'test');
        const { channels } = useOutput.getState();
        expect(channels.every((ch) => ch.lines.length === 0)).toBe(true);
    });

    it('setActiveChannel switches channel', () => {
        useOutput.getState().setActiveChannel('MCP');
        expect(useOutput.getState().activeChannel).toBe('MCP');
    });

    it('setActiveChannel ignores unknown channel', () => {
        useOutput.getState().setActiveChannel('NonExistent');
        expect(useOutput.getState().activeChannel).toBe('Ftre');
    });

    it('clearChannel empties lines for the given channel', () => {
        useOutput.getState().addLine('Ftre', 'line1');
        useOutput.getState().addLine('Ftre', 'line2');
        useOutput.getState().addLine('MCP', 'mcp line');

        useOutput.getState().clearChannel('Ftre');

        const { channels } = useOutput.getState();
        expect(channels.find((c) => c.name === 'Ftre')!.lines).toEqual([]);
        expect(channels.find((c) => c.name === 'MCP')!.lines).toEqual(['mcp line']);
    });

    it('clearChannel does nothing for unknown channel', () => {
        useOutput.getState().addLine('Ftre', 'line1');
        useOutput.getState().clearChannel('Unknown');
        expect(useOutput.getState().channels.find((c) => c.name === 'Ftre')!.lines).toEqual(['line1']);
    });
});
