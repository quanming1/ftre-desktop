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

const FOLDER_EXPANDED: FileIconResult = { icon: FolderOpen, color: "#dcb67a" };
const FOLDER_COLLAPSED: FileIconResult = { icon: Folder, color: "#dcb67a" };
const DEFAULT_FILE: FileIconResult = { icon: File, color: "#9da5b4" };

/**
 * Returns the appropriate icon and color for a given file or directory.
 *
 * Resolution order:
 * 1. Directories → expanded/collapsed folder icon
 * 2. Special file name match (e.g. "package.json")
 * 3. Extension match (e.g. ".ts")
 * 4. Default file icon
 */
export function getFileIcon(
    fileName: string,
    isDir: boolean,
    isExpanded?: boolean,
): FileIconResult {
    if (isDir) {
        return isExpanded ? FOLDER_EXPANDED : FOLDER_COLLAPSED;
    }

    // Check special file names first
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
