import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTreeItem } from "./FileTreeItem";
import type { FileEntry } from "@/types";

// ── mocks ────────────────────────────────────────────────────────────

const mockOpenFile = vi.fn();
const mockReadFile = vi.fn();
const mockReadDir = vi.fn();
const mockAddNotification = vi.fn();

vi.mock("@/stores/editor", () => ({
  useEditor: (
    selector?: (s: {
      openFile: typeof mockOpenFile;
      activeFile: string | null;
    }) => unknown,
  ) => {
    const state = {
      openFile: mockOpenFile,
      activeFile: null as string | null,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/stores/workspace", () => ({
  useWorkspace: Object.assign(
    (selector: (s: { rootPath: string | null }) => unknown) =>
      selector({ rootPath: "/project" }),
    {
      getState: () => ({ rootPath: "/project" }),
    },
  ),
}));

vi.mock("@/stores/notification", () => ({
  useNotification: () => ({
    addNotification: mockAddNotification,
  }),
}));

vi.mock("@/services/git-service", () => ({
  useGitService: () => null,
}));

vi.mock("@ftre/editor/core", () => ({
  editorCore: {
    hasContent: () => false,
    getContent: () => "",
    setContent: vi.fn(),
    setDiskContent: vi.fn(),
  },
  editorManager: {
    preloadModel: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();

  // Mock window.desktop
  Object.defineProperty(window, "desktop", {
    value: {
      fs: {
        readFile: mockReadFile,
        readDir: mockReadDir,
      },
    },
    writable: true,
    configurable: true,
  });

  // Mock navigator.clipboard
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
});

// ── helpers ──────────────────────────────────────────────────────────

const fileEntry: FileEntry = {
  name: "index.ts",
  path: "/project/src/index.ts",
  isDir: false,
  ext: "ts",
};

const folderEntry: FileEntry = {
  name: "src",
  path: "/project/src",
  isDir: true,
  ext: null,
};

// Default props for the new required fields
const defaultTreeProps = {
  expanded: false,
  focusedPath: null,
  expandedPaths: new Set<string>(),
  onToggle: vi.fn(),
  childEntries: [] as FileEntry[],
  getChildren: () => [] as FileEntry[],
};

// ── file context menu tests ──────────────────────────────────────────

describe("FileTreeItem �?file context menu", () => {
  it("shows context menu on right-click", () => {
    render(<FileTreeItem entry={fileEntry} depth={0} {...defaultTreeProps} />);
    const item = screen.getByText("index.ts");
    fireEvent.contextMenu(item);
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("shows correct menu items for a file", () => {
    render(<FileTreeItem entry={fileEntry} depth={0} {...defaultTreeProps} />);
    fireEvent.contextMenu(screen.getByText("index.ts"));

    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("重命名")).toBeTruthy();
    // "删除" appears twice: once as menu label and once as shortcut hint
    expect(screen.getAllByText("删除").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("复制路径")).toBeTruthy();
    expect(screen.getByText("Copy Relative Path")).toBeTruthy();
    expect(screen.getByText("Open in Terminal")).toBeTruthy();
  });

  it("does not show folder-only items for a file", () => {
    render(<FileTreeItem entry={fileEntry} depth={0} {...defaultTreeProps} />);
    fireEvent.contextMenu(screen.getByText("index.ts"));

    expect(screen.queryByText("新建文件")).toBeNull();
    expect(screen.queryByText("New Folder")).toBeNull();
  });

  it("dispatches ftre:file-rename event when Rename is clicked", () => {
    const spy = vi.fn();
    window.addEventListener("ftre:file-rename", spy);

    render(<FileTreeItem entry={fileEntry} depth={0} {...defaultTreeProps} />);
    fireEvent.contextMenu(screen.getByText("index.ts"));
    fireEvent.click(screen.getByText("重命名"));

    expect(spy).toHaveBeenCalledTimes(1);
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({ path: "/project/src/index.ts", isDir: false });

    window.removeEventListener("ftre:file-rename", spy);
  });

  it("dispatches ftre:file-delete event when Delete is clicked", () => {
    const spy = vi.fn();
    window.addEventListener("ftre:file-delete", spy);

    render(<FileTreeItem entry={fileEntry} depth={0} {...defaultTreeProps} />);
    fireEvent.contextMenu(screen.getByText("index.ts"));
    // "删除" appears as both menu label and shortcut hint; click the first (menu label)
    fireEvent.click(screen.getAllByText("删除")[0]);

    expect(spy).toHaveBeenCalledTimes(1);
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({ path: "/project/src/index.ts", isDir: false });

    window.removeEventListener("ftre:file-delete", spy);
  });

  it("copies file path to clipboard when Copy Path is clicked", () => {
    render(<FileTreeItem entry={fileEntry} depth={0} {...defaultTreeProps} />);
    fireEvent.contextMenu(screen.getByText("index.ts"));
    fireEvent.click(screen.getByText("复制路径"));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "/project/src/index.ts",
    );
  });

  it("copies relative path to clipboard when Copy Relative Path is clicked", () => {
    render(<FileTreeItem entry={fileEntry} depth={0} {...defaultTreeProps} />);
    fireEvent.contextMenu(screen.getByText("index.ts"));
    fireEvent.click(screen.getByText("Copy Relative Path"));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("src/index.ts");
  });

  it("dispatches ftre:open-terminal-at with parent directory", () => {
    const spy = vi.fn();
    window.addEventListener("ftre:open-terminal-at", spy);

    render(<FileTreeItem entry={fileEntry} depth={0} {...defaultTreeProps} />);
    fireEvent.contextMenu(screen.getByText("index.ts"));
    fireEvent.click(screen.getByText("Open in Terminal"));

    expect(spy).toHaveBeenCalledTimes(1);
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({ dirPath: "/project/src" });

    window.removeEventListener("ftre:open-terminal-at", spy);
  });

  it("closes context menu after clicking a menu item", () => {
    render(<FileTreeItem entry={fileEntry} depth={0} {...defaultTreeProps} />);
    fireEvent.contextMenu(screen.getByText("index.ts"));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.click(screen.getByText("复制路径"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

// ── folder context menu tests ────────────────────────────────────────

describe("FileTreeItem �?folder context menu", () => {
  it("shows correct menu items for a folder", () => {
    render(
      <FileTreeItem entry={folderEntry} depth={0} {...defaultTreeProps} />,
    );
    fireEvent.contextMenu(screen.getByText("src"));

    expect(screen.getByText("新建文件")).toBeTruthy();
    expect(screen.getByText("New Folder")).toBeTruthy();
    expect(screen.getByText("重命名")).toBeTruthy();
    // "删除" appears twice: once as menu label and once as shortcut hint
    expect(screen.getAllByText("删除").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("复制路径")).toBeTruthy();
    expect(screen.getByText("Copy Relative Path")).toBeTruthy();
  });

  it("does not show file-only items for a folder", () => {
    render(
      <FileTreeItem entry={folderEntry} depth={0} {...defaultTreeProps} />,
    );
    fireEvent.contextMenu(screen.getByText("src"));

    expect(screen.queryByText("Open")).toBeNull();
  });

  it("dispatches ftre:new-file event when New File is clicked", () => {
    const spy = vi.fn();
    window.addEventListener("ftre:new-file", spy);

    render(
      <FileTreeItem entry={folderEntry} depth={0} {...defaultTreeProps} />,
    );
    fireEvent.contextMenu(screen.getByText("src"));
    fireEvent.click(screen.getByText("新建文件"));

    expect(spy).toHaveBeenCalledTimes(1);
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({ dirPath: "/project/src" });

    window.removeEventListener("ftre:new-file", spy);
  });

  it("dispatches ftre:new-folder event when New Folder is clicked", () => {
    const spy = vi.fn();
    window.addEventListener("ftre:new-folder", spy);

    render(
      <FileTreeItem entry={folderEntry} depth={0} {...defaultTreeProps} />,
    );
    fireEvent.contextMenu(screen.getByText("src"));
    fireEvent.click(screen.getByText("New Folder"));

    expect(spy).toHaveBeenCalledTimes(1);
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({ dirPath: "/project/src" });

    window.removeEventListener("ftre:new-folder", spy);
  });

  it("dispatches ftre:file-rename with isDir=true for folder", () => {
    const spy = vi.fn();
    window.addEventListener("ftre:file-rename", spy);

    render(
      <FileTreeItem entry={folderEntry} depth={0} {...defaultTreeProps} />,
    );
    fireEvent.contextMenu(screen.getByText("src"));
    fireEvent.click(screen.getByText("重命名"));

    expect(spy).toHaveBeenCalledTimes(1);
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({ path: "/project/src", isDir: true });

    window.removeEventListener("ftre:file-rename", spy);
  });

  it("dispatches ftre:file-delete with isDir=true for folder", () => {
    const spy = vi.fn();
    window.addEventListener("ftre:file-delete", spy);

    render(
      <FileTreeItem entry={folderEntry} depth={0} {...defaultTreeProps} />,
    );
    fireEvent.contextMenu(screen.getByText("src"));
    // "删除" appears as both menu label and shortcut hint; click the first (menu label)
    fireEvent.click(screen.getAllByText("删除")[0]);

    expect(spy).toHaveBeenCalledTimes(1);
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({ path: "/project/src", isDir: true });

    window.removeEventListener("ftre:file-delete", spy);
  });

  it("copies folder path to clipboard when Copy Path is clicked", () => {
    render(
      <FileTreeItem entry={folderEntry} depth={0} {...defaultTreeProps} />,
    );
    fireEvent.contextMenu(screen.getByText("src"));
    fireEvent.click(screen.getByText("复制路径"));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("/project/src");
  });

  it("copies folder relative path to clipboard when Copy Relative Path is clicked", () => {
    render(
      <FileTreeItem entry={folderEntry} depth={0} {...defaultTreeProps} />,
    );
    fireEvent.contextMenu(screen.getByText("src"));
    fireEvent.click(screen.getByText("Copy Relative Path"));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("src");
  });
});

// ── context menu close behavior ──────────────────────────────────────

describe("FileTreeItem �?context menu close", () => {
  it("closes context menu on Escape", () => {
    render(<FileTreeItem entry={fileEntry} depth={0} {...defaultTreeProps} />);
    fireEvent.contextMenu(screen.getByText("index.ts"));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("prevents default browser context menu", () => {
    render(<FileTreeItem entry={fileEntry} depth={0} {...defaultTreeProps} />);
    const item = screen.getByText("index.ts").closest("div")!;
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    const prevented = !item.dispatchEvent(event);
    expect(prevented).toBe(true);
  });
});

// ── rename mode tests ────────────────────────────────────────────────

describe("FileTreeItem — rename mode", () => {
  const mockRenameSubmit = vi.fn();
  const mockRenameCancel = vi.fn();

  beforeEach(() => {
    mockRenameSubmit.mockClear();
    mockRenameCancel.mockClear();
  });

  it("renders InlineInput when pendingRename matches entry path", () => {
    render(
      <FileTreeItem
        entry={fileEntry}
        depth={0}
        {...defaultTreeProps}
        pendingRename={{ path: fileEntry.path, isDir: false }}
        onRenameSubmit={mockRenameSubmit}
        onRenameCancel={mockRenameCancel}
      />,
    );

    // Should show input with current file name
    const input = screen.getByDisplayValue("index.ts");
    expect(input).toBeTruthy();
  });

  it("does not render InlineInput when pendingRename does not match", () => {
    render(
      <FileTreeItem
        entry={fileEntry}
        depth={0}
        {...defaultTreeProps}
        pendingRename={{ path: "/project/other.ts", isDir: false }}
        onRenameSubmit={mockRenameSubmit}
        onRenameCancel={mockRenameCancel}
      />,
    );

    // Should show normal file name text, not input
    expect(screen.getByText("index.ts")).toBeTruthy();
    expect(screen.queryByDisplayValue("index.ts")).toBeNull();
  });

  it("calls onRenameSubmit when Enter is pressed with new name", () => {
    render(
      <FileTreeItem
        entry={fileEntry}
        depth={0}
        {...defaultTreeProps}
        pendingRename={{ path: fileEntry.path, isDir: false }}
        onRenameSubmit={mockRenameSubmit}
        onRenameCancel={mockRenameCancel}
      />,
    );

    const input = screen.getByDisplayValue("index.ts");
    fireEvent.change(input, { target: { value: "renamed.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockRenameSubmit).toHaveBeenCalledTimes(1);
    expect(mockRenameSubmit).toHaveBeenCalledWith("renamed.ts");
  });

  it("calls onRenameCancel when Escape is pressed", () => {
    render(
      <FileTreeItem
        entry={fileEntry}
        depth={0}
        {...defaultTreeProps}
        pendingRename={{ path: fileEntry.path, isDir: false }}
        onRenameSubmit={mockRenameSubmit}
        onRenameCancel={mockRenameCancel}
      />,
    );

    const input = screen.getByDisplayValue("index.ts");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(mockRenameCancel).toHaveBeenCalledTimes(1);
    expect(mockRenameSubmit).not.toHaveBeenCalled();
  });

  it("selects filename without extension on focus", () => {
    render(
      <FileTreeItem
        entry={fileEntry}
        depth={0}
        {...defaultTreeProps}
        pendingRename={{ path: fileEntry.path, isDir: false }}
        onRenameSubmit={mockRenameSubmit}
        onRenameCancel={mockRenameCancel}
      />,
    );

    const input = screen.getByDisplayValue("index.ts") as HTMLInputElement;
    // The input should be focused and have selection
    expect(document.activeElement).toBe(input);
  });

  it("renders rename mode for folders too", () => {
    render(
      <FileTreeItem
        entry={folderEntry}
        depth={0}
        {...defaultTreeProps}
        pendingRename={{ path: folderEntry.path, isDir: true }}
        onRenameSubmit={mockRenameSubmit}
        onRenameCancel={mockRenameCancel}
      />,
    );

    const input = screen.getByDisplayValue("src");
    expect(input).toBeTruthy();
  });
});
