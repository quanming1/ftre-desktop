import type { SearchProvider, SearchResult, ContentMatch } from './types';
import { fuzzyMatch } from './fuzzy-match';
import { useWorkspace } from '@/stores/workspace';
import { useShortcut } from '@/stores/shortcut';
import { useSession } from '@/stores/session';
import { useEditor } from '@/stores/editor';

// ── File Name Provider ──────────────────────────────────────────────

const IGNORED_DIRS = new Set([
    'node_modules', '__pycache__', '.git', '.hg', '.svn',
    'dist', 'build', 'out', '.next', '.nuxt',
    'vendor', '.venv', 'venv', 'env',
    'target', '.ftre', 'coverage', '.cache',
]);

const MAX_FILE_INDEX_SIZE = 50_000;

interface FileEntry {
    name: string;
    path: string;
    relativePath: string;
}

let cachedFiles: FileEntry[] = [];
let cachedRootPath: string | null = null;

/** Recursively collects all file paths via Electron IPC with caching. */
async function ensureFileIndex(): Promise<FileEntry[]> {
    const rootPath = useWorkspace.getState().rootPath;
    if (!rootPath) return [];
    if (rootPath === cachedRootPath && cachedFiles.length > 0) return cachedFiles;

    const root = rootPath; // capture non-null for closure
    const collected: FileEntry[] = [];

    async function walk(dir: string) {
        if (collected.length >= MAX_FILE_INDEX_SIZE) return;
        const result = await window.desktop.fs.readDir(dir);
        if (result.error || !result.entries) return;
        for (const entry of result.entries) {
            if (collected.length >= MAX_FILE_INDEX_SIZE) return;
            const skip = entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name);
            if (skip) continue;
            if (entry.isDir) {
                await walk(entry.path);
            } else {
                const rel = entry.path.slice(root.length + 1).replace(/\\/g, '/');
                collected.push({ name: entry.name, path: entry.path, relativePath: rel });
            }
        }
    }

    await walk(root);
    cachedFiles = collected;
    cachedRootPath = root;
    return cachedFiles;
}

/** Invalidate file index (call when workspace changes). */
export function invalidateFileIndex() {
    cachedFiles = [];
    cachedRootPath = null;
}

export const fileNameProvider: SearchProvider = {
    category: 'file',

    async search(query: string, limit: number): Promise<SearchResult[]> {
        const files = await ensureFileIndex();
        const results: SearchResult[] = [];

        for (const file of files) {
            const nameMatch = fuzzyMatch(query, file.name);
            const pathMatch = fuzzyMatch(query, file.relativePath);
            const best = (nameMatch && pathMatch)
                ? (nameMatch.score >= pathMatch.score ? nameMatch : pathMatch)
                : (nameMatch || pathMatch);

            if (!best) continue;

            results.push({
                id: `file:${file.path}`,
                category: 'file',
                title: file.name,
                subtitle: file.relativePath,
                score: best.score,
                titleHighlight: nameMatch?.highlights,
                action: () => {
                    window.desktop.fs.readFile(file.path).then((res: { error?: string; content: string; language: string }) => {
                        if (!res.error) {
                            useEditor.getState().openFile({
                                path: file.path,
                                name: file.name,
                                language: res.language,
                                content: res.content,
                            });
                        }
                    });
                },
            });
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    },
};

// ── Command Provider ────────────────────────────────────────────────

export const commandProvider: SearchProvider = {
    category: 'command',

    async search(query: string, limit: number): Promise<SearchResult[]> {
        const bindings = useShortcut.getState().bindings;
        const results: SearchResult[] = [];

        for (const binding of bindings) {
            const labelMatch = fuzzyMatch(query, binding.label);
            const catMatch = binding.category ? fuzzyMatch(query, binding.category) : null;
            const best = (labelMatch && catMatch)
                ? (labelMatch.score >= catMatch.score ? labelMatch : catMatch)
                : (labelMatch || catMatch);

            if (!best) continue;

            const keysDisplay = binding.keys
                ? binding.keys.split('+').map(k => k.charAt(0).toUpperCase() + k.slice(1)).join('+')
                : '';

            results.push({
                id: `cmd:${binding.id}`,
                category: 'command',
                title: binding.label,
                subtitle: keysDisplay || (binding.category ?? ''),
                score: best.score,
                titleHighlight: labelMatch?.highlights,
                action: () => binding.execute(),
            });
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    },
};

// ── File Content Provider ───────────────────────────────────────────

export const fileContentProvider: SearchProvider = {
    category: 'content',

    async search(query: string, limit: number): Promise<SearchResult[]> {
        const rootPath = useWorkspace.getState().rootPath;
        if (!rootPath || !query.trim()) return [];

        const response = await window.desktop.fs.search(rootPath, query, {
            caseSensitive: false,
            wholeWord: false,
            useRegex: false,
            includePattern: '',
            excludePattern: '',
        });

        if (response?.error || !response?.results) return [];

        const results: SearchResult[] = [];

        for (const fileResult of response.results) {
            if (results.length >= limit) break;

            // 每个文件的匹配行（最多显示 5 行）
            const contentMatches: ContentMatch[] = fileResult.matches.slice(0, 5).map((m: {
                lineNumber: number;
                lineContent: string;
                matchStart: number;
                matchEnd: number;
            }) => ({
                lineNumber: m.lineNumber,
                lineContent: m.lineContent,
                matchStart: m.matchStart,
                matchEnd: m.matchEnd,
            }));

            const totalMatches = fileResult.matches.length;
            const relativePath = rootPath
                ? fileResult.filePath.slice(rootPath.length + 1).replace(/\\/g, '/')
                : fileResult.filePath;

            // 一个文件 = 一个结果条目（内含多个匹配行）
            results.push({
                id: `content:${fileResult.filePath}`,
                category: 'content',
                title: fileResult.fileName,
                subtitle: `${relativePath}  ·  ${totalMatches} 处匹配`,
                filePath: fileResult.filePath,
                contentMatches,
                score: Math.min(1, 0.3 + totalMatches * 0.05),
                action: () => {
                    // 点击文件级结果：打开文件并跳转到第一个匹配行
                    const firstLine = contentMatches[0]?.lineNumber ?? 1;
                    window.desktop.fs.readFile(fileResult.filePath).then((res: { error?: string; content: string; language: string }) => {
                        if (!res.error) {
                            useEditor.getState().openFile({
                                path: fileResult.filePath,
                                name: fileResult.fileName,
                                language: res.language,
                                content: res.content,
                            });
                            setTimeout(() => {
                                window.dispatchEvent(
                                    new CustomEvent('ftre:goto-line', {
                                        detail: { filePath: fileResult.filePath, lineNumber: firstLine },
                                    }),
                                );
                            }, 100);
                        }
                    });
                },
            });
        }

        return results.slice(0, limit);
    },
};

// ── Session Provider ────────────────────────────────────────────────

export const sessionProvider: SearchProvider = {
    category: 'session',

    async search(query: string, limit: number): Promise<SearchResult[]> {
        const sessions = useSession.getState().sessions;
        const results: SearchResult[] = [];

        for (const session of sessions) {
            const titleMatch = fuzzyMatch(query, session.title);
            if (!titleMatch) continue;

            const dateStr = new Date(session.updated_at * 1000).toLocaleDateString();

            results.push({
                id: `session:${session.session_id}`,
                category: 'session',
                title: session.title,
                subtitle: dateStr,
                score: titleMatch.score,
                titleHighlight: titleMatch.highlights,
                action: () => {
                    useSession.getState().switchSession(session.session_id);
                },
            });
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    },
};
