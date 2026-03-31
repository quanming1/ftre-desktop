import { create } from 'zustand';

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface Diagnostic {
    filePath: string;
    fileName: string;
    severity: DiagnosticSeverity;
    message: string;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
    source?: string;
}

export interface DiagnosticsState {
    /** All diagnostics grouped by file path */
    byFile: Record<string, Diagnostic[]>;

    /** Set diagnostics for all files (replaces entire state) */
    setAll: (diagnostics: Diagnostic[]) => void;

    /** Clear all diagnostics */
    clear: () => void;

    /** Get total error count */
    errorCount: () => number;

    /** Get total warning count */
    warningCount: () => number;
}

export const useDiagnostics = create<DiagnosticsState>((set, get) => ({
    byFile: {},

    setAll: (diagnostics) => {
        const byFile: Record<string, Diagnostic[]> = {};
        for (const d of diagnostics) {
            if (!byFile[d.filePath]) byFile[d.filePath] = [];
            byFile[d.filePath].push(d);
        }
        set({ byFile });
    },

    clear: () => set({ byFile: {} }),

    errorCount: () => {
        const { byFile } = get();
        let count = 0;
        for (const diagnostics of Object.values(byFile)) {
            count += diagnostics.filter((d) => d.severity === 'error').length;
        }
        return count;
    },

    warningCount: () => {
        const { byFile } = get();
        let count = 0;
        for (const diagnostics of Object.values(byFile)) {
            count += diagnostics.filter((d) => d.severity === 'warning').length;
        }
        return count;
    },
}));
