import { useEffect } from 'react';
import { useShortcut } from '../stores/shortcut';

/**
 * Map of KeyboardEvent.code values to readable key names for special keys.
 */
const CODE_TO_KEY: Record<string, string> = {
    Backquote: '`',
    Backslash: '\\',
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
};

/**
 * Converts a KeyboardEvent into a standardized key combination string.
 *
 * Order: ctrl, shift, alt, meta, then the key — all lowercase.
 * Examples: "ctrl+shift+p", "ctrl+b", "ctrl+`"
 */
export function normalizeKeyEvent(e: KeyboardEvent): string {
    const parts: string[] = [];

    if (e.ctrlKey || e.metaKey) parts.push('ctrl');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');

    // Determine the actual key
    let key: string;

    if (e.code in CODE_TO_KEY) {
        key = CODE_TO_KEY[e.code];
    } else if (e.key.length === 1) {
        // Single character keys (letters, digits, etc.)
        key = e.key.toLowerCase();
    } else {
        // Named keys like Enter, Escape, ArrowUp, Tab, etc.
        key = e.key.toLowerCase();
    }

    // Skip if the key is just a modifier
    if (['control', 'shift', 'alt', 'meta'].includes(key)) {
        return '';
    }

    parts.push(key);
    return parts.join('+');
}

/**
 * React hook that registers a global keydown listener on window.
 * Normalizes key events and dispatches them through the shortcut store.
 * Prevents default browser behavior when a shortcut is matched.
 */
export function useGlobalShortcuts(): void {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const keys = normalizeKeyEvent(e);
            if (!keys) return;

            const executed = useShortcut.getState().executeByKeys(keys, 'global');
            if (executed) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);
}
