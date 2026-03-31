import { create } from 'zustand';

export interface OutputChannel {
    name: string;
    lines: string[];
}

export interface OutputState {
    channels: OutputChannel[];
    activeChannel: string;
    addLine: (channel: string, line: string) => void;
    setActiveChannel: (name: string) => void;
    clearChannel: (name: string) => void;
    /** 清空所有频道内容 */
    clearAllChannels: () => void;
}

const PRESET_CHANNELS: string[] = ['Ftre', 'AI Agent', 'MCP'];

export const useOutput = create<OutputState>((set, get) => ({
    channels: PRESET_CHANNELS.map((name) => ({ name, lines: [] })),
    activeChannel: PRESET_CHANNELS[0],

    addLine: (channel, line) =>
        set((state) => ({
            channels: state.channels.map((ch) =>
                ch.name === channel ? { ...ch, lines: [...ch.lines, line] } : ch,
            ),
        })),

    setActiveChannel: (name) => {
        const exists = get().channels.some((ch) => ch.name === name);
        if (exists) set({ activeChannel: name });
    },

    clearChannel: (name) =>
        set((state) => ({
            channels: state.channels.map((ch) =>
                ch.name === name ? { ...ch, lines: [] } : ch,
            ),
        })),

    clearAllChannels: () =>
        set((state) => ({
            channels: state.channels.map((ch) => ({ ...ch, lines: [] })),
        })),
}));
