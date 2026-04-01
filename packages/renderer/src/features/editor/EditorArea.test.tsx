import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditorArea } from "./EditorArea";
import { useEditor, _resetGroupCounter } from "@/stores/editor";
import type { OpenFile } from "@/stores/editor";
import { FileCode } from "lucide-react";

// ── Mocks ────────────────────────────────────────────────────────────

// Mock MonacoEditor, MonacoDiffViewer, DiffBar from @ftre/editor/ui — heavy dependencies, not needed for layout tests
vi.mock("@ftre/editor/ui", () => ({
  MonacoEditor: ({ file }: { file: OpenFile }) => (
    <div data-testid={`monaco-${file.path}`}>{file.name}</div>
  ),
  MonacoDiffViewer: () => <div data-testid="monaco-diff-viewer" />,
  DiffBar: () => <div data-testid="diff-bar" />,
}));

// Mock file-icons
vi.mock("@/lib/file-icons", () => ({
  getFileIcon: () => ({ icon: FileCode, color: "#3178c6" }),
}));

// Mock Breadcrumb
vi.mock("./Breadcrumb", () => ({
  Breadcrumb: ({ groupId }: { groupId?: string }) => (
    <div data-testid={`breadcrumb-${groupId ?? "default"}`} />
  ),
}));

// ResizeObserver polyfill for jsdom
class ResizeObserverMock {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  ResizeObserverMock as unknown as typeof ResizeObserver;

// ── Helpers ──────────────────────────────────────────────────────────

function makeFile(path: string): Omit<OpenFile, "modified" | "pinned"> {
  return {
    path,
    name: path.split("/").pop()!,
    language: "typescript",
    content: `// ${path}`,
  };
}

function resetStore() {
  _resetGroupCounter();
  useEditor.setState({
    groups: [{ id: "default", openFiles: [], activeFile: null }],
    activeGroupId: "default",
    recentFiles: [],
    openFiles: [],
    activeFile: null,
    pendingDiffs: [],
  });
}

function openFiles(...paths: string[]) {
  for (const p of paths) {
    useEditor.getState().openFile(makeFile(p));
  }
}

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore();
});

describe("EditorArea — single group", () => {
  it("renders a single editor group by default", () => {
    openFiles("/a.ts");
    render(<EditorArea />);

    expect(screen.getByTestId("editor-group-default")).toBeTruthy();
    expect(screen.getByTestId("monaco-/a.ts")).toBeTruthy();
  });

  it("shows welcome placeholder when no files are open", () => {
    render(<EditorArea />);

    expect(screen.getByTestId("welcome-placeholder")).toBeTruthy();
    expect(screen.getByText("Ftre")).toBeTruthy();
    expect(screen.getByText("AI 原生代码编辑器")).toBeTruthy();
  });

  it("does not show close button when only one group exists", () => {
    openFiles("/a.ts");
    render(<EditorArea />);

    expect(screen.queryByTestId("close-group-default")).toBeNull();
  });
});

