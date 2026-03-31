import { create } from 'zustand';

export interface ShortcutBinding {
    id: string;
    keys: string; // e.g. "ctrl+shift+p"
    label: string;
    category?: string;
    context: 'global' | 'editor' | 'panel';
    execute: () => void;
}

export interface ShortcutState {
    bindings: ShortcutBinding[];
    register: (binding: ShortcutBinding) => void;
    unregister: (id: string) => void;
    getByKeys: (keys: string) => ShortcutBinding | undefined;
    getAll: () => ShortcutBinding[];
    executeByKeys: (keys: string, context: string) => boolean;
}

const CONTEXT_PRIORITY: Record<string, number> = {
    editor: 2,
    panel: 1,
    global: 0,
};

export const useShortcut = create<ShortcutState>((set, get) => ({
    bindings: [],

    register: (binding) => {
        set((state) => {
            // Remove any existing binding with the same id (overwrite)
            const filtered = state.bindings.filter((b) => b.id !== binding.id);
            return { bindings: [...filtered, binding] };
        });
    },

    unregister: (id) => {
        set((state) => ({
            bindings: state.bindings.filter((b) => b.id !== id),
        }));
    },

    getByKeys: (keys) => {
        const normalized = keys.toLowerCase();
        return get().bindings.find((b) => b.keys.toLowerCase() === normalized);
    },

    getAll: () => get().bindings,

    executeByKeys: (keys, context) => {
        const normalized = keys.toLowerCase();
        const matches = get().bindings.filter(
            (b) => b.keys.toLowerCase() === normalized,
        );

        if (matches.length === 0) return false;

        // Sort by context priority descending, pick the highest that is <= current context
        const currentPriority = CONTEXT_PRIORITY[context] ?? 0;

        // Filter to bindings whose context priority is <= the current context priority
        // (a binding can fire if its context is at or below the active context level)
        const eligible = matches.filter(
            (b) => (CONTEXT_PRIORITY[b.context] ?? 0) <= currentPriority,
        );

        if (eligible.length === 0) return false;

        // Pick the one with the highest context priority among eligible
        eligible.sort(
            (a, b) =>
                (CONTEXT_PRIORITY[b.context] ?? 0) -
                (CONTEXT_PRIORITY[a.context] ?? 0),
        );

        eligible[0].execute();
        return true;
    },
}));
