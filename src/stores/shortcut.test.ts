import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useShortcut, type ShortcutBinding } from './shortcut';

function makeBinding(
    overrides: Partial<ShortcutBinding> = {},
): ShortcutBinding {
    return {
        id: 'test-cmd',
        keys: 'ctrl+shift+p',
        label: 'Test Command',
        context: 'global',
        execute: vi.fn(),
        ...overrides,
    };
}

beforeEach(() => {
    useShortcut.setState({ bindings: [] });
});

describe('shortcut store — register', () => {
    it('adds a binding to the registry', () => {
        const binding = makeBinding();
        useShortcut.getState().register(binding);
        expect(useShortcut.getState().bindings).toHaveLength(1);
        expect(useShortcut.getState().bindings[0].id).toBe('test-cmd');
    });

    it('overwrites an existing binding with the same id', () => {
        const first = makeBinding({ label: 'First' });
        const second = makeBinding({ label: 'Second' });
        const { register } = useShortcut.getState();
        register(first);
        register(second);
        const bindings = useShortcut.getState().bindings;
        expect(bindings).toHaveLength(1);
        expect(bindings[0].label).toBe('Second');
    });

    it('allows multiple bindings with different ids', () => {
        useShortcut.getState().register(makeBinding({ id: 'a' }));
        useShortcut.getState().register(makeBinding({ id: 'b' }));
        expect(useShortcut.getState().bindings).toHaveLength(2);
    });
});

describe('shortcut store — unregister', () => {
    it('removes a binding by id', () => {
        useShortcut.getState().register(makeBinding({ id: 'a' }));
        useShortcut.getState().register(makeBinding({ id: 'b' }));
        useShortcut.getState().unregister('a');
        const bindings = useShortcut.getState().bindings;
        expect(bindings).toHaveLength(1);
        expect(bindings[0].id).toBe('b');
    });

    it('does nothing when id does not exist', () => {
        useShortcut.getState().register(makeBinding({ id: 'a' }));
        useShortcut.getState().unregister('nonexistent');
        expect(useShortcut.getState().bindings).toHaveLength(1);
    });
});

describe('shortcut store — getByKeys', () => {
    it('returns the binding matching the keys', () => {
        const binding = makeBinding({ keys: 'ctrl+b' });
        useShortcut.getState().register(binding);
        const result = useShortcut.getState().getByKeys('ctrl+b');
        expect(result).toBeDefined();
        expect(result!.id).toBe('test-cmd');
    });

    it('matches keys case-insensitively', () => {
        useShortcut.getState().register(makeBinding({ keys: 'Ctrl+Shift+P' }));
        const result = useShortcut.getState().getByKeys('ctrl+shift+p');
        expect(result).toBeDefined();
    });

    it('returns undefined when no binding matches', () => {
        const result = useShortcut.getState().getByKeys('ctrl+z');
        expect(result).toBeUndefined();
    });
});

describe('shortcut store — getAll', () => {
    it('returns all registered bindings', () => {
        useShortcut.getState().register(makeBinding({ id: 'a' }));
        useShortcut.getState().register(makeBinding({ id: 'b' }));
        expect(useShortcut.getState().getAll()).toHaveLength(2);
    });

    it('returns empty array when no bindings registered', () => {
        expect(useShortcut.getState().getAll()).toHaveLength(0);
    });
});

describe('shortcut store — executeByKeys', () => {
    it('executes the matching binding and returns true', () => {
        const exec = vi.fn();
        useShortcut
            .getState()
            .register(makeBinding({ keys: 'ctrl+b', execute: exec }));
        const result = useShortcut.getState().executeByKeys('ctrl+b', 'global');
        expect(result).toBe(true);
        expect(exec).toHaveBeenCalledOnce();
    });

    it('returns false when no binding matches', () => {
        const result = useShortcut.getState().executeByKeys('ctrl+z', 'global');
        expect(result).toBe(false);
    });

    it('matches keys case-insensitively', () => {
        const exec = vi.fn();
        useShortcut
            .getState()
            .register(makeBinding({ keys: 'Ctrl+Shift+P', execute: exec }));
        const result = useShortcut
            .getState()
            .executeByKeys('ctrl+shift+p', 'global');
        expect(result).toBe(true);
        expect(exec).toHaveBeenCalledOnce();
    });
});

