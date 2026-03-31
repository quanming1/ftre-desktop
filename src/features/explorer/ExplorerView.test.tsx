import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExplorerView } from "./ExplorerView";

// ── mocks ────────────────────────────────────────────────────────────

const mockAddNotification = vi.fn();
const mockSetRootPath = vi.fn();

vi.mock("@/stores/workspace", () => ({
  useWorkspace: () => ({
    rootPath: "/project",
    setRootPath: mockSetRootPath,
  }),
}));

vi.mock("@/stores/notification", () => ({
  useNotification: () => ({
    addNotification: mockAddNotification,
  }),
}));

const mockOpenFile = vi.fn();
vi.mock("@/stores/editor", () => {
  const hook = () => ({
    openFile: mockOpenFile,
    activeFile: null,
  });
  hook.getState = () => ({
    openFile: mockOpenFile,
    activeFile: null,
  });
  return { useEditor: hook };
});

const mockReadDir = vi.fn();
const mockCreateFile = vi.fn();
const mockCreateFolder = vi.fn();
const mockRename = vi.fn();
const mockDelete = vi.fn();
const mockSelectFolder = vi.fn();
const mockReadFile = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();

  mockReadDir.mockResolvedValue({
    entries: [
      { name: "src", path: "/project/src", isDir: true, ext: null },
      { name: "index.ts", path: "/project/index.ts", isDir: false, ext: "ts" },
    ],
  });

  mockCreateFile.mockResolvedValue({ success: true });
  mockCreateFolder.mockResolvedValue({ success: true });
  mockRename.mockResolvedValue({ success: true });
  mockDelete.mockResolvedValue({ success: true });
  mockSelectFolder.mockResolvedValue({ path: null });
  mockReadFile.mockResolvedValue({ content: "", language: "typescript", error: undefined });

  Object.defineProperty(window, "desktop", {
    value: {
      fs: {
        readDir: mockReadDir,
        readFile: mockReadFile,
        createFile: mockCreateFile,
        createFolder: mockCreateFolder,
        rename: mockRename,
        delete: mockDelete,
        selectFolder: mockSelectFolder,
      },
    },
    writable: true,
    configurable: true,
  });

  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
});

// ── new file/folder creation tests ───────────────────────────────────

describe("ExplorerView — new file creation", () => {
  it("shows inline input when ftre:new-file event is dispatched for root", async () => {
    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());

    // Dispatch new-file event targeting root
    window.dispatchEvent(new CustomEvent("ftre:new-file", { detail: { dirPath: "/project" } }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("File name")).toBeTruthy();
    });
  });

  it("calls createFile and refreshes tree on submit", async () => {
    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());

    window.dispatchEvent(new CustomEvent("ftre:new-file", { detail: { dirPath: "/project" } }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("File name")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("File name");
    fireEvent.change(input, { target: { value: "newfile.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockCreateFile).toHaveBeenCalledWith("/project/newfile.ts");
    });
  });

  it("shows error notification when createFile fails", async () => {
    mockCreateFile.mockResolvedValue({ success: false, error: "Permission denied" });

    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());

    window.dispatchEvent(new CustomEvent("ftre:new-file", { detail: { dirPath: "/project" } }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("File name")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("File name");
    fireEvent.change(input, { target: { value: "fail.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith({
        level: "error",
        message: "Permission denied",
      });
    });
  });

  it("cancels creation on Escape", async () => {
    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());

    window.dispatchEvent(new CustomEvent("ftre:new-file", { detail: { dirPath: "/project" } }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("File name")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("File name");
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("File name")).toBeNull();
    });
    expect(mockCreateFile).not.toHaveBeenCalled();
  });
});

describe("ExplorerView — new folder creation", () => {
  it("shows inline input when ftre:new-folder event is dispatched", async () => {
    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());

    window.dispatchEvent(new CustomEvent("ftre:new-folder", { detail: { dirPath: "/project" } }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Folder name")).toBeTruthy();
    });
  });

  it("calls createFolder on submit", async () => {
    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());

    window.dispatchEvent(new CustomEvent("ftre:new-folder", { detail: { dirPath: "/project" } }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Folder name")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Folder name");
    fireEvent.change(input, { target: { value: "newdir" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith("/project/newdir");
    });
  });
});