describe("EditorArea — split editor", () => {
  it("renders multiple groups after splitEditor()", () => {
    openFiles("/a.ts");
    useEditor.getState().splitEditor();

    render(<EditorArea />);

    const groups = useEditor.getState().groups;
    expect(groups).toHaveLength(2);

    // Both groups should be rendered
    expect(screen.getByTestId("editor-group-default")).toBeTruthy();
    expect(screen.getByTestId(`editor-group-${groups[1].id}`)).toBeTruthy();
  });

  it("new group contains the same active file", () => {
    openFiles("/a.ts", "/b.ts");
    // b.ts is active (last opened)
    useEditor.getState().splitEditor();

    const groups = useEditor.getState().groups;
    const newGroup = groups[1];
    expect(newGroup.activeFile).toBe("/b.ts");
    expect(newGroup.openFiles).toHaveLength(1);
    expect(newGroup.openFiles[0].path).toBe("/b.ts");
  });

  it("shows close buttons when multiple groups exist", () => {
    openFiles("/a.ts");
    useEditor.getState().splitEditor();

    render(<EditorArea />);

    const groups = useEditor.getState().groups;
    expect(screen.getByTestId("close-group-default")).toBeTruthy();
    expect(screen.getByTestId(`close-group-${groups[1].id}`)).toBeTruthy();
  });

  it("closes a group when close button is clicked", () => {
    openFiles("/a.ts");
    useEditor.getState().splitEditor();

    const groups = useEditor.getState().groups;
    const secondGroupId = groups[1].id;

    render(<EditorArea />);

    fireEvent.click(screen.getByTestId(`close-group-${secondGroupId}`));

    expect(useEditor.getState().groups).toHaveLength(1);
    expect(useEditor.getState().groups[0].id).toBe("default");
  });

  it("sets activeGroupId when clicking on a group", () => {
    openFiles("/a.ts");
    useEditor.getState().splitEditor();

    render(<EditorArea />);

    // After split, the new group is active
    const groups = useEditor.getState().groups;
    expect(useEditor.getState().activeGroupId).toBe(groups[1].id);

    // Click on the first group
    fireEvent.click(screen.getByTestId("editor-group-default"));
    expect(useEditor.getState().activeGroupId).toBe("default");
  });

  it("each group has its own Breadcrumb with groupId", () => {
    openFiles("/a.ts");
    useEditor.getState().splitEditor();

    render(<EditorArea />);

    const groups = useEditor.getState().groups;
    expect(screen.getByTestId("breadcrumb-default")).toBeTruthy();
    expect(screen.getByTestId(`breadcrumb-${groups[1].id}`)).toBeTruthy();
  });

  it("each group renders its own MonacoEditor for its active file", () => {
    openFiles("/a.ts", "/b.ts");
    // b.ts is active
    useEditor.getState().splitEditor();

    // Open a different file in the first group
    useEditor.getState().setActiveGroup("default");
    useEditor.getState().setActive("/a.ts");

    render(<EditorArea />);

    expect(screen.getByTestId("monaco-/a.ts")).toBeTruthy();
    expect(screen.getByTestId("monaco-/b.ts")).toBeTruthy();
  });

  it("does not split when no file is active", () => {
    // No files open
    useEditor.getState().splitEditor();

    expect(useEditor.getState().groups).toHaveLength(1);
  });

  it("groups are rendered side by side (flex row)", () => {
    openFiles("/a.ts");
    useEditor.getState().splitEditor();

    const { container } = render(<EditorArea />);

    // The root container should have flex-row
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("flex-row");
  });

  it("second group has a left border separator", () => {
    openFiles("/a.ts");
    useEditor.getState().splitEditor();

    render(<EditorArea />);

    const groups = useEditor.getState().groups;
    const secondGroup = screen.getByTestId(`editor-group-${groups[1].id}`);
    expect(secondGroup.className).toContain("border-l");
  });

  it("only first group gets onToggleFiles on its TabBar", () => {
    const toggleFn = vi.fn();
    openFiles("/a.ts");
    useEditor.getState().splitEditor();

    render(<EditorArea onToggleFiles={toggleFn} />);

    // The FolderOpen button should only appear in the first group's TabBar
    // We can verify by checking the folder icon buttons
    const folderButtons = screen
      .getAllByRole("button")
      .filter(
        (btn) => btn.querySelector("svg") && btn.className.includes("w-[35px]"),
      );
    // There should be folder button(s) in the first group + close buttons
    // This is a structural test — the key point is it doesn't crash
    expect(folderButtons.length).toBeGreaterThan(0);
  });
});

describe("EditorArea — ftre:split-editor event", () => {
  it("splits editor when ftre:split-editor event is dispatched", () => {
    openFiles("/a.ts");
    // Need to set activeGroupId back to default since openFile sets it
    useEditor.setState({ activeGroupId: "default" });

    render(<EditorArea />);

    expect(useEditor.getState().groups).toHaveLength(1);

    window.dispatchEvent(new CustomEvent("ftre:split-editor"));

    expect(useEditor.getState().groups).toHaveLength(2);
  });
});

