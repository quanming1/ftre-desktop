import { describe, it, expect } from 'vitest';
import { canDrop, resolveDropTarget } from './drag-drop-utils';

describe('canDrop', () => {
    it('returns false when source equals target (drop on self)', () => {
        expect(canDrop('/a/b', '/a/b')).toBe(false);
    });

    it('returns false when target is a subdirectory of source (unix paths)', () => {
        expect(canDrop('/a/b', '/a/b/c')).toBe(false);
        expect(canDrop('/a/b', '/a/b/c/d')).toBe(false);
    });

    it('returns false when target is a subdirectory of source (windows paths)', () => {
        expect(canDrop('C:\\a\\b', 'C:\\a\\b\\c')).toBe(false);
        expect(canDrop('C:\\a\\b', 'C:\\a\\b\\c\\d')).toBe(false);
    });

    it('returns true for valid drop targets', () => {
        expect(canDrop('/a/b', '/a/c')).toBe(true);
        expect(canDrop('/a/b', '/a')).toBe(true);
        expect(canDrop('/a/b', '/d')).toBe(true);
    });

    it('returns true when target path shares a prefix but is not a child', () => {
        // "/a/bar" starts with "/a/b" but is NOT a child of "/a/b"
        expect(canDrop('/a/b', '/a/bar')).toBe(true);
    });
});

describe('resolveDropTarget', () => {
    it('returns the path as-is when target is a directory', () => {
        expect(resolveDropTarget('/a/b', true)).toBe('/a/b');
        expect(resolveDropTarget('C:\\a\\b', true)).toBe('C:\\a\\b');
    });

    it('returns the parent directory when target is a file (unix paths)', () => {
        expect(resolveDropTarget('/a/b/file.txt', false)).toBe('/a/b');
        expect(resolveDropTarget('/a/file.txt', false)).toBe('/a');
    });

    it('returns the parent directory when target is a file (windows paths)', () => {
        expect(resolveDropTarget('C:\\a\\b\\file.txt', false)).toBe('C:\\a\\b');
        expect(resolveDropTarget('C:\\a\\file.txt', false)).toBe('C:\\a');
    });

    it('returns "." when file has no directory separator', () => {
        expect(resolveDropTarget('file.txt', false)).toBe('.');
    });
});