// ── delete confirmation tests ────────────────────────────────────────

describe("ExplorerView — file delete", () => {
  it("shows confirmation dialog when ftre:file-delete is dispatched", async () => {
    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("index.ts")).toBeTruthy());

    window.dispatchEvent(
      new CustomEvent("ftre:file-delete", {
        detail: { path: "/project/index.ts", isDir: false },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Delete File")).toBeTruthy();
      expect(screen.getByText(/Are you sure you want to delete/)).toBeTruthy();
    });
  });

  it("calls delete API when confirmed", async () => {
    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("index.ts")).toBeTruthy());

    window.dispatchEvent(
      new CustomEvent("ftre:file-delete", {
        detail: { path: "/project/index.ts", isDir: false },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Delete File")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("/project/index.ts", false);
    });
  });

  it("does not call delete when cancelled", async () => {
    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("index.ts")).toBeTruthy());

    window.dispatchEvent(
      new CustomEvent("ftre:file-delete", {
        detail: { path: "/project/index.ts", isDir: false },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Delete File")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByText("Delete File")).toBeNull();
    });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("shows error notification when delete fails", async () => {
    mockDelete.mockResolvedValue({ success: false, error: "File is locked" });

    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("index.ts")).toBeTruthy());

    window.dispatchEvent(
      new CustomEvent("ftre:file-delete", {
        detail: { path: "/project/index.ts", isDir: false },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Delete File")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith({
        level: "error",
        message: "File is locked",
      });
    });
  });

  it("shows folder delete dialog with correct title", async () => {
    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());

    window.dispatchEvent(
      new CustomEvent("ftre:file-delete", {
        detail: { path: "/project/src", isDir: true },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Delete Folder")).toBeTruthy();
    });
  });
});

// ── rename tests ─────────────────────────────────────────────────────

describe("ExplorerView — file rename", () => {
  it("shows inline input with current name when ftre:file-rename is dispatched", async () => {
    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("index.ts")).toBeTruthy());

    window.dispatchEvent(
      new CustomEvent("ftre:file-rename", {
        detail: { path: "/project/index.ts", isDir: false },
      }),
    );

    await waitFor(() => {
      const input = screen.getByDisplayValue("index.ts");
      expect(input).toBeTruthy();
    });
  });

  it("calls rename API with new name on submit", async () => {
    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("index.ts")).toBeTruthy());

    window.dispatchEvent(
      new CustomEvent("ftre:file-rename", {
        detail: { path: "/project/index.ts", isDir: false },
      }),
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("index.ts")).toBeTruthy();
    });

    const input = screen.getByDisplayValue("index.ts");
    fireEvent.change(input, { target: { value: "main.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockRename).toHaveBeenCalledWith("/project/index.ts", "/project/main.ts");
    });
  });

  it("does not call rename when name is unchanged", async () => {
    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("index.ts")).toBeTruthy());

    window.dispatchEvent(
      new CustomEvent("ftre:file-rename", {
        detail: { path: "/project/index.ts", isDir: false },
      }),
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("index.ts")).toBeTruthy();
    });

    const input = screen.getByDisplayValue("index.ts");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockRename).not.toHaveBeenCalled();
    });
  });

  it("shows error notification when rename fails", async () => {
    mockRename.mockResolvedValue({ success: false, error: "Name conflict" });

    render(<ExplorerView />);
    await waitFor(() => expect(screen.getByText("index.ts")).toBeTruthy());

    window.dispatchEvent(
      new CustomEvent("ftre:file-rename", {
        detail: { path: "/project/index.ts", isDir: false },
      }),
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("index.ts")).toBeTruthy();
    });

    const input = screen.getByDisplayValue("index.ts");
    fireEvent.change(input, { target: { value: "conflict.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith({
        level: "error",
        message: "Name conflict",
      });
    });
  });
});
