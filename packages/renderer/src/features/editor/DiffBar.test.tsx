import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { computeDiffStats, DiffBar } from "@ftre/editor/ui";
import type { DiffEntry } from "@ftre/editor/store";

// Mock window.desktop.fs so acceptDiff/rejectDiff don't throw
beforeEach(() => {
  (window as any).desktop = {
    fs: {
      writeFile: vi.fn().mockResolvedValue({ success: true }),
      readFile: vi.fn().mockResolvedValue({ content: "", error: null }),
    },
  };
});

// ── computeDiffStats unit tests ──────────────────────────────────────

describe("computeDiffStats", () => {
  it("returns 0/0 for identical content", () => {
    const result = computeDiffStats("hello\nworld", "hello\nworld");
    expect(result).toEqual({ additions: 0, deletions: 0 });
  });

  it("returns 0/0 for two empty strings", () => {
    const result = computeDiffStats("", "");
    expect(result).toEqual({ additions: 0, deletions: 0 });
  });

  it("counts added lines when modified has more lines", () => {
    const result = computeDiffStats("a\nb", "a\nb\nc\nd");
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(0);
  });

  it("counts deleted lines when original has more lines", () => {
    const result = computeDiffStats("a\nb\nc\nd", "a\nb");
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(2);
  });

  it("counts changed lines as both addition and deletion", () => {
    const result = computeDiffStats("line1\nline2", "line1\nchanged");
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
  });

  it("handles completely different content", () => {
    const result = computeDiffStats("a\nb\nc", "x\ny\nz");
    expect(result.additions).toBe(3);
    expect(result.deletions).toBe(3);
  });

  it("handles original empty, modified has content", () => {
    const result = computeDiffStats("", "new line");
    // "" splits to [""], "new line" splits to ["new line"]
    // Line 0: "" !== "new line" → +1, -1
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
  });

  it("handles original has content, modified empty", () => {
    const result = computeDiffStats("old line", "");
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
  });

  it("handles mixed changes: some same, some different, some added", () => {
    const original = "keep\nchange\nremove";
    const modified = "keep\nchanged\nadd1\nadd2";
    const result = computeDiffStats(original, modified);
    // Line 0: keep === keep → no change
    // Line 1: change !== changed → +1, -1
    // Line 2: remove !== add1 → +1, -1
    // Line 3: original has no line 3, modified has add2 → +1
    expect(result.additions).toBe(3);
    expect(result.deletions).toBe(2);
  });
});

// ── DiffBar component tests ─────────────────────────────────────────

function createDiff(
  options: {
    filePath?: string;
    isApproximate?: boolean;
    originalContent?: string;
    newContent?: string;
  } = {},
): DiffEntry {
  const filePath = options.filePath ?? "/src/test.ts";
  const tabPath = `diff:${filePath}`;
  const originalContent = options.originalContent ?? "line1\nline2";
  const newContent = options.newContent ?? "line1\nline2\nline3";

  return {
    id: `tool1:${filePath}`,
    filePath,
    tabPath,
    originalContent,
    newContent,
    toolName: "edit",
    isApproximate: options.isApproximate ?? false,
  };
}

describe("DiffBar component", () => {
  it("renders diff bar with diff prop", () => {
    const diff = createDiff();
    render(<DiffBar diff={diff} />);
    expect(screen.getByTestId("diff-bar")).toBeTruthy();
  });

  it("displays diff stats with additions and deletions", () => {
    const diff = createDiff({ originalContent: "a\nb", newContent: "a\nb\nc" });
    render(<DiffBar diff={diff} />);
    expect(screen.getByTestId("diff-additions").textContent).toBe("+1");
    expect(screen.getByTestId("diff-deletions").textContent).toBe("-0");
  });

  it("displays correct stats for changed lines", () => {
    const diff = createDiff({ originalContent: "old", newContent: "new" });
    render(<DiffBar diff={diff} />);
    expect(screen.getByTestId("diff-additions").textContent).toBe("+1");
    expect(screen.getByTestId("diff-deletions").textContent).toBe("-1");
  });

  it("shows mode toggle button", () => {
    const diff = createDiff();
    render(<DiffBar diff={diff} />);
    expect(screen.getByTestId("diff-toggle-mode")).toBeTruthy();
  });

  it("calls onToggleMode when mode toggle is clicked", () => {
    const diff = createDiff();
    const onToggle = vi.fn();
    render(
      <DiffBar diff={diff} renderSideBySide={true} onToggleMode={onToggle} />,
    );
    fireEvent.click(screen.getByTestId("diff-toggle-mode"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenSourceFile when open file button is clicked", () => {
    const diff = createDiff({ filePath: "/src/myfile.ts" });
    const onOpenSourceFile = vi.fn();
    render(<DiffBar diff={diff} onOpenSourceFile={onOpenSourceFile} />);
    fireEvent.click(screen.getByTestId("diff-open-file"));
    expect(onOpenSourceFile).toHaveBeenCalledTimes(1);
    expect(onOpenSourceFile).toHaveBeenCalledWith("/src/myfile.ts");
  });

  it("does NOT show approximate warning when isApproximate is false", () => {
    const diff = createDiff({ isApproximate: false });
    render(<DiffBar diff={diff} />);
    expect(screen.queryByTestId("diff-approximate-warning")).toBeNull();
  });

  it("shows yellow warning when isApproximate is true", () => {
    const diff = createDiff({ isApproximate: true });
    render(<DiffBar diff={diff} />);
    const warning = screen.getByTestId("diff-approximate-warning");
    expect(warning).toBeTruthy();
    expect(warning.className).toContain("text-yellow-400");
  });

  it("displays tool name", () => {
    const diff = createDiff();
    render(<DiffBar diff={diff} />);
    expect(screen.getByText("edit")).toBeTruthy();
  });
});
