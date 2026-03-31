import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { StatusBar, formatCursorPosition, getLanguageLabel, SUPPORTED_LANGUAGES } from "./StatusBar";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { useLayout } from "@/stores/layout";
import { useDiagnostics } from "@/stores/diagnostics";

// ── Helpers ──────────────────────────────────────────────────────────

function resetStore() {
  useEditor.setState({
    groups: [{ id: "default", openFiles: [], activeFile: null }],
    activeGroupId: "default",
    recentFiles: [],
    openFiles: [],
    activeFile: null,
    pendingDiffs: [],
  });
}

function openFile(path: string, language = "typescript") {
  useEditor.getState().openFile({
    path,
    name: path.split("/").pop()!,
    language,
    content: `// ${path}`,
  });
}

const defaultProps = {};

// ── Mock setup ───────────────────────────────────────────────────────

const mockGitInfo = vi.fn();

function setupDesktopMock(gitResponse = { branch: "main", changedFiles: 3, isGitRepo: true }) {
  mockGitInfo.mockResolvedValue(gitResponse);
  (window as any).desktop = {
    ...(window as any).desktop,
    git: { info: mockGitInfo },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore();
  useWorkspace.setState({ rootPath: null });
  useLayout.setState({ bottomPanelVisible: false, activeBottomTab: "terminal" });
  useDiagnostics.getState().clear();
  setupDesktopMock();
});

afterEach(() => {
  mockGitInfo.mockReset();
});

describe("formatCursorPosition", () => {
  it("formats line and column correctly", () => {
    expect(formatCursorPosition(1, 1)).toBe("Ln 1, Col 1");
    expect(formatCursorPosition(42, 10)).toBe("Ln 42, Col 10");
    expect(formatCursorPosition(100, 200)).toBe("Ln 100, Col 200");
  });
});

describe("StatusBar — layout", () => {
  it("renders the status bar container", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByTestId("status-bar")).toBeTruthy();
  });

  it("does not render mode switcher or input area", () => {
    render(<StatusBar {...defaultProps} />);
    // Old mode buttons should not exist
    expect(screen.queryByText("Term")).toBeNull();
    expect(screen.queryByText("Find")).toBeNull();
    expect(screen.queryByText("AI")).toBeNull();
    // Old input placeholder should not exist
    expect(screen.queryByPlaceholderText("$ run command...")).toBeNull();
  });

  it("does not render pixel heartbeat animation", () => {
    const { container } = render(<StatusBar {...defaultProps} />);
    // The heartbeat was a set of tiny divs with bg-neon class in a flex container
    const heartbeatBars = container.querySelectorAll(".bg-neon");
    expect(heartbeatBars.length).toBe(0);
  });
});

describe("StatusBar — left side", () => {
  it("displays git branch name when in a git repo", async () => {
    useWorkspace.setState({ rootPath: "/my-project" });
    render(<StatusBar {...defaultProps} />);

    await waitFor(() => {
      const branch = screen.getByTestId("git-branch");
      expect(branch.textContent).toContain("main");
    });
  });

  it("hides git branch when not in a git repo", async () => {
    setupDesktopMock({ branch: null, changedFiles: 0, isGitRepo: false });
    useWorkspace.setState({ rootPath: "/not-a-repo" });
    render(<StatusBar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByTestId("git-branch")).toBeNull();
    });
  });

  it("hides git branch when no workspace is open", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.queryByTestId("git-branch")).toBeNull();
  });

  it("displays actual diagnostic counts from diagnostics store", async () => {
    useDiagnostics.getState().setAll([
      { filePath: "/a.ts", fileName: "a.ts", severity: "error", message: "err", startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      { filePath: "/a.ts", fileName: "a.ts", severity: "warning", message: "warn1", startLine: 2, startCol: 1, endLine: 2, endCol: 1 },
      { filePath: "/b.ts", fileName: "b.ts", severity: "warning", message: "warn2", startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    ]);
    render(<StatusBar {...defaultProps} />);

    const diagnostics = screen.getByTestId("diagnostics");
    expect(diagnostics.textContent).toContain("1");
    expect(diagnostics.textContent).toContain("2");
  });

  it("displays error and warning counts", () => {
    render(<StatusBar {...defaultProps} />);
    const diagnostics = screen.getByTestId("diagnostics");
    expect(diagnostics.textContent).toContain("0");
  });

  it("refetches git info when rootPath changes", async () => {
    useWorkspace.setState({ rootPath: "/project-a" });
    const { rerender } = render(<StatusBar {...defaultProps} />);

    await waitFor(() => {
      expect(mockGitInfo).toHaveBeenCalledWith("/project-a");
    });

    setupDesktopMock({ branch: "feature-x", changedFiles: 2, isGitRepo: true });
    await act(async () => {
      useWorkspace.setState({ rootPath: "/project-b" });
    });

    // Need to rerender since the store change triggers a re-render
    await waitFor(() => {
      expect(mockGitInfo).toHaveBeenCalledWith("/project-b");
    });
  });
});

