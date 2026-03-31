/**
 * Lightweight unified diff generator.
 * Produces GitHub-style diff hunks from two strings (before / after).
 * No external dependencies.
 */

export interface DiffLine {
    type: 'context' | 'add' | 'remove';
    content: string;
    /** Original line number (1-based), null for added lines */
    oldLineNo: number | null;
    /** New line number (1-based), null for removed lines */
    newLineNo: number | null;
}

export interface DiffHunk {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: DiffLine[];
}

export interface UnifiedDiff {
    hunks: DiffHunk[];
    additions: number;
    deletions: number;
}

/**
 * Compute a unified diff between two strings.
 * Uses a simple LCS algorithm on lines, then groups changes into hunks
 * with `contextLines` lines of surrounding context.
 */
export function computeUnifiedDiff(
    before: string,
    after: string,
    contextLines = 3,
): UnifiedDiff {
    const oldLines = before.split('\n');
    const newLines = after.split('\n');

    // Compute LCS table
    const m = oldLines.length;
    const n = newLines.length;

    // For large files, use a simplified approach to avoid O(m*n) memory.
    // Threshold 4M ≈ 2000x2000 lines ≈ ~32MB memory
    if (m * n > 4_000_000) {
        return buildFullReplaceDiff(oldLines, newLines);
    }

    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to produce edit script
    type EditOp = { type: 'equal' | 'insert' | 'delete'; oldIdx: number; newIdx: number };
    const ops: EditOp[] = [];
    let i = m, j = n;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            ops.push({ type: 'equal', oldIdx: i - 1, newIdx: j - 1 });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            ops.push({ type: 'insert', oldIdx: -1, newIdx: j - 1 });
            j--;
        } else {
            ops.push({ type: 'delete', oldIdx: i - 1, newIdx: -1 });
            i--;
        }
    }

    ops.reverse();

    // Convert ops to raw diff lines
    const rawLines: { type: 'context' | 'add' | 'remove'; content: string; oldLine: number; newLine: number }[] = [];
    let oldLineNo = 0;
    let newLineNo = 0;

    for (const op of ops) {
        if (op.type === 'equal') {
            oldLineNo++;
            newLineNo++;
            rawLines.push({ type: 'context', content: oldLines[op.oldIdx], oldLine: oldLineNo, newLine: newLineNo });
        } else if (op.type === 'delete') {
            oldLineNo++;
            rawLines.push({ type: 'remove', content: oldLines[op.oldIdx], oldLine: oldLineNo, newLine: 0 });
        } else {
            newLineNo++;
            rawLines.push({ type: 'add', content: newLines[op.newIdx], oldLine: 0, newLine: newLineNo });
        }
    }

    // Group into hunks with context
    const changeIndices: number[] = [];
    for (let k = 0; k < rawLines.length; k++) {
        if (rawLines[k].type !== 'context') changeIndices.push(k);
    }

    if (changeIndices.length === 0) {
        return { hunks: [], additions: 0, deletions: 0 };
    }

    let additions = 0;
    let deletions = 0;
    const hunks: DiffHunk[] = [];

    // Merge change ranges that are within contextLines*2 of each other
    let rangeStart = changeIndices[0];
    let rangeEnd = changeIndices[0];

    const flushHunk = (start: number, end: number) => {
        const hunkStart = Math.max(0, start - contextLines);
        const hunkEnd = Math.min(rawLines.length - 1, end + contextLines);

        const lines: DiffLine[] = [];

        // Find oldStart/newStart by scanning for the first non-zero line number
        let oldStart = 1, newStart = 1;
        for (let k = hunkStart; k <= hunkEnd; k++) {
            const r = rawLines[k];
            if (r.oldLine > 0) { oldStart = r.oldLine; break; }
        }
        for (let k = hunkStart; k <= hunkEnd; k++) {
            const r = rawLines[k];
            if (r.newLine > 0) { newStart = r.newLine; break; }
        }

        for (let k = hunkStart; k <= hunkEnd; k++) {
            const r = rawLines[k];
            lines.push({
                type: r.type,
                content: r.content,
                oldLineNo: r.type === 'add' ? null : r.oldLine,
                newLineNo: r.type === 'remove' ? null : r.newLine,
            });
            if (r.type === 'add') additions++;
            if (r.type === 'remove') deletions++;
        }

        const oldCount = lines.filter(l => l.type !== 'add').length;
        const newCount = lines.filter(l => l.type !== 'remove').length;

        hunks.push({ oldStart, oldCount, newStart, newCount, lines });
    };

    for (let k = 1; k < changeIndices.length; k++) {
        if (changeIndices[k] - rangeEnd <= contextLines * 2) {
            rangeEnd = changeIndices[k];
        } else {
            flushHunk(rangeStart, rangeEnd);
            rangeStart = changeIndices[k];
            rangeEnd = changeIndices[k];
        }
    }
    flushHunk(rangeStart, rangeEnd);

    return { hunks, additions, deletions };
}

/** Fallback for very large files: show everything as a single remove+add block */
function buildFullReplaceDiff(oldLines: string[], newLines: string[]): UnifiedDiff {
    const lines: DiffLine[] = [];
    for (let i = 0; i < oldLines.length; i++) {
        lines.push({ type: 'remove', content: oldLines[i], oldLineNo: i + 1, newLineNo: null });
    }
    for (let i = 0; i < newLines.length; i++) {
        lines.push({ type: 'add', content: newLines[i], oldLineNo: null, newLineNo: i + 1 });
    }

    return {
        hunks: [{
            oldStart: 1,
            oldCount: oldLines.length,
            newStart: 1,
            newCount: newLines.length,
            lines,
        }],
        additions: newLines.length,
        deletions: oldLines.length,
    };
}