describe('shortcut store — context priority (editor > panel > global)', () => {
    it('executes editor binding over global when context is editor', () => {
        const globalExec = vi.fn();
        const editorExec = vi.fn();
        const store = useShortcut.getState();
        store.register(
            makeBinding({
                id: 'global-cmd',
                keys: 'ctrl+s',
                context: 'global',
                execute: globalExec,
            }),
        );
        store.register(
            makeBinding({
                id: 'editor-cmd',
                keys: 'ctrl+s',
                context: 'editor',
                execute: editorExec,
            }),
        );

        useShortcut.getState().executeByKeys('ctrl+s', 'editor');
        expect(editorExec).toHaveBeenCalledOnce();
        expect(globalExec).not.toHaveBeenCalled();
    });

    it('executes panel binding over global when context is panel', () => {
        const globalExec = vi.fn();
        const panelExec = vi.fn();
        const store = useShortcut.getState();
        store.register(
            makeBinding({
                id: 'global-cmd',
                keys: 'ctrl+s',
                context: 'global',
                execute: globalExec,
            }),
        );
        store.register(
            makeBinding({
                id: 'panel-cmd',
                keys: 'ctrl+s',
                context: 'panel',
                execute: panelExec,
            }),
        );

        useShortcut.getState().executeByKeys('ctrl+s', 'panel');
        expect(panelExec).toHaveBeenCalledOnce();
        expect(globalExec).not.toHaveBeenCalled();
    });

    it('executes editor binding over panel when context is editor', () => {
        const panelExec = vi.fn();
        const editorExec = vi.fn();
        const store = useShortcut.getState();
        store.register(
            makeBinding({
                id: 'panel-cmd',
                keys: 'ctrl+s',
                context: 'panel',
                execute: panelExec,
            }),
        );
        store.register(
            makeBinding({
                id: 'editor-cmd',
                keys: 'ctrl+s',
                context: 'editor',
                execute: editorExec,
            }),
        );

        useShortcut.getState().executeByKeys('ctrl+s', 'editor');
        expect(editorExec).toHaveBeenCalledOnce();
        expect(panelExec).not.toHaveBeenCalled();
    });

    it('falls back to global when context is global and editor binding exists', () => {
        const globalExec = vi.fn();
        const editorExec = vi.fn();
        const store = useShortcut.getState();
        store.register(
            makeBinding({
                id: 'global-cmd',
                keys: 'ctrl+s',
                context: 'global',
                execute: globalExec,
            }),
        );
        store.register(
            makeBinding({
                id: 'editor-cmd',
                keys: 'ctrl+s',
                context: 'editor',
                execute: editorExec,
            }),
        );

        useShortcut.getState().executeByKeys('ctrl+s', 'global');
        expect(globalExec).toHaveBeenCalledOnce();
        expect(editorExec).not.toHaveBeenCalled();
    });

    it('executes global binding when context is panel but no panel binding exists', () => {
        const globalExec = vi.fn();
        useShortcut.getState().register(
            makeBinding({
                id: 'global-cmd',
                keys: 'ctrl+s',
                context: 'global',
                execute: globalExec,
            }),
        );

        useShortcut.getState().executeByKeys('ctrl+s', 'panel');
        expect(globalExec).toHaveBeenCalledOnce();
    });

    it('returns false when all bindings have higher context than current', () => {
        const editorExec = vi.fn();
        useShortcut.getState().register(
            makeBinding({
                id: 'editor-cmd',
                keys: 'ctrl+s',
                context: 'editor',
                execute: editorExec,
            }),
        );

        // global context cannot trigger editor-scoped binding
        const result = useShortcut
            .getState()
            .executeByKeys('ctrl+s', 'global');
        expect(result).toBe(false);
        expect(editorExec).not.toHaveBeenCalled();
    });

    it('handles all three contexts competing for the same keys', () => {
        const globalExec = vi.fn();
        const panelExec = vi.fn();
        const editorExec = vi.fn();
        const store = useShortcut.getState();
        store.register(
            makeBinding({
                id: 'g',
                keys: 'ctrl+k',
                context: 'global',
                execute: globalExec,
            }),
        );
        store.register(
            makeBinding({
                id: 'p',
                keys: 'ctrl+k',
                context: 'panel',
                execute: panelExec,
            }),
        );
        store.register(
            makeBinding({
                id: 'e',
                keys: 'ctrl+k',
                context: 'editor',
                execute: editorExec,
            }),
        );

        // editor context → editor binding wins
        useShortcut.getState().executeByKeys('ctrl+k', 'editor');
        expect(editorExec).toHaveBeenCalledOnce();
        expect(panelExec).not.toHaveBeenCalled();
        expect(globalExec).not.toHaveBeenCalled();

        editorExec.mockClear();

        // panel context → panel binding wins
        useShortcut.getState().executeByKeys('ctrl+k', 'panel');
        expect(panelExec).toHaveBeenCalledOnce();
        expect(editorExec).not.toHaveBeenCalled();
        expect(globalExec).not.toHaveBeenCalled();

        panelExec.mockClear();

        // global context → global binding wins
        useShortcut.getState().executeByKeys('ctrl+k', 'global');
        expect(globalExec).toHaveBeenCalledOnce();
        expect(editorExec).not.toHaveBeenCalled();
        expect(panelExec).not.toHaveBeenCalled();
    });
});
