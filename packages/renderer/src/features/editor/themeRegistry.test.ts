import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerFtreTheme, _resetThemeRegistration } from './themeRegistry';

// Stub getComputedStyle so it works in jsdom
const cssVars: Record<string, string> = {
    '--color-base': '#0a0a0a',
    '--color-t-primary': '#e0e0e0',
    '--color-t-ghost': '#444444',
    '--color-t-secondary': '#999999',
    '--color-neon': '#00ffaa',
    '--color-surface': '#1a1a1a',
    '--color-border': '#333333',
    '--color-panel': '#111111',
    '--color-t-faint': '#555555',
};

beforeEach(() => {
    _resetThemeRegistration();
    vi.stubGlobal('getComputedStyle', () => ({
        getPropertyValue: (name: string) => cssVars[name] ?? '',
    }));
});

function makeMonaco() {
    return {
        editor: {
            defineTheme: vi.fn(),
        },
    } as unknown as typeof import('monaco-editor');
}

describe('registerFtreTheme', () => {
    it('calls defineTheme with ftre-dark on first invocation', () => {
        const monaco = makeMonaco();
        registerFtreTheme(monaco);

        expect(monaco.editor.defineTheme).toHaveBeenCalledOnce();
        expect(monaco.editor.defineTheme).toHaveBeenCalledWith(
            'ftre-dark',
            expect.objectContaining({
                base: 'vs-dark',
                inherit: true,
            }),
        );
    });

    it('does not call defineTheme on subsequent invocations (idempotent)', () => {
        const monaco = makeMonaco();
        registerFtreTheme(monaco);
        registerFtreTheme(monaco);
        registerFtreTheme(monaco);

        expect(monaco.editor.defineTheme).toHaveBeenCalledOnce();
    });

    it('reads CSS variables for theme colors', () => {
        const monaco = makeMonaco();
        registerFtreTheme(monaco);

        const themeData = (monaco.editor.defineTheme as ReturnType<typeof vi.fn>).mock.calls[0][1];
        expect(themeData.colors['editor.background']).toBe('#0a0a0a');
        expect(themeData.colors['editorCursor.foreground']).toBe('#00ffaa');
        expect(themeData.colors['editor.selectionBackground']).toBe('#00ffaa33');
        expect(themeData.colors['list.activeSelectionBackground']).toBe('#00ffaa18');
    });

    it('includes all expected token rules', () => {
        const monaco = makeMonaco();
        registerFtreTheme(monaco);

        const themeData = (monaco.editor.defineTheme as ReturnType<typeof vi.fn>).mock.calls[0][1];
        const tokens = themeData.rules.map((r: { token: string }) => r.token);
        expect(tokens).toEqual(['comment', 'keyword', 'string', 'number', 'type']);
    });

    it('registers again after _resetThemeRegistration is called', () => {
        const monaco = makeMonaco();
        registerFtreTheme(monaco);
        expect(monaco.editor.defineTheme).toHaveBeenCalledOnce();

        _resetThemeRegistration();
        registerFtreTheme(monaco);
        expect(monaco.editor.defineTheme).toHaveBeenCalledTimes(2);
    });
});
