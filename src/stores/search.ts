import { create } from 'zustand';
import { useNotification } from './notification';
import { useWorkspace } from './workspace';

export interface SearchMatch {
    lineNumber: number;
    lineContent: string;
    matchStart: number;
    matchEnd: number;
}

export interface SearchFileResult {
    filePath: string;
    fileName: string;
    matches: SearchMatch[];
}

export interface SearchOptions {
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
    includePattern: string;
    excludePattern: string;
}

export interface SearchState {
    query: string;
    results: SearchFileResult[];
    isSearching: boolean;
    options: SearchOptions;

    setQuery: (q: string) => void;
    setOption: <K extends keyof SearchOptions>(
        key: K,
        value: SearchOptions[K],
    ) => void;
    executeSearch: () => Promise<void>;
    clearResults: () => void;
}

const defaultOptions: SearchOptions = {
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    includePattern: '',
    excludePattern: '',
};

export const useSearch = create<SearchState>((set, get) => ({
    query: '',
    results: [],
    isSearching: false,
    options: { ...defaultOptions },

    setQuery: (q) => set({ query: q }),

    setOption: (key, value) =>
        set((state) => ({
            options: { ...state.options, [key]: value },
        })),

    executeSearch: async () => {
        const { query, options } = get();

        if (!query.trim()) {
            set({ results: [], isSearching: false });
            return;
        }

        set({ isSearching: true });

        try {
            const rootPath = useWorkspace.getState().rootPath;
            if (!rootPath) {
                set({ results: [], isSearching: false });
                return;
            }
            const response = await window.desktop.fs.search(rootPath, query, options);
            if (response?.error) {
                useNotification.getState().addNotification({ level: 'warning', message: response.error });
            }
            const results = response?.results ?? [];
            set({ results, isSearching: false });
        } catch (err) {
            useNotification.getState().addNotification({ level: 'warning', message: String(err) });
            set({ results: [], isSearching: false });
        }
    },

    clearResults: () => set({ query: '', results: [], isSearching: false }),
}));
