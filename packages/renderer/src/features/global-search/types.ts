export type SearchCategory = 'file' | 'content' | 'session' | 'command';

/** 内容搜索中的单条匹配行 */
export interface ContentMatch {
    lineNumber: number;
    lineContent: string;
    /** 匹配文本在行内的 [start, end) 字符偏移（用于高亮） */
    matchStart: number;
    matchEnd: number;
}

export interface SearchResult {
    id: string;
    category: SearchCategory;
    title: string;
    subtitle?: string;
    score: number; // 0~1, higher = more relevant
    action: () => void;
    /** Optional highlight ranges for the title */
    titleHighlight?: [number, number][];
    /** 仅 content 类型：该文件的所有匹配行 */
    contentMatches?: ContentMatch[];
    /** 仅 content 类型：文件相对路径 */
    filePath?: string;
}

export interface SearchProvider {
    category: SearchCategory;
    /** Execute a search and return scored results */
    search(query: string, limit: number): Promise<SearchResult[]>;
}

/** Category display order (shared between store and UI) */
export const CATEGORY_ORDER: SearchCategory[] = ['command', 'file', 'session', 'content'];