describe("StatusBar — right side", () => {
  it("displays default cursor position Ln 1, Col 1", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByTestId("cursor-position").textContent).toBe("Ln 1, Col 1");
  });

  it("displays indent setting", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByTestId("indent-setting").textContent).toBe("Spaces: 2");
  });

  it("displays encoding", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByTestId("encoding").textContent).toBe("UTF-8");
  });

  it("displays EOL", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByTestId("eol").textContent).toBe("LF");
  });

  it("displays language mode when a file is open", () => {
    openFile("/src/app.ts", "typescript");
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByTestId("language-mode").textContent).toBe("TypeScript");
  });

  it("does not display language mode when no file is open", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.queryByTestId("language-mode")).toBeNull();
  });

  it("displays raw language id when no friendly label exists", () => {
    openFile("/src/app.hs", "haskell");
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByTestId("language-mode").textContent).toBe("haskell");
  });
});

describe("StatusBar — cursor position updates via custom event", () => {
  it("updates cursor position when ftre:cursor-change event is dispatched", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByTestId("cursor-position").textContent).toBe("Ln 1, Col 1");

    act(() => {
      window.dispatchEvent(new CustomEvent("ftre:cursor-change", { detail: { line: 25, col: 13 } }));
    });

    expect(screen.getByTestId("cursor-position").textContent).toBe("Ln 25, Col 13");
  });

  it("handles multiple cursor change events", () => {
    render(<StatusBar {...defaultProps} />);

    act(() => {
      window.dispatchEvent(new CustomEvent("ftre:cursor-change", { detail: { line: 5, col: 10 } }));
    });
    expect(screen.getByTestId("cursor-position").textContent).toBe("Ln 5, Col 10");

    act(() => {
      window.dispatchEvent(new CustomEvent("ftre:cursor-change", { detail: { line: 99, col: 1 } }));
    });
    expect(screen.getByTestId("cursor-position").textContent).toBe("Ln 99, Col 1");
  });
});

// ── Language Selector Tests ──────────────────────────────────────────

describe("getLanguageLabel", () => {
  it("returns friendly label for known languages", () => {
    expect(getLanguageLabel("typescript")).toBe("TypeScript");
    expect(getLanguageLabel("javascript")).toBe("JavaScript");
    expect(getLanguageLabel("typescriptreact")).toBe("TypeScript React");
    expect(getLanguageLabel("json")).toBe("JSON");
    expect(getLanguageLabel("markdown")).toBe("Markdown");
  });

  it("returns raw id for unknown languages", () => {
    expect(getLanguageLabel("haskell")).toBe("haskell");
    expect(getLanguageLabel("unknown-lang")).toBe("unknown-lang");
  });
});

