import { describe, it, expect } from 'vitest';
import type { ToolCallMessage } from '@/types/chat';
import {
    getToolDisplayInfo,
    getToolSummary,
    getToolFilePath,
    TOOL_CATEGORY_MAP,
} from './toolClassification';

/** Helper to build a minimal ToolCallMessage */
function makeMsg(
    name: string,
    args: Record<string, unknown> = {},
    status: ToolCallMessage['status'] = 'completed',
): ToolCallMessage {
    return {
        id: `msg-1`,
        role: 'tool',
        toolId: `tool-1`,
        name,
        arguments: args,
        status,
    };
}

// ─── getToolFilePath ────────────────────────────────────────────────

describe('getToolFilePath', () => {
    it('returns filePath when present as a non-empty string', () => {
        expect(getToolFilePath(makeMsg('read', { filePath: 'src/index.ts' }))).toBe('src/index.ts');
    });

    it('returns null when filePath is missing', () => {
        expect(getToolFilePath(makeMsg('read', {}))).toBeNull();
    });

    it('returns null when filePath is empty string', () => {
        expect(getToolFilePath(makeMsg('read', { filePath: '' }))).toBeNull();
    });

    it('returns null when filePath is not a string', () => {
        expect(getToolFilePath(makeMsg('read', { filePath: 42 }))).toBeNull();
    });
});

// ─── getToolSummary ─────────────────────────────────────────────────

describe('getToolSummary', () => {
    it('returns basename for file-read tool', () => {
        expect(getToolSummary(makeMsg('read', { filePath: '/home/user/src/index.ts' }))).toBe('index.ts');
    });

    it('returns basename for file-write tool', () => {
        expect(getToolSummary(makeMsg('write', { filePath: 'C:\\Users\\dev\\app.tsx' }))).toBe('app.tsx');
    });

    it('returns basename for file-edit tool', () => {
        expect(getToolSummary(makeMsg('edit', { filePath: 'src/utils.ts' }))).toBe('utils.ts');
    });

    it('returns tool name when file tool has no filePath', () => {
        expect(getToolSummary(makeMsg('read', {}))).toBe('read');
    });

    it('truncates bash command to 60 chars with ellipsis', () => {
        const longCmd = 'a'.repeat(80);
        const summary = getToolSummary(makeMsg('bash', { command: longCmd }));
        expect(summary).toBe('a'.repeat(60) + '…');
    });

    it('returns full bash command when <= 60 chars', () => {
        expect(getToolSummary(makeMsg('bash', { command: 'npm install' }))).toBe('npm install');
    });

    it('returns tool name when bash has no command', () => {
        expect(getToolSummary(makeMsg('bash', {}))).toBe('bash');
    });

    it('returns pattern for glob tool', () => {
        expect(getToolSummary(makeMsg('glob', { pattern: '**/*.ts' }))).toBe('**/*.ts');
    });

    it('returns pattern for grep tool', () => {
        expect(getToolSummary(makeMsg('grep', { pattern: 'TODO' }))).toBe('TODO');
    });

    it('returns tool name for search tool without pattern', () => {
        expect(getToolSummary(makeMsg('grep', {}))).toBe('grep');
    });

    it('returns tool name for unknown tool', () => {
        expect(getToolSummary(makeMsg('unknown_tool', {}))).toBe('unknown_tool');
    });
});

// ─── getToolDisplayInfo ─────────────────────────────────────────────

describe('getToolDisplayInfo', () => {
    describe('category mapping', () => {
        it.each([
            ['read', 'file-read'],
            ['write', 'file-write'],
            ['edit', 'file-edit'],
            ['bash', 'command'],
            ['glob', 'search'],
            ['grep', 'search'],
        ] as const)('maps %s → %s', (toolName, expectedCategory) => {
            const info = getToolDisplayInfo(makeMsg(toolName, { filePath: 'f.ts', oldString: 'a', newString: 'b' }));
            expect(info.category).toBe(expectedCategory);
        });

        it('defaults unknown tool to command', () => {
            const info = getToolDisplayInfo(makeMsg('unknown', {}));
            expect(info.category).toBe('command');
        });
    });

    describe('icon mapping', () => {
        it('returns file-text for read', () => {
            expect(getToolDisplayInfo(makeMsg('read', { filePath: 'f.ts' })).icon).toBe('file-text');
        });

        it('returns terminal for bash', () => {
            expect(getToolDisplayInfo(makeMsg('bash', {})).icon).toBe('terminal');
        });

        it('returns search for grep', () => {
            expect(getToolDisplayInfo(makeMsg('grep', {})).icon).toBe('search');
        });
    });

    describe('hasAction logic (Requirement 8.2)', () => {
        it('is true for read with filePath', () => {
            expect(getToolDisplayInfo(makeMsg('read', { filePath: 'src/a.ts' })).hasAction).toBe(true);
        });

        it('is true for write with filePath', () => {
            expect(getToolDisplayInfo(makeMsg('write', { filePath: 'src/a.ts' })).hasAction).toBe(true);
        });

        it('is false for read without filePath', () => {
            expect(getToolDisplayInfo(makeMsg('read', {})).hasAction).toBe(false);
        });

        it('is true for edit with filePath, oldString, and newString', () => {
            const info = getToolDisplayInfo(makeMsg('edit', {
                filePath: 'src/a.ts',
                oldString: 'foo',
                newString: 'bar',
            }));
            expect(info.hasAction).toBe(true);
        });

        it('is false for edit missing oldString', () => {
            const info = getToolDisplayInfo(makeMsg('edit', {
                filePath: 'src/a.ts',
                newString: 'bar',
            }));
            expect(info.hasAction).toBe(false);
        });

        it('is false for edit missing newString', () => {
            const info = getToolDisplayInfo(makeMsg('edit', {
                filePath: 'src/a.ts',
                oldString: 'foo',
            }));
            expect(info.hasAction).toBe(false);
        });

        it('is false for edit missing filePath', () => {
            const info = getToolDisplayInfo(makeMsg('edit', {
                oldString: 'foo',
                newString: 'bar',
            }));
            expect(info.hasAction).toBe(false);
        });

        it('is false for bash', () => {
            expect(getToolDisplayInfo(makeMsg('bash', { command: 'ls' })).hasAction).toBe(false);
        });

        it('is false for glob', () => {
            expect(getToolDisplayInfo(makeMsg('glob', { pattern: '*' })).hasAction).toBe(false);
        });

        it('is false for grep', () => {
            expect(getToolDisplayInfo(makeMsg('grep', { pattern: 'x' })).hasAction).toBe(false);
        });
    });

    describe('actionLabel', () => {
        it('returns 打开文件 for read', () => {
            expect(getToolDisplayInfo(makeMsg('read', { filePath: 'f.ts' })).actionLabel).toBe('打开文件');
        });

        it('returns 查看差异 for edit', () => {
            const info = getToolDisplayInfo(makeMsg('edit', { filePath: 'f.ts', oldString: 'a', newString: 'b' }));
            expect(info.actionLabel).toBe('查看差异');
        });

        it('returns empty string for bash', () => {
            expect(getToolDisplayInfo(makeMsg('bash', {})).actionLabel).toBe('');
        });
    });
});
