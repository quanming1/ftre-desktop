import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSearch, SearchOptions } from './search';
import { useWorkspace } from './workspace';

const defaultOptions: SearchOptions = {
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    includePattern: '',
    excludePattern: '',
};

beforeEach(() => {
    useSearch.setState({
        query: '',
        results: [],
        isSearching: false,
        options: { ...defaultOptions },
    });
    // Set up workspace rootPath for search
    useWorkspace.setState({ rootPath: '/project' });
    // Clean up any desktop mock
    delete (window as any).desktop;
});

describe('search store — defaults', () => {
    it('has correct default values', () => {
        const s = useSearch.getState();
        expect(s.query).toBe('');
        expect(s.results).toEqual([]);
        expect(s.isSearching).toBe(false);
        expect(s.options).toEqual(defaultOptions);
    });
});

describe('search store — setQuery', () => {
    it('updates the query string', () => {
        useSearch.getState().setQuery('hello');
        expect(useSearch.getState().query).toBe('hello');
    });

    it('accepts empty string', () => {
        useSearch.getState().setQuery('something');
        useSearch.getState().setQuery('');
        expect(useSearch.getState().query).toBe('');
    });
});

describe('search store — setOption', () => {
    it('updates a boolean option', () => {
        useSearch.getState().setOption('caseSensitive', true);
        expect(useSearch.getState().options.caseSensitive).toBe(true);
    });

    it('updates a string option', () => {
        useSearch.getState().setOption('includePattern', '**/*.ts');
        expect(useSearch.getState().options.includePattern).toBe('**/*.ts');
    });

    it('preserves other options when updating one', () => {
        useSearch.getState().setOption('wholeWord', true);
        useSearch.getState().setOption('useRegex', true);
        const opts = useSearch.getState().options;
        expect(opts.wholeWord).toBe(true);
        expect(opts.useRegex).toBe(true);
        expect(opts.caseSensitive).toBe(false);
    });
});

describe('search store — executeSearch', () => {
    it('sets results to empty and does not search when query is empty', async () => {
        useSearch.getState().setQuery('');
        await useSearch.getState().executeSearch();
        const s = useSearch.getState();
        expect(s.results).toEqual([]);
        expect(s.isSearching).toBe(false);
    });

    it('sets results to empty and does not search when query is whitespace', async () => {
        useSearch.getState().setQuery('   ');
        await useSearch.getState().executeSearch();
        const s = useSearch.getState();
        expect(s.results).toEqual([]);
        expect(s.isSearching).toBe(false);
    });

    it('returns empty results when desktop API is not available', async () => {
        useSearch.getState().setQuery('test');
        await useSearch.getState().executeSearch();
        const s = useSearch.getState();
        expect(s.results).toEqual([]);
        expect(s.isSearching).toBe(false);
    });

    it('calls desktop.fs.search with rootPath, query and options', async () => {
        const mockResults = [
            {
                filePath: '/src/index.ts',
                fileName: 'index.ts',
                matches: [
                    {
                        lineNumber: 1,
                        lineContent: 'const test = 1;',
                        matchStart: 6,
                        matchEnd: 10,
                    },
                ],
            },
        ];
        const search = vi.fn().mockResolvedValue({ results: mockResults });
        (window as any).desktop = { fs: { search } };

        useSearch.getState().setQuery('test');
        useSearch.getState().setOption('caseSensitive', true);
        await useSearch.getState().executeSearch();

        expect(search).toHaveBeenCalledWith('/project', 'test', {
            ...defaultOptions,
            caseSensitive: true,
        });
        const s = useSearch.getState();
        expect(s.results).toEqual(mockResults);
        expect(s.isSearching).toBe(false);
    });

    it('handles desktop.fs.search rejection gracefully', async () => {
        const search = vi.fn().mockRejectedValue(new Error('IPC error'));
        (window as any).desktop = { fs: { search } };

        useSearch.getState().setQuery('test');
        await useSearch.getState().executeSearch();

        const s = useSearch.getState();
        expect(s.results).toEqual([]);
        expect(s.isSearching).toBe(false);
    });
});

describe('search store — clearResults', () => {
    it('resets query, results, and isSearching', () => {
        useSearch.setState({
            query: 'hello',
            results: [
                {
                    filePath: '/a.ts',
                    fileName: 'a.ts',
                    matches: [],
                },
            ],
            isSearching: true,
        });

        useSearch.getState().clearResults();
        const s = useSearch.getState();
        expect(s.query).toBe('');
        expect(s.results).toEqual([]);
        expect(s.isSearching).toBe(false);
    });

    it('preserves search options after clearing', () => {
        useSearch.getState().setOption('caseSensitive', true);
        useSearch.getState().setOption('excludePattern', 'node_modules');
        useSearch.getState().clearResults();

        const opts = useSearch.getState().options;
        expect(opts.caseSensitive).toBe(true);
        expect(opts.excludePattern).toBe('node_modules');
    });
});
