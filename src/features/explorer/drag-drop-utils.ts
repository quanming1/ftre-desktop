/**
 * Validate whether a dragged item can be dropped onto the target directory.
 *
 * Returns false when:
 * - sourcePath equals targetDirPath (dropping on self)
 * - targetDirPath is a subdirectory of sourcePath (dropping into own child)
 */
export function canDrop(sourcePath: string, targetDirPath: string): boolean {
    // Cannot drop on self
    if (sourcePath === targetDirPath) return false;

    // Cannot drop into own subdirectory
    const sep = sourcePath.includes('\\') ? '\\' : '/';
    if (targetDirPath.startsWith(sourcePath + sep)) return false;

    return true;
}

/**
 * Resolve the actual drop target directory path.
 *
 * - If the target is a directory, return it as-is.
 * - If the target is a file, return its parent directory.
 */
export function resolveDropTarget(targetPath: string, isDir: boolean): string {
    if (isDir) return targetPath;

    // Determine separator used in the path
    const sep = targetPath.includes('\\') ? '\\' : '/';
    const lastSepIndex = targetPath.lastIndexOf(sep);

    // If no separator found, the parent is the root (empty string or '.')
    if (lastSepIndex === -1) return '.';

    return targetPath.substring(0, lastSepIndex);
}
