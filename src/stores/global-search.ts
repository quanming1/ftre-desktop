import { create } from 'zustand';
import { CATEGORY_ORDER, type SearchCategory, type SearchResult, type SearchProvider } from '@/features/global-search/types';
import {
    fileNameProvider,
    commandProvider,
    fileContentProvider,
    sessionProvider,
} from '@/features/global-search/providers';

type CategoryFilter = 'all' | SearchCategory;

interface GlobalSearchState {
    open: boolean;
    query: string;
    activeCategory: CategoryFilter;
    /** Results grouped by category */
    resultsByCategory: Record<SearchCategory, SearchResult[]>;
    selectedIndex: number;
    isSearching: boolean;

    toggle: () => void;
    /** 直接打开并切换到指定分类（用于 Ctrl+Shift+F 直接进入内容搜索） */
    openWithCategory: (category: CategoryFilter) => void;
    close: () => void;
    setQuery: (q: string) => void;
    setCategory: (c: CategoryFilter) => void;
    setSelectedIndex: (i: number) => void;
    executeSearch: () => Promise<void>;
    confirmSelection: () => void;

    /** Flattened, ordered results for the current category filter */
    getFlatResults: () => SearchResult[];
}

/**
 * Providers ordered by display priority.
 * Fast providers (command, file, session) run immediately;
 * slow providers (content) are debounced.
 */
const PROVIDERS: SearchProvider[] = [
    commandProvider,
    fileNameProvider,
    sessionProvider,
    fileContentProvider,
];

function getActiveProviders(category: CategoryFilter): SearchProvider[] {
    if (category === 'all') return PROVIDERS;
    return PROVIDERS.filter((p) => p.category === category);
}

const EMPTY_RESULTS: Record<SearchCategory, SearchResult[]> = {
    file: [],
    content: [],
    session: [],
    command: [],
};

const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

// CATEGORY_ORDER imported from types.ts

/** Per-category limits when showing "all" */
const CATEGORY_LIMITS: Record<SearchCategory, number> = {
    command: 5,
    file: 10,
    session: 5,
    content: 10,
};

export const useGlobalSearch = create<GlobalSearchState>((set, get) => ({
    open: false,
    query: '',
    activeCategory: 'all',
    resultsByCategory: { ...EMPTY_RESULTS },
    selectedIndex: 0,
    isSearching: false,

    toggle: () => {
        const wasOpen = get().open;
        if (wasOpen) {
            set({ open: false });
        } else {
            set({
                open: true,
                query: '',
                resultsByCategory: { ...EMPTY_RESULTS },
                selectedIndex: 0,
                isSearching: false,
            });
        }
    },

    openWithCategory: (category) => {
        set({
            open: true,
            query: '',
            activeCategory: category,
            resultsByCategory: { ...EMPTY_RESULTS },
            selectedIndex: 0,
            isSearching: false,
        });
    },

    close: () => {
        // 清理所有 debounce 定时器
        for (const key of Object.keys(debounceTimers)) {
            clearTimeout(debounceTimers[key]);
            delete debounceTimers[key];
        }
        set({ open: false });
    },

    setQuery: (q) => {
        set({ query: q, selectedIndex: 0 });
        // 所有搜索统一 debounce，避免每次击键都触发完整搜索
        if (debounceTimers['_query']) clearTimeout(debounceTimers['_query']);
        debounceTimers['_query'] = setTimeout(() => {
            // 确保查询没有在 debounce 期间又变了
            if (get().query === q) {
                get().executeSearch();
            }
        }, 150);
    },

    setCategory: (c) => {
        set({ activeCategory: c, selectedIndex: 0 });
        get().executeSearch();
    },

    setSelectedIndex: (i) => set({ selectedIndex: i }),

    executeSearch: async () => {
        const { query, activeCategory } = get();

        if (!query.trim()) {
            set({ resultsByCategory: { ...EMPTY_RESULTS }, isSearching: false });
            return;
        }

        const providers = getActiveProviders(activeCategory);
        set({ isSearching: true });

        // Launch each provider independently.
        // Fast providers run immediately, slow ones (content) are debounced.
        // Track pending providers to know when all are done.
        let pending = 0;

        const onProviderDone = () => {
            pending--;
            if (pending <= 0 && get().query === query) {
                set({ isSearching: false });
            }
        };

        for (const provider of providers) {
            const delay = 0; // setQuery 已统一 debounce 150ms，provider 不再额外延迟
            const key = provider.category;

            if (debounceTimers[key]) {
                clearTimeout(debounceTimers[key]);
            }

            pending++;

            const run = async () => {
                try {
                    const limit = activeCategory === 'all'
                        ? CATEGORY_LIMITS[provider.category]
                        : 30;
                    const results = await provider.search(query, limit);
                    if (get().query === query) {
                        set((state) => ({
                            resultsByCategory: {
                                ...state.resultsByCategory,
                                [provider.category]: results,
                            },
                        }));
                    }
                } catch {
                    // Silently ignore provider errors
                } finally {
                    onProviderDone();
                }
            };

            if (delay > 0) {
                debounceTimers[key] = setTimeout(run, delay);
            } else {
                run();
            }
        }
    },

    confirmSelection: () => {
        const flat = get().getFlatResults();
        const selected = flat[get().selectedIndex];
        if (selected) {
            selected.action();
            get().close();
        }
    },

    getFlatResults: () => {
        const { resultsByCategory, activeCategory } = get();

        if (activeCategory !== 'all') {
            return resultsByCategory[activeCategory] || [];
        }

        // "all" mode: group by category in priority order
        const flat: SearchResult[] = [];
        for (const cat of CATEGORY_ORDER) {
            const items = resultsByCategory[cat];
            if (items && items.length > 0) {
                flat.push(...items);
            }
        }
        return flat;
    },
}));
