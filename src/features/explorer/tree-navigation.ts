import type { FileEntry } from '../../types';

export interface FlatEntry {
    path: string;
    name: string;
    isDir: boolean;
    depth: number;
    expanded: boolean;
    parentPath: string | null;
}

/** FileEntry extended with optional children for tree traversal */
export interface TreeEntry extends FileEntry {
    children?: TreeEntry[];
}

/**
 * Flatten the visible file tree into an ordered list (depth-first).
 * Only children of expanded folders are included in the output.
 */
export function flattenVisibleEntries(
    entries: TreeEntry[],
    expandedPaths: Set<string>,
    depth: number = 0,
    parentPath: string | null = null,
): FlatEntry[] {
    const result: FlatEntry[] = [];

    for (const entry of entries) {
        const expanded = entry.isDir && expandedPaths.has(entry.path);

        result.push({
            path: entry.path,
            name: entry.name,
            isDir: entry.isDir,
            depth,
            expanded,
            parentPath,
        });

        if (expanded && entry.children) {
            result.push(
                ...flattenVisibleEntries(entry.children, expandedPaths, depth + 1, entry.path),
            );
        }
    }

    return result;
}

/**
 * Get the path of the next or previous visible item.
 * Returns null if already at the boundary.
 */
export function getNextFocusPath(
    flatEntries: FlatEntry[],
    currentPath: string,
    direction: 'up' | 'down',
): string | null {
    const index = flatEntries.findIndex((e) => e.path === currentPath);
    if (index === -1) return null;

    const nextIndex = direction === 'down' ? index + 1 : index - 1;
    if (nextIndex < 0 || nextIndex >= flatEntries.length) return null;

    return flatEntries[nextIndex].path;
}

/**
 * Get the parent path of the given entry from the flat list.
 * Returns null if the entry is at root level or not found.
 */
export function getParentPath(
    flatEntries: FlatEntry[],
    currentPath: string,
): string | null {
    const entry = flatEntries.find((e) => e.path === currentPath);
    if (!entry) return null;
    return entry.parentPath;
}
