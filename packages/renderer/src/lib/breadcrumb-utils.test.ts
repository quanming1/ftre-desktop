import { describe, it, expect } from 'vitest';
import { parseBreadcrumbSegments, type BreadcrumbSegment } from './breadcrumb-utils';

describe('parseBreadcrumbSegments — Unix paths', () => {
    it('parses a simple file path into root + file segments', () => {
        const result = parseBreadcrumbSegments('/projects/myapp/index.ts', '/projects/myapp');
        expect(result).toEqual([
            { name: 'myapp', path: '/projects/myapp', isDir: true },
            { name: 'index.ts', path: '/projects/myapp/index.ts', isDir: false },
        ]);
    });

    it('parses a nested file path with intermediate directories', () => {
        const result = parseBreadcrumbSegments(
            '/projects/myapp/src/lib/utils.ts',
            '/projects/myapp',
        );
        expect(result).toEqual([
            { name: 'myapp', path: '/projects/myapp', isDir: true },
            { name: 'src', path: '/projects/myapp/src', isDir: true },
            { name: 'lib', path: '/projects/myapp/src/lib', isDir: true },
            { name: 'utils.ts', path: '/projects/myapp/src/lib/utils.ts', isDir: false },
        ]);
    });

    it('marks all segments except the last as directories', () => {
        const result = parseBreadcrumbSegments('/root/a/b/c/file.txt', '/root');
        const dirs = result.slice(0, -1);
        const file = result[result.length - 1];

        for (const seg of dirs) {
            expect(seg.isDir).toBe(true);
        }
        expect(file.isDir).toBe(false);
    });

    it('first segment name is the root directory name', () => {
        const result = parseBreadcrumbSegments('/home/user/project/src/app.ts', '/home/user/project');
        expect(result[0].name).toBe('project');
        expect(result[0].isDir).toBe(true);
    });

    it('last segment name is the file name', () => {
        const result = parseBreadcrumbSegments('/root/src/main.tsx', '/root');
        expect(result[result.length - 1].name).toBe('main.tsx');
        expect(result[result.length - 1].isDir).toBe(false);
    });
});

describe('parseBreadcrumbSegments — Windows paths', () => {
    it('handles Windows backslash separators', () => {
        const result = parseBreadcrumbSegments(
            'C:\\Users\\dev\\project\\src\\index.ts',
            'C:\\Users\\dev\\project',
        );
        expect(result).toEqual([
            { name: 'project', path: 'C:/Users/dev/project', isDir: true },
            { name: 'src', path: 'C:/Users/dev/project/src', isDir: true },
            { name: 'index.ts', path: 'C:/Users/dev/project/src/index.ts', isDir: false },
        ]);
    });

    it('handles mixed separators', () => {
        const result = parseBreadcrumbSegments(
            'C:\\Users/dev\\project/src/app.ts',
            'C:\\Users/dev\\project',
        );
        expect(result).toEqual([
            { name: 'project', path: 'C:/Users/dev/project', isDir: true },
            { name: 'src', path: 'C:/Users/dev/project/src', isDir: true },
            { name: 'app.ts', path: 'C:/Users/dev/project/src/app.ts', isDir: false },
        ]);
    });
});

describe('parseBreadcrumbSegments — edge cases', () => {
    it('returns single file segment when filePath is outside rootPath', () => {
        const result = parseBreadcrumbSegments('/other/path/file.ts', '/projects/myapp');
        expect(result).toEqual([
            { name: 'file.ts', path: '/other/path/file.ts', isDir: false },
        ]);
    });

    it('returns single file segment for completely unrelated paths', () => {
        const result = parseBreadcrumbSegments('D:\\work\\file.js', 'C:\\projects\\app');
        expect(result).toEqual([
            { name: 'file.js', path: 'D:\\work\\file.js', isDir: false },
        ]);
    });

    it('handles root path with trailing slash', () => {
        const result = parseBreadcrumbSegments('/root/file.ts', '/root/');
        expect(result).toEqual([
            { name: 'root', path: '/root', isDir: true },
            { name: 'file.ts', path: '/root/file.ts', isDir: false },
        ]);
    });

    it('handles filePath equal to rootPath', () => {
        const result = parseBreadcrumbSegments('/projects/myapp', '/projects/myapp');
        expect(result).toEqual([
            { name: 'myapp', path: '/projects/myapp', isDir: true },
        ]);
    });

    it('does not treat partial prefix match as inside root', () => {
        // /projects/myapp-v2 should NOT be treated as inside /projects/myapp
        const result = parseBreadcrumbSegments('/projects/myapp-v2/file.ts', '/projects/myapp');
        expect(result).toEqual([
            { name: 'file.ts', path: '/projects/myapp-v2/file.ts', isDir: false },
        ]);
    });

    it('handles deeply nested paths', () => {
        const result = parseBreadcrumbSegments(
            '/root/a/b/c/d/e/f.ts',
            '/root',
        );
        expect(result).toHaveLength(7); // root + a + b + c + d + e + f.ts
        expect(result[0]).toEqual({ name: 'root', path: '/root', isDir: true });
        expect(result[6]).toEqual({ name: 'f.ts', path: '/root/a/b/c/d/e/f.ts', isDir: false });
    });

    it('each segment path builds correctly on the previous', () => {
        const result = parseBreadcrumbSegments('/root/src/lib/utils.ts', '/root');
        expect(result[0].path).toBe('/root');
        expect(result[1].path).toBe('/root/src');
        expect(result[2].path).toBe('/root/src/lib');
        expect(result[3].path).toBe('/root/src/lib/utils.ts');
    });
});
