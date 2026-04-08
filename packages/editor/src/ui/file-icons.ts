import type { LucideIcon } from "lucide-react";
import {
    File,
    FileCode,
    FileJson,
    FileText,
    FileType,
    Folder,
    FolderOpen,
    GitBranch,
    Image,
    Package,
    Settings,
    Zap,
} from "lucide-react";

export interface FileIconResult {
    icon: LucideIcon;
    color: string;
}

/** Maps file extensions to icon + color */
export const EXTENSION_MAP: Record<string, FileIconResult> = {
    ts: { icon: FileCode, color: "#3178c6" },
    tsx: { icon: FileCode, color: "#3178c6" },
    js: { icon: FileCode, color: "#f7df1e" },
    jsx: { icon: FileCode, color: "#f7df1e" },
    json: { icon: FileJson, color: "#cbcb41" },
    css: { icon: FileType, color: "#563d7c" },
    html: { icon: FileCode, color: "#e34c26" },
    md: { icon: FileText, color: "#519aba" },
    py: { icon: FileCode, color: "#3572A5" },
    png: { icon: Image, color: "#a074c4" },
    jpg: { icon: Image, color: "#a074c4" },
    svg: { icon: Image, color: "#ffb13b" },
    gitignore: { icon: GitBranch, color: "#f05032" },
    env: { icon: Settings, color: "#ecd53f" },
};

/** Maps special full file names to icon + color (takes priority over extension) */
export const SPECIAL_FILE_MAP: Record<string, FileIconResult> = {
    "package.json": { icon: Package, color: "#cb3837" },
    "tsconfig.json": { icon: Settings, color: "#3178c6" },
    "vite.config.ts": { icon: Zap, color: "#646cff" },
    ".gitignore": { icon: GitBranch, color: "#f05032" },
};

/** Maps virtual paths to icon + color (VSCode-style EditorInput) */
export const VIRTUAL_PATH_MAP: Record<string, FileIconResult> = {
    "ftre://settings": { icon: Settings, color: "#9da5b4" },
};

const FOLDER_EXPANDED: FileIconResult = { icon: FolderOpen, color: "#dcb67a" };
const FOLDER_COLLAPSED: FileIconResult = { icon: Folder, color: "#dcb67a" };
const DEFAULT_FILE: FileIconResult = { icon: File, color: "#9da5b4" };

/**
 * Returns the appropriate icon and color for a given file or directory.
 *
 * Resolution order:
 * 1. Virtual paths (e.g. "ftre://settings")
 * 2. Directories → expanded/collapsed folder icon
 * 3. Special file name match (e.g. "package.json")
 * 4. Extension match (e.g. ".ts")
 * 5. Default file icon
 *
 * @param fileNameOrPath - File name or full path
 * @param isDir - Whether it's a directory
 * @param isExpanded - For directories, whether it's expanded
 */
export function getFileIcon(
    fileNameOrPath: string,
    isDir: boolean,
    isExpanded?: boolean,
): FileIconResult {
    // Check virtual paths first (VSCode-style EditorInput)
    if (VIRTUAL_PATH_MAP[fileNameOrPath]) {
        return VIRTUAL_PATH_MAP[fileNameOrPath];
    }

    if (isDir) {
        return isExpanded ? FOLDER_EXPANDED : FOLDER_COLLAPSED;
    }

    // Extract filename from path if needed
    const fileName = fileNameOrPath.includes("/") || fileNameOrPath.includes("\\")
        ? fileNameOrPath.split(/[\\/]/).pop() ?? fileNameOrPath
        : fileNameOrPath;

    // Check special file names
    const lowerName = fileName.toLowerCase();
    if (SPECIAL_FILE_MAP[lowerName]) {
        return SPECIAL_FILE_MAP[lowerName];
    }

    // Extract extension
    const dotIndex = lowerName.lastIndexOf(".");
    if (dotIndex >= 0) {
        const ext = lowerName.slice(dotIndex + 1);
        if (EXTENSION_MAP[ext]) {
            return EXTENSION_MAP[ext];
        }
    }

    return DEFAULT_FILE;
}
