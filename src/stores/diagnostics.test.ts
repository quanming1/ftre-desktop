import { describe, it, expect, beforeEach } from "vitest";
import { useDiagnostics, type Diagnostic } from "./diagnostics";

function makeDiag(overrides: Partial<Diagnostic> = {}): Diagnostic {
    return {
        filePath: "/src/index.ts",
        fileName: "index.ts",
        severity: "error",
        message: "Type error",
        startLine: 1,
        startCol: 1,
        endLine: 1,
        endCol: 10,
        ...overrides,
    };
}

describe("diagnostics store", () => {
    beforeEach(() => {
        useDiagnostics.getState().clear();
    });

    it("starts with empty diagnostics", () => {
        expect(useDiagnostics.getState().byFile).toEqual({});
        expect(useDiagnostics.getState().errorCount()).toBe(0);
        expect(useDiagnostics.getState().warningCount()).toBe(0);
    });

    it("setAll groups diagnostics by file path", () => {
        const diagnostics: Diagnostic[] = [
            makeDiag({ filePath: "/a.ts", fileName: "a.ts" }),
            makeDiag({ filePath: "/a.ts", fileName: "a.ts", severity: "warning", message: "Unused var" }),
            makeDiag({ filePath: "/b.ts", fileName: "b.ts" }),
        ];
        useDiagnostics.getState().setAll(diagnostics);

        const { byFile } = useDiagnostics.getState();
        expect(Object.keys(byFile)).toHaveLength(2);
        expect(byFile["/a.ts"]).toHaveLength(2);
        expect(byFile["/b.ts"]).toHaveLength(1);
    });

    it("errorCount counts only errors", () => {
        useDiagnostics.getState().setAll([
            makeDiag({ severity: "error" }),
            makeDiag({ severity: "warning" }),
            makeDiag({ severity: "error", filePath: "/b.ts" }),
            makeDiag({ severity: "info", filePath: "/c.ts" }),
        ]);
        expect(useDiagnostics.getState().errorCount()).toBe(2);
    });

    it("warningCount counts only warnings", () => {
        useDiagnostics.getState().setAll([
            makeDiag({ severity: "error" }),
            makeDiag({ severity: "warning" }),
            makeDiag({ severity: "warning", filePath: "/b.ts" }),
        ]);
        expect(useDiagnostics.getState().warningCount()).toBe(2);
    });

    it("setAll replaces previous diagnostics", () => {
        useDiagnostics.getState().setAll([makeDiag()]);
        expect(useDiagnostics.getState().errorCount()).toBe(1);

        useDiagnostics.getState().setAll([makeDiag({ severity: "warning" })]);
        expect(useDiagnostics.getState().errorCount()).toBe(0);
        expect(useDiagnostics.getState().warningCount()).toBe(1);
    });

    it("clear removes all diagnostics", () => {
        useDiagnostics.getState().setAll([makeDiag(), makeDiag({ filePath: "/b.ts" })]);
        expect(Object.keys(useDiagnostics.getState().byFile)).toHaveLength(2);

        useDiagnostics.getState().clear();
        expect(useDiagnostics.getState().byFile).toEqual({});
        expect(useDiagnostics.getState().errorCount()).toBe(0);
    });
});
