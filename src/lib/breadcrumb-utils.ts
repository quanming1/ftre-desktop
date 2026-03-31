/**
 * Breadcrumb path parsing utilities.
 *
 * Converts file paths into breadcrumb segments for navigation display.
 * Handles both Windows (\) and Unix (/) path separators.
 */

export interface BreadcrumbSegment {
    name: string;
    path: string;
    isDir: boolean;
}

/**
 * Normalizes a path by replacing all backslashes with forward slashes
 * and removing trailing slashes.
 */
function normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Parses a file path relative to a root path into breadcrumb segments.
 *
 * - The first segment is the root directory name (isDir: true).
 * - Intermediate segments are directories (isDir: true).
 * - The last segment is the file name (isDir: false).
 * - If filePath doesn't start with rootPath, returns just the filename.
 * - Uses `›` as the conceptual separator between segments.
 *
 * @param filePath  Absolute path to the file
 * @param rootPath  Absolute path to the project root directory
 * @returns Array of BreadcrumbSegment from root to file
 */
export function parseBreadcrumbSegments(
    filePath: string,
    rootPath: string,
): BreadcrumbSegment[] {
    const normalizedFile = normalizePath(filePath);
    const normalizedRoot = normalizePath(rootPath);

    // If filePath doesn't start with rootPath, return just the filename
    if (!normalizedFile.startsWith(normalizedRoot + '/') && normalizedFile !== normalizedRoot) {
        const fileName = normalizedFile.split('/').pop() || filePath;
        return [{ name: fileName, path: filePath, isDir: false }];
    }

    // Get the root directory name
    const rootName = normalizedRoot.split('/').pop() || normalizedRoot;

    // Compute relative path from root to file
    const relativePath = normalizedFile.slice(normalizedRoot.length + 1);

    if (!relativePath) {
        // filePath equals rootPath — return root as a single directory segment
        return [{ name: rootName, path: rootPath, isDir: true }];
    }

    const parts = relativePath.split('/');
    const segments: BreadcrumbSegment[] = [];

    // First segment: root directory
    segments.push({ name: rootName, path: normalizedRoot, isDir: true });

    // Intermediate segments: directories
    let currentPath = normalizedRoot;
    for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath + '/' + parts[i];
        segments.push({ name: parts[i], path: currentPath, isDir: true });
    }

    // Last segment: file
    const fileName = parts[parts.length - 1];
    currentPath = currentPath + '/' + fileName;
    segments.push({ name: fileName, path: currentPath, isDir: false });

    return segments;
}
