import { useWorkspace } from '@/stores/workspace';

/**
 * Resolve a file path to an absolute normalized path.
 * - Absolute paths (starting with drive letter or /) are normalized directly.
 * - Relative paths are joined with the workspace rootPath.
 * - If rootPath is not set and the path is relative, returns the original path with a warning.
 */
export function resolveFilePath(filePath: string): string {
    // Absolute path: normalize directly
    if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/')) {
        return normalizePath(filePath);
    }
    const root = useWorkspace.getState().rootPath;
    if (!root) {
        console.warn('[pathUtils] rootPath 未设置，无法解析相对路径:', filePath);
        return filePath;
    }
    return normalizePath(root.replace(/[\\/]$/, '') + '/' + filePath);
}

/**
 * Normalize a path: unify separators to `/`, resolve `.` and `..` segments,
 * preserve Windows drive letter or Unix root prefix.
 */
export function normalizePath(p: string): string {
    const parts = p.replace(/\\/g, '/').split('/');
    const isWindows = /^[a-zA-Z]:$/.test(parts[0]);
    const resolved: string[] = [];
    for (let i = isWindows ? 1 : 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === '.' || part === '') continue;
        if (part === '..') {
            resolved.pop();
            continue;
        }
        resolved.push(part);
    }
    // Preserve Windows drive letter or Unix root
    const prefix = isWindows ? parts[0] + '/' : '/';
    return prefix + resolved.join('/');
}


/**
 * Extract the last segment of a path as the file name.
 */
export function basename(filePath: string): string {
    return filePath.split(/[\\/]/).pop() ?? filePath;
}

/**
 * 给工作区路径生成稳定的短 hash，用于 localStorage key 区分不同工作区。
 * 同一路径（不论斜杠方向和尾部斜杠）永远产生相同结果。
 */
export function workspaceHash(rootPath: string): string {
    const normalized = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
    let h = 0;
    for (let i = 0; i < normalized.length; i++) {
        h = ((h << 5) - h + normalized.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
}

/**
 * 以指定 workspace 路径（而非全局 rootPath）解析文件路径。
 * 用于 SSE 流中后台 session 的路径解析，避免读取已切换的全局 rootPath。
 */
export function resolveFilePathWithWorkspace(filePath: string, workspace: string): string {
    if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/')) {
        return normalizePath(filePath);
    }
    return normalizePath(workspace.replace(/[\\/]$/, '') + '/' + filePath);
}

// ── 统一路径处理工具 ──────────────────────────────────────────────────

/**
 * 检测路径使用的分隔符。
 * 如果包含反斜杠则返回 `\\`，否则返回 `/`。
 */
export function pathSep(p: string): '\\' | '/' {
    return p.includes('\\') ? '\\' : '/';
}

/**
 * 拼接路径段，自动使用与 base 一致的分隔符。
 */
export function pathJoin(base: string, ...segments: string[]): string {
    const sep = pathSep(base);
    const parts = [base.replace(/[\\/]+$/, ''), ...segments.map((s) => s.replace(/^[\\/]+|[\\/]+$/g, ''))];
    return parts.filter(Boolean).join(sep);
}

/**
 * 取父目录路径（保持原始分隔符风格）。
 */
export function pathParent(p: string): string {
    const sep = pathSep(p);
    const normalized = p.replace(/[\\/]+$/, '');
    const lastSlash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
    if (lastSlash <= 0) {
        // Unix root or single segment
        return normalized.charAt(0) === '/' || normalized.charAt(0) === '\\' ? sep : '';
    }
    // Preserve Windows drive root: "C:\" instead of "C:"
    if (/^[a-zA-Z]:$/.test(normalized.slice(0, lastSlash))) {
        return normalized.slice(0, lastSlash) + sep;
    }
    return normalized.slice(0, lastSlash);
}

/**
 * 取文件/文件夹名（路径最后一段）。
 */
export function pathName(p: string): string {
    return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

/**
 * 判断 child 是否是 parent 的子路径（不含自身）。
 * 同时兼容 `\\` 和 `/` 分隔符。
 */
export function isSubPath(parent: string, child: string): boolean {
    const normalizedParent = parent.replace(/\\/g, '/').replace(/\/+$/, '');
    const normalizedChild = child.replace(/\\/g, '/').replace(/\/+$/, '');
    return normalizedChild.startsWith(normalizedParent + '/');
}
