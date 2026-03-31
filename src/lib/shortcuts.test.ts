import { describe, it, expect } from 'vitest';
import { normalizeKeyEvent } from './shortcuts';

/**
 * Helper to create a minimal KeyboardEvent-like object for testing.
 */
function makeKeyEvent(
    overrides: Partial<KeyboardEvent> & { key: string; code?: string },
): KeyboardEvent {
    return {
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        code: '',
        ...overrides,
    } as KeyboardEvent;
}

describe('normalizeKeyEvent — single modifier + letter', () => {
    it('normalizes Ctrl+B', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: 'b', code: 'KeyB', ctrlKey: true }),
        );
        expect(result).toBe('ctrl+b');
    });

    it('normalizes Ctrl+P', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: 'p', code: 'KeyP', ctrlKey: true }),
        );
        expect(result).toBe('ctrl+p');
    });

    it('normalizes Alt+Z', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: 'z', code: 'KeyZ', altKey: true }),
        );
        expect(result).toBe('alt+z');
    });
});

describe('normalizeKeyEvent — multiple modifiers', () => {
    it('normalizes Ctrl+Shift+P', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({
                key: 'P',
                code: 'KeyP',
                ctrlKey: true,
                shiftKey: true,
            }),
        );
        expect(result).toBe('ctrl+shift+p');
    });

    it('normalizes Ctrl+Shift+F', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({
                key: 'F',
                code: 'KeyF',
                ctrlKey: true,
                shiftKey: true,
            }),
        );
        expect(result).toBe('ctrl+shift+f');
    });

    it('normalizes Ctrl+Alt+T', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({
                key: 't',
                code: 'KeyT',
                ctrlKey: true,
                altKey: true,
            }),
        );
        expect(result).toBe('ctrl+alt+t');
    });
});

describe('normalizeKeyEvent — special keys via code mapping', () => {
    it('normalizes Ctrl+` (Backquote)', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: '`', code: 'Backquote', ctrlKey: true }),
        );
        expect(result).toBe('ctrl+`');
    });

    it('normalizes Ctrl+\\ (Backslash)', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: '\\', code: 'Backslash', ctrlKey: true }),
        );
        expect(result).toBe('ctrl+\\');
    });

    it('normalizes Ctrl+[ (BracketLeft)', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: '[', code: 'BracketLeft', ctrlKey: true }),
        );
        expect(result).toBe('ctrl+[');
    });

    it('normalizes Ctrl+] (BracketRight)', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: ']', code: 'BracketRight', ctrlKey: true }),
        );
        expect(result).toBe('ctrl+]');
    });
});

describe('normalizeKeyEvent — named keys', () => {
    it('normalizes Escape', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: 'Escape', code: 'Escape' }),
        );
        expect(result).toBe('escape');
    });

    it('normalizes Enter', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: 'Enter', code: 'Enter' }),
        );
        expect(result).toBe('enter');
    });

    it('normalizes Ctrl+Enter', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: 'Enter', code: 'Enter', ctrlKey: true }),
        );
        expect(result).toBe('ctrl+enter');
    });

    it('normalizes Tab', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: 'Tab', code: 'Tab' }),
        );
        expect(result).toBe('tab');
    });
});

describe('normalizeKeyEvent — modifier-only presses return empty string', () => {
    it('returns empty for Control key alone', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: 'Control', code: 'ControlLeft', ctrlKey: true }),
        );
        expect(result).toBe('');
    });

    it('returns empty for Shift key alone', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }),
        );
        expect(result).toBe('');
    });

    it('returns empty for Alt key alone', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: 'Alt', code: 'AltLeft', altKey: true }),
        );
        expect(result).toBe('');
    });

    it('returns empty for Meta key alone', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: 'Meta', code: 'MetaLeft', metaKey: true }),
        );
        expect(result).toBe('');
    });
});

describe('normalizeKeyEvent — modifier ordering', () => {
    it('always orders ctrl before shift before alt', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({
                key: 'a',
                code: 'KeyA',
                altKey: true,
                shiftKey: true,
                ctrlKey: true,
            }),
        );
        expect(result).toBe('ctrl+shift+alt+a');
    });
});

describe('normalizeKeyEvent — metaKey treated as ctrl', () => {
    it('normalizes Meta+S as ctrl+s', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: 's', code: 'KeyS', metaKey: true }),
        );
        expect(result).toBe('ctrl+s');
    });
});

describe('normalizeKeyEvent — plain keys without modifiers', () => {
    it('normalizes a plain letter', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: 'a', code: 'KeyA' }),
        );
        expect(result).toBe('a');
    });

    it('normalizes a digit', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: '1', code: 'Digit1' }),
        );
        expect(result).toBe('1');
    });

    it('normalizes F1', () => {
        const result = normalizeKeyEvent(
            makeKeyEvent({ key: 'F1', code: 'F1' }),
        );
        expect(result).toBe('f1');
    });
});