describe("StatusBar — language selector", () => {
  it("opens language selector when clicking language mode", () => {
    openFile("/src/app.ts", "typescript");
    render(<StatusBar {...defaultProps} />);

    fireEvent.click(screen.getByTestId("language-mode"));

    expect(screen.getByTestId("language-selector")).toBeTruthy();
    expect(screen.getByTestId("language-search")).toBeTruthy();
    expect(screen.getByTestId("language-list")).toBeTruthy();
  });

  it("shows all supported languages in the list", () => {
    openFile("/src/app.ts", "typescript");
    render(<StatusBar {...defaultProps} />);

    fireEvent.click(screen.getByTestId("language-mode"));

    for (const lang of SUPPORTED_LANGUAGES) {
      expect(screen.getByTestId(`language-option-${lang.id}`)).toBeTruthy();
    }
  });

  it("highlights the current language in the list", () => {
    openFile("/src/app.ts", "typescript");
    render(<StatusBar {...defaultProps} />);

    fireEvent.click(screen.getByTestId("language-mode"));

    const tsOption = screen.getByTestId("language-option-typescript");
    expect(tsOption.getAttribute("aria-selected")).toBe("true");
  });

  it("filters languages by search input", () => {
    openFile("/src/app.ts", "typescript");
    render(<StatusBar {...defaultProps} />);

    fireEvent.click(screen.getByTestId("language-mode"));
    fireEvent.change(screen.getByTestId("language-search"), { target: { value: "java" } });

    // Should show Java, JavaScript, JavaScript React — but not TypeScript
    expect(screen.getByTestId("language-option-java")).toBeTruthy();
    expect(screen.getByTestId("language-option-javascript")).toBeTruthy();
    expect(screen.getByTestId("language-option-javascriptreact")).toBeTruthy();
    expect(screen.queryByTestId("language-option-typescript")).toBeNull();
  });

  it("shows no results message when filter matches nothing", () => {
    openFile("/src/app.ts", "typescript");
    render(<StatusBar {...defaultProps} />);

    fireEvent.click(screen.getByTestId("language-mode"));
    fireEvent.change(screen.getByTestId("language-search"), { target: { value: "zzzzz" } });

    expect(screen.getByTestId("language-no-results")).toBeTruthy();
  });

  it("dispatches ftre:change-language event when selecting a language", () => {
    openFile("/src/app.ts", "typescript");
    render(<StatusBar {...defaultProps} />);

    const eventSpy = vi.fn();
    window.addEventListener("ftre:change-language", eventSpy);

    fireEvent.click(screen.getByTestId("language-mode"));
    fireEvent.click(screen.getByTestId("language-option-python"));

    expect(eventSpy).toHaveBeenCalledTimes(1);
    const detail = (eventSpy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({ language: "python" });

    // Selector should close after selection
    expect(screen.queryByTestId("language-selector")).toBeNull();

    window.removeEventListener("ftre:change-language", eventSpy);
  });

  it("closes on Escape key", () => {
    openFile("/src/app.ts", "typescript");
    render(<StatusBar {...defaultProps} />);

    fireEvent.click(screen.getByTestId("language-mode"));
    expect(screen.getByTestId("language-selector")).toBeTruthy();

    fireEvent.keyDown(screen.getByTestId("language-search"), { key: "Escape" });

    expect(screen.queryByTestId("language-selector")).toBeNull();
  });

  it("closes when clicking outside", () => {
    openFile("/src/app.ts", "typescript");
    render(<StatusBar {...defaultProps} />);

    fireEvent.click(screen.getByTestId("language-mode"));
    expect(screen.getByTestId("language-selector")).toBeTruthy();

    // Click on the status bar itself (outside the selector)
    fireEvent.mouseDown(screen.getByTestId("status-bar"));

    expect(screen.queryByTestId("language-selector")).toBeNull();
  });

  it("toggles selector closed when clicking language mode again", () => {
    openFile("/src/app.ts", "typescript");
    render(<StatusBar {...defaultProps} />);

    fireEvent.click(screen.getByTestId("language-mode"));
    expect(screen.getByTestId("language-selector")).toBeTruthy();

    fireEvent.click(screen.getByTestId("language-mode"));
    expect(screen.queryByTestId("language-selector")).toBeNull();
  });

  it("filter is case-insensitive", () => {
    openFile("/src/app.ts", "typescript");
    render(<StatusBar {...defaultProps} />);

    fireEvent.click(screen.getByTestId("language-mode"));
    fireEvent.change(screen.getByTestId("language-search"), { target: { value: "TYPE" } });

    expect(screen.getByTestId("language-option-typescript")).toBeTruthy();
    expect(screen.getByTestId("language-option-typescriptreact")).toBeTruthy();
  });
});
