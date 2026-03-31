import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = { rootPath: null as string | null };

vi.mock('@/stores/workspace', () => ({
    useWorkspace: {
        getState: () => mockState,
    },
}));

import { resolveFilePath, normalizePath, basename } from './pathUtils';

beforeEach(() => {
    mockState.rootPath = null;
});

describe('normalizePath', () => {
    it('unifies backslashes to forward slashes', () => {
        expect(normalizePath('C:\\Users\\dev\\file.ts')).toBe('C:/Users/dev/file.ts');
    });

    it('resolves single dot segments', () => {
        expect(normalizePath('/home/./user/./file.ts')).toBe('/home/user/file.ts');
    });

    it('resolves double dot segments', () => {
        expect(normalizePath('/home/user/../dev/file.ts')).toBe('/home/dev/file.ts');
    });

    it('resolves mixed . and .. segments', () => {
        expect(normalizePath('/a/b/./c/../d/file.ts')).toBe('/a/b/d/file.ts');
    });

    it('preserves Windows drive letter prefix', () => {
        expect(normalizePath('D:\\projects\\app')).toBe('D:/projects/app');
    });

    it('preserves Unix root prefix', () => {
        expect(normalizePath('/usr/local/bin')).toBe('/usr/local/bin');
    });

    it('removes redundant slashes', () => {
        expect(normalizePath('/home//user///file.ts')).toBe('/home/user/file.ts');
    });

    it('handles path with only dots', () => {
        expect(normalizePath('/a/b/../../c')).toBe('/c');
    });

    it('handles Windows path with mixed separators', () => {
        expect(normalizePath('C:/Users\\dev/./project\\..\\file.ts')).toBe('C:/Users/dev/file.ts');
    });
});

describe('basename', () => {
    it('extracts filename from Unix path', () => {
        expect(basename('/home/user/file.ts')).toBe('file.ts');
    });

    it('extracts filename from Windows path', () => {
        expect(basename('C:\\Users\\dev\\file.ts')).toBe('file.ts');
    });

    it('returns the string itself if no separator', () => {
        expect(basename('file.ts')).toBe('file.ts');
    });

    it('handles trailing separator', () => {
        expect(basename('/home/user/')).toBe('');
    });

    it('handles mixed separators', () => {
        expect(basename('C:/Users\\dev/file.ts')).toBe('file.ts');
    });
});

describe('resolveFilePath', () => {
    it('normalizes absolute Unix path directly', () => {
        expect(resolveFilePath('/home/user/./file.ts')).toBe('/home/user/file.ts');
    });

    it('normalizes absolute Windows path directly', () => {
        expect(resolveFilePath('C:\\Users\\dev\\file.ts')).toBe('C:/Users/dev/file.ts');
    });

    it('returns original relative path and warns when rootPath is not set', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const result = resolveFilePath('src/file.ts');
        expect(result).toBe('src/file.ts');
        expect(warnSpy).toHaveBeenCalledWith(
            '[pathUtils] rootPath 未设置，无法解析相对路径:',
            'src/file.ts'
        );
        warnSpy.mockRestore();
    });

    it('joins relative path with rootPath', () => {
        mockState.rootPath = '/workspace/project';
        expect(resolveFilePath('src/file.ts')).toBe('/workspace/project/src/file.ts');
    });

    it('strips trailing slash from rootPath before joining', () => {
        mockState.rootPath = '/workspace/project/';
        expect(resolveFilePath('src/file.ts')).toBe('/workspace/project/src/file.ts');
    });

    it('strips trailing backslash from rootPath before joining', () => {
        mockState.rootPath = 'C:\\workspace\\project\\';
        expect(resolveFilePath('src/file.ts')).toBe('C:/workspace/project/src/file.ts');
    });

    it('resolves .. in relative path against rootPath', () => {
        mockState.rootPath = '/workspace/project';
        expect(resolveFilePath('../other/file.ts')).toBe('/workspace/other/file.ts');
    });

    it('does not join absolute path even when rootPath is set', () => {
        mockState.rootPath = '/workspace/project';
        expect(resolveFilePath('/usr/local/file.ts')).toBe('/usr/local/file.ts');
    });

    it('does not join Windows absolute path even when rootPath is set', () => {
        mockState.rootPath = '/workspace/project';
        expect(resolveFilePath('D:\\other\\file.ts')).toBe('D:/other/file.ts');
    });
});
