import type { SearchOptions, SearchMatch, SearchFileResult } from '../stores/search';

export type { SearchOptions, SearchMatch, SearchFileResult };

export interface FileEntry {
    name: string;
    path: string;
    isDir: boolean;
    ext: string | null;
}

export interface DesktopFS {
    readDir(dirPath: string): Promise<{ entries: FileEntry[]; error?: string }>;
    readFile(filePath: string): Promise<{ content: string; language: string; error?: string }>;
    writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }>;
    selectFolder(): Promise<{ path: string | null }>;
    search(rootPath: string, query: string, options: SearchOptions): Promise<{ results: SearchFileResult[]; error?: string }>;
    createFile(filePath: string): Promise<{ success: boolean; error?: string }>;
    createFolder(dirPath: string): Promise<{ success: boolean; error?: string }>;
    rename(oldPath: string, newPath: string): Promise<{ success: boolean; error?: string }>;
    delete(targetPath: string, isDir: boolean): Promise<{ success: boolean; error?: string }>;
    revealInExplorer(targetPath: string): Promise<void>;
    watch(filePath: string): Promise<void>;
    unwatch(filePath: string): Promise<void>;
    onFileChanged(callback: (filePath: string) => void): () => void;
}

export interface GitInfo {
    branch: string | null;
    changedFiles: number;
    isGitRepo: boolean;
}

export interface DesktopGit {
    info(rootPath: string): Promise<GitInfo>;
}

export interface DesktopTerminal {
    create(opts?: { cols?: number; rows?: number; cwd?: string; shell?: string }): Promise<{ id: number }>;
    write(id: number, data: string): Promise<void>;
    resize(id: number, cols: number, rows: number): Promise<void>;
    kill(id: number): Promise<void>;
    onData(callback: (id: number, data: string) => void): () => void;
    onExit(callback: (id: number, exitCode: number) => void): () => void;
}

export interface DesktopAPI {
    platform: string;
    isElectron: boolean;
    openExternal(url: string): Promise<void>;
    fs: DesktopFS;
    git: DesktopGit;
    window: {
        minimize(): Promise<void>;
        maximize(): Promise<void>;
        close(): Promise<void>;
    };
    terminal: DesktopTerminal;
}
