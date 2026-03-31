import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MonacoDiffViewer } from "./MonacoDiffViewer";
import type { DiffEntry } from "@/stores/editor";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockRegisterFtreTheme = vi.fn();
vi.mock("./themeRegistry", () => ({
  registerFtreTheme: (...args: unknown[]) => mockRegisterFtreTheme(...args),
}));

let capturedProps: Record<string, unknown> = {};
let capturedOnMount: ((editor: unknown, monaco: unknown) => void) | undefined;

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: (props: Record<string, unknown>) => {
    capturedProps = props;
    capturedOnMount = props.onMount as typeof capturedOnMount;
    return <div data-testid="mock-diff-editor" />;
  },
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeDiff(overrides?: Partial<DiffEntry>): DiffEntry {
  return {
    id: "tool1:/src/file.ts",
    filePath: "/src/file.ts",
    tabPath: "diff:/src/file.ts",
    originalContent: "const a = 1;",
    newContent: "const a = 2;",
    toolName: "edit",
    isApproximate: false,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("MonacoDiffViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProps = {};
    capturedOnMount = undefined;
  });

  it("renders DiffEditor with correct language, original, and modified content", () => {
    const diff = makeDiff();
    render(<MonacoDiffViewer diff={diff} language="typescript" renderSideBySide={true} />);

    expect(capturedProps.language).toBe("typescript");
    expect(capturedProps.original).toBe(diff.originalContent);
    expect(capturedProps.modified).toBe(diff.newContent);
  });

  it("sets height to 100%", () => {
    render(<MonacoDiffViewer diff={makeDiff()} language="typescript" renderSideBySide={true} />);
    expect(capturedProps.height).toBe("100%");
  });

  it("uses ftre-dark theme", () => {
    render(<MonacoDiffViewer diff={makeDiff()} language="typescript" renderSideBySide={true} />);
    expect(capturedProps.theme).toBe("ftre-dark");
  });

  it("passes renderSideBySide=true to options", () => {
    render(<MonacoDiffViewer diff={makeDiff()} language="typescript" renderSideBySide={true} />);
    const opts = capturedProps.options as Record<string, unknown>;
    expect(opts.renderSideBySide).toBe(true);
  });

  it("passes renderSideBySide=false to options", () => {
    render(<MonacoDiffViewer diff={makeDiff()} language="typescript" renderSideBySide={false} />);
    const opts = capturedProps.options as Record<string, unknown>;
    expect(opts.renderSideBySide).toBe(false);
  });

  it("sets readOnly and originalEditable options for read-only mode", () => {
    render(<MonacoDiffViewer diff={makeDiff()} language="typescript" renderSideBySide={true} />);
    const opts = capturedProps.options as Record<string, unknown>;
    expect(opts.readOnly).toBe(true);
    expect(opts.originalEditable).toBe(false);
  });

  it("uses consistent font configuration with MonacoEditor", () => {
    render(<MonacoDiffViewer diff={makeDiff()} language="typescript" renderSideBySide={true} />);
    const opts = capturedProps.options as Record<string, unknown>;
    expect(opts.fontSize).toBe(14);
    expect(opts.fontFamily).toBe("'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace");
    expect(opts.lineHeight).toBe(22);
  });

  it("disables minimap and scrollBeyondLastLine", () => {
    render(<MonacoDiffViewer diff={makeDiff()} language="typescript" renderSideBySide={true} />);
    const opts = capturedProps.options as Record<string, unknown>;
    expect(opts.minimap).toEqual({ enabled: false });
    expect(opts.scrollBeyondLastLine).toBe(false);
  });

  it("enables automaticLayout", () => {
    render(<MonacoDiffViewer diff={makeDiff()} language="typescript" renderSideBySide={true} />);
    const opts = capturedProps.options as Record<string, unknown>;
    expect(opts.automaticLayout).toBe(true);
  });

  it("configures scrollbar sizes", () => {
    render(<MonacoDiffViewer diff={makeDiff()} language="typescript" renderSideBySide={true} />);
    const opts = capturedProps.options as Record<string, unknown>;
    expect(opts.scrollbar).toEqual({
      verticalScrollbarSize: 5,
      horizontalScrollbarSize: 5,
    });
  });

  it("passes keepCurrentOriginalModel and keepCurrentModifiedModel to prevent premature model disposal", () => {
    render(<MonacoDiffViewer diff={makeDiff()} language="typescript" renderSideBySide={true} />);
    expect(capturedProps.keepCurrentOriginalModel).toBe(true);
    expect(capturedProps.keepCurrentModifiedModel).toBe(true);
  });

  describe("onMount callback", () => {
    function makeMockDiffEditor() {
      return {
        getOriginalEditor: () => ({ getModel: () => ({ dispose: vi.fn() }) }),
        getModifiedEditor: () => ({ getModel: () => ({ dispose: vi.fn() }) }),
      };
    }

    it("calls registerFtreTheme with the monaco instance", () => {
      render(<MonacoDiffViewer diff={makeDiff()} language="typescript" renderSideBySide={true} />);

      const mockMonaco = {
        editor: { setTheme: vi.fn(), setModelLanguage: vi.fn() },
      };
      capturedOnMount?.(makeMockDiffEditor(), mockMonaco);

      expect(mockRegisterFtreTheme).toHaveBeenCalledOnce();
      expect(mockRegisterFtreTheme).toHaveBeenCalledWith(mockMonaco);
    });

    it("sets the ftre-dark theme after registration", () => {
      render(<MonacoDiffViewer diff={makeDiff()} language="typescript" renderSideBySide={true} />);

      const setTheme = vi.fn();
      const mockMonaco = { editor: { setTheme, setModelLanguage: vi.fn() } };
      capturedOnMount?.(makeMockDiffEditor(), mockMonaco);

      expect(setTheme).toHaveBeenCalledWith("ftre-dark");
    });
  });

  describe("unmount cleanup", () => {
    it("disposes models on unmount to prevent memory leak", () => {
      const disposeOriginal = vi.fn();
      const disposeModified = vi.fn();
      const mockEditor = {
        getOriginalEditor: () => ({ getModel: () => ({ dispose: disposeOriginal }) }),
        getModifiedEditor: () => ({ getModel: () => ({ dispose: disposeModified }) }),
      };

      const { unmount } = render(<MonacoDiffViewer diff={makeDiff()} language="typescript" renderSideBySide={true} />);

      // 触发 onMount 回调，注入 mock editor
      const mockMonaco = {
        editor: { setTheme: vi.fn(), setModelLanguage: vi.fn() },
      };
      capturedOnMount?.(mockEditor, mockMonaco);

      unmount();

      expect(disposeOriginal).toHaveBeenCalledOnce();
      expect(disposeModified).toHaveBeenCalledOnce();
    });
  });
});