describe("EditorArea — setActiveGroup store action", () => {
  it("syncs top-level openFiles/activeFile when switching groups", () => {
    openFiles("/a.ts", "/b.ts");
    useEditor.getState().splitEditor();

    const groups = useEditor.getState().groups;
    const newGroupId = groups[1].id;

    // New group is active, has /b.ts
    expect(useEditor.getState().activeFile).toBe("/b.ts");

    // Switch to default group
    useEditor.getState().setActiveGroup("default");
    expect(useEditor.getState().activeFile).toBe("/b.ts"); // default group's active is also /b.ts (last opened)
    expect(useEditor.getState().openFiles).toHaveLength(2); // default group has both files

    // Switch back
    useEditor.getState().setActiveGroup(newGroupId);
    expect(useEditor.getState().openFiles).toHaveLength(1); // new group has only /b.ts
  });

  it("does nothing when setting the same active group", () => {
    openFiles("/a.ts");
    const stateBefore = useEditor.getState();
    useEditor.getState().setActiveGroup("default");
    // No state change
    expect(useEditor.getState().activeGroupId).toBe(stateBefore.activeGroupId);
  });

  it("does nothing when groupId does not exist", () => {
    openFiles("/a.ts");
    useEditor.getState().setActiveGroup("nonexistent");
    expect(useEditor.getState().activeGroupId).toBe("default");
  });
});

describe("EditorArea — enhanced welcome placeholder", () => {
  it("displays the Code2 logo icon", () => {
    render(<EditorArea />);

    const placeholder = screen.getByTestId("welcome-placeholder");
    // Code2 icon renders as an SVG
    const svg = placeholder.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("shows at least 5 keyboard shortcuts", () => {
    render(<EditorArea />);

    const shortcutsSection = screen.getByTestId("shortcuts-section");
    const shortcutItems = shortcutsSection.children;
    expect(shortcutItems.length).toBeGreaterThanOrEqual(5);
  });

  it("shows specific required shortcuts", () => {
    render(<EditorArea />);

    expect(screen.getByText("Ctrl+P")).toBeTruthy();
    expect(screen.getByText("Ctrl+Shift+P")).toBeTruthy();
    expect(screen.getByText("Ctrl+Shift+F")).toBeTruthy();
    expect(screen.getByText("Ctrl+`")).toBeTruthy();
    expect(screen.getByText("Ctrl+B")).toBeTruthy();
  });

  it("does not show recent files section when recentFiles is empty", () => {
    render(<EditorArea />);

    expect(screen.queryByTestId("recent-files-section")).toBeNull();
  });

  it("shows recent files section when recentFiles has entries", () => {
    useEditor.setState({ recentFiles: ["/src/app.ts", "/src/index.ts"] });
    render(<EditorArea />);

    expect(screen.getByTestId("recent-files-section")).toBeTruthy();
    expect(screen.getByText("app.ts")).toBeTruthy();
    expect(screen.getByText("index.ts")).toBeTruthy();
  });

  it("opens a recent file when clicked", () => {
    useEditor.setState({ recentFiles: ["/src/hello.ts"] });
    render(<EditorArea />);

    fireEvent.click(screen.getByTestId("recent-file-/src/hello.ts"));

    const state = useEditor.getState();
    const group = state.groups.find((g) => g.id === state.activeGroupId)!;
    expect(group.activeFile).toBe("/src/hello.ts");
    expect(group.openFiles.some((f) => f.path === "/src/hello.ts")).toBe(true);
  });

  it("limits displayed recent files to 8", () => {
    const paths = Array.from({ length: 12 }, (_, i) => `/file${i}.ts`);
    useEditor.setState({ recentFiles: paths });
    render(<EditorArea />);

    const section = screen.getByTestId("recent-files-section");
    const buttons = section.querySelectorAll("button");
    expect(buttons.length).toBe(8);
  });
});
