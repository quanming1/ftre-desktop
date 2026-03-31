import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TabBar } from "./TabBar";
import { useEditor, _resetGroupCounter } from "@/stores/editor";
import type { OpenFile } from "@/stores/editor";

// ── ResizeObserver polyfill for jsdom ────────────────────────────────
class ResizeObserverMock {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// ── helpers ──────────────────────────────────────────────────────────

function makeFile(path: string, name?: string): Omit<OpenFile, "modified" | "pinned"> {
  return {
    path,
    name: name ?? path.split("/").pop()!,
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

function getTabButtons() {
  return screen.getAllByRole("button").filter((btn) => btn.hasAttribute("draggable"));
}

// ── tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore();
});

describe("TabBar — drag-and-drop reordering", () => {
  it("renders tabs with draggable attribute", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");
    render(<TabBar />);

    const tabs = getTabButtons();
    expect(tabs).toHaveLength(3);
    tabs.forEach((tab) => {
      expect(tab).toHaveAttribute("draggable", "true");
    });
  });

  it("renders tabs with data-tab-index attributes", () => {
    openFiles("/a.ts", "/b.ts");
    render(<TabBar />);

    const tabs = getTabButtons();
    expect(tabs[0]).toHaveAttribute("data-tab-index", "0");
    expect(tabs[1]).toHaveAttribute("data-tab-index", "1");
  });

  it("reorders tabs via store — move forward", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");
    render(<TabBar />);

    const tabs = getTabButtons();

    // Start drag on first tab
    fireEvent.dragStart(tabs[0], {
      dataTransfer: { effectAllowed: "", setData: vi.fn() },
    });

    // Drop on last tab (right half: clientX > midpoint → insert after)
    fireEvent.drop(tabs[2], {
      dataTransfer: { dropEffect: "" },
      clientX: 100,
    });

    fireEvent.dragEnd(tabs[0]);

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/b.ts", "/c.ts", "/a.ts"]);
  });

  it("reorders tabs via store — move backward", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");

    // Directly test the store reorder since jsdom DragEvent doesn't support
    // negative clientX values needed for left-half detection
    useEditor.getState().reorderTabs("default", 2, 0);

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/c.ts", "/a.ts", "/b.ts"]);
  });

  it("calls reorderTabs with correct groupId on drop", () => {
    openFiles("/a.ts", "/b.ts");

    const reorderSpy = vi.spyOn(useEditor.getState(), "reorderTabs");

    render(<TabBar />);

    const tabs = getTabButtons();
    fireEvent.dragStart(tabs[0], {
      dataTransfer: { effectAllowed: "", setData: vi.fn() },
    });

    fireEvent.drop(tabs[1], {
      dataTransfer: { dropEffect: "" },
      clientX: 100,
    });

    expect(reorderSpy).toHaveBeenCalledWith("default", 0, 1);
    reorderSpy.mockRestore();
  });

  it("does not reorder when dropping on the same tab", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");
    render(<TabBar />);

    const tabs = getTabButtons();
    const tab = tabs[1];

    fireEvent.dragStart(tab, {
      dataTransfer: { effectAllowed: "", setData: vi.fn() },
    });

    fireEvent.drop(tab, {
      dataTransfer: { dropEffect: "" },
      clientX: 100,
    });

    fireEvent.dragEnd(tab);

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/a.ts", "/b.ts", "/c.ts"]);
  });

  it("shows drop indicator during drag over", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");
    render(<TabBar />);

    const tabs = getTabButtons();

    fireEvent.dragStart(tabs[0], {
      dataTransfer: { effectAllowed: "", setData: vi.fn() },
    });

    // Drag over a different tab
    fireEvent.dragOver(tabs[2], {
      dataTransfer: { dropEffect: "" },
      clientX: 100,
    });

    const indicators = screen.getAllByTestId("drop-indicator");
    expect(indicators.length).toBeGreaterThan(0);

    fireEvent.dragEnd(tabs[0]);
  });

  it("clears drop indicator on drag end", () => {
    openFiles("/a.ts", "/b.ts");
    render(<TabBar />);

    const tabs = getTabButtons();

    fireEvent.dragStart(tabs[0], {
      dataTransfer: { effectAllowed: "", setData: vi.fn() },
    });

    fireEvent.dragOver(tabs[1], {
      dataTransfer: { dropEffect: "" },
      clientX: 100,
    });

    fireEvent.dragEnd(tabs[0]);

    const indicators = screen.queryAllByTestId("drop-indicator");
    expect(indicators).toHaveLength(0);
  });

  it("works with a single tab (no crash)", () => {
    openFiles("/a.ts");
    render(<TabBar />);

    const tabs = getTabButtons();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toHaveAttribute("draggable", "true");

    fireEvent.dragStart(tabs[0], {
      dataTransfer: { effectAllowed: "", setData: vi.fn() },
    });
    fireEvent.dragEnd(tabs[0]);

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/a.ts"]);
  });

  it("does not reorder when dragIndex is null (no dragStart)", () => {
    openFiles("/a.ts", "/b.ts");
    render(<TabBar />);

    const tabs = getTabButtons();

    // Drop without dragStart — should be a no-op
    fireEvent.drop(tabs[1], {
      dataTransfer: { dropEffect: "" },
      clientX: 100,
    });

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/a.ts", "/b.ts"]);
  });
});

describe("TabBar — middle-click close", () => {
  it("closes a tab on middle-click (button === 1)", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");
    render(<TabBar />);

    const tabs = getTabButtons();
    expect(tabs).toHaveLength(3);

    // Middle-click on the second tab
    fireEvent.mouseDown(tabs[1], { button: 1 });

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/a.ts", "/c.ts"]);
  });

  it("does not close a tab on left-click (button === 0)", () => {
    openFiles("/a.ts", "/b.ts");
    render(<TabBar />);

    const tabs = getTabButtons();
    fireEvent.mouseDown(tabs[0], { button: 0 });

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/a.ts", "/b.ts"]);
  });

  it("does not close a tab on right-click (button === 2)", () => {
    openFiles("/a.ts", "/b.ts");
    render(<TabBar />);

    const tabs = getTabButtons();
    fireEvent.mouseDown(tabs[0], { button: 2 });

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/a.ts", "/b.ts"]);
  });
});

describe("TabBar — overflow scroll arrows", () => {
  it("shows scroll arrows when tabs overflow", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");
    const { container } = render(<TabBar />);

    // Get the tabs container (the div with ref)
    const tabsContainer = container.querySelector(".overflow-x-auto") as HTMLDivElement;

    // Mock overflow: scrollWidth > clientWidth, scrollLeft > 0
    Object.defineProperty(tabsContainer, "scrollWidth", { value: 500, configurable: true });
    Object.defineProperty(tabsContainer, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(tabsContainer, "scrollLeft", { value: 50, configurable: true, writable: true });

    // Trigger scroll event to update state
    fireEvent.scroll(tabsContainer);

    expect(screen.getByTestId("scroll-left")).toBeTruthy();
    expect(screen.getByTestId("scroll-right")).toBeTruthy();
  });

  it("hides left arrow when scrolled to start", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");
    const { container } = render(<TabBar />);

    const tabsContainer = container.querySelector(".overflow-x-auto") as HTMLDivElement;

    Object.defineProperty(tabsContainer, "scrollWidth", { value: 500, configurable: true });
    Object.defineProperty(tabsContainer, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(tabsContainer, "scrollLeft", { value: 0, configurable: true, writable: true });

    fireEvent.scroll(tabsContainer);

    expect(screen.queryByTestId("scroll-left")).toBeNull();
    expect(screen.getByTestId("scroll-right")).toBeTruthy();
  });

  it("hides right arrow when scrolled to end", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");
    const { container } = render(<TabBar />);

    const tabsContainer = container.querySelector(".overflow-x-auto") as HTMLDivElement;

    Object.defineProperty(tabsContainer, "scrollWidth", { value: 500, configurable: true });
    Object.defineProperty(tabsContainer, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(tabsContainer, "scrollLeft", { value: 300, configurable: true, writable: true });

    fireEvent.scroll(tabsContainer);

    expect(screen.getByTestId("scroll-left")).toBeTruthy();
    expect(screen.queryByTestId("scroll-right")).toBeNull();
  });

  it("calls scrollBy when clicking scroll arrows", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");
    const { container } = render(<TabBar />);

    const tabsContainer = container.querySelector(".overflow-x-auto") as HTMLDivElement;

    Object.defineProperty(tabsContainer, "scrollWidth", { value: 500, configurable: true });
    Object.defineProperty(tabsContainer, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(tabsContainer, "scrollLeft", { value: 50, configurable: true, writable: true });

    const scrollBySpy = vi.fn();
    tabsContainer.scrollBy = scrollBySpy;

    fireEvent.scroll(tabsContainer);

    fireEvent.click(screen.getByTestId("scroll-right"));
    expect(scrollBySpy).toHaveBeenCalledWith({ left: 150, behavior: "smooth" });

    fireEvent.click(screen.getByTestId("scroll-left"));
    expect(scrollBySpy).toHaveBeenCalledWith({ left: -150, behavior: "smooth" });
  });

  it("hides both arrows when no overflow", () => {
    openFiles("/a.ts");
    render(<TabBar />);

    // Default jsdom: scrollWidth === clientWidth === 0, scrollLeft === 0
    expect(screen.queryByTestId("scroll-left")).toBeNull();
    expect(screen.queryByTestId("scroll-right")).toBeNull();
  });

  it("converts vertical wheel deltaY to horizontal scroll", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");
    const { container } = render(<TabBar />);

    const tabsContainer = container.querySelector(".overflow-x-auto") as HTMLDivElement;

    // Set initial scrollLeft
    Object.defineProperty(tabsContainer, "scrollLeft", { value: 0, configurable: true, writable: true });

    fireEvent.wheel(tabsContainer, { deltaY: 100 });

    expect(tabsContainer.scrollLeft).toBe(100);
  });
});

describe("TabBar — context menu", () => {
  it("shows context menu on right-click with all expected items", () => {
    openFiles("/a.ts", "/b.ts");
    render(<TabBar />);

    const tabs = getTabButtons();
    fireEvent.contextMenu(tabs[0], { clientX: 100, clientY: 200 });

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("关闭")).toBeTruthy();
    expect(screen.getByText("关闭其他")).toBeTruthy();
    expect(screen.getByText("关闭右侧所有")).toBeTruthy();
    expect(screen.getByText("关闭已保存的")).toBeTruthy();
    expect(screen.getByText("复制文件路径")).toBeTruthy();
    expect(screen.getByText("在侧边栏中定位")).toBeTruthy();
  });

  it("closes the right-clicked tab when '关闭' is selected", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");
    render(<TabBar />);

    const tabs = getTabButtons();
    fireEvent.contextMenu(tabs[1], { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByText("关闭"));

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/a.ts", "/c.ts"]);
  });

  it("closes all other tabs when '关闭其他' is selected", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");
    render(<TabBar />);

    const tabs = getTabButtons();
    fireEvent.contextMenu(tabs[1], { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByText("关闭其他"));

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/b.ts"]);
  });

  it("closes tabs to the right when '关闭右侧所有' is selected", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts", "/d.ts");
    render(<TabBar />);

    const tabs = getTabButtons();
    fireEvent.contextMenu(tabs[1], { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByText("关闭右侧所有"));

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/a.ts", "/b.ts"]);
  });

  it("closes only saved (non-modified) tabs when '关闭已保存的' is selected", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");
    // Mark /b.ts as modified
    useEditor.getState().updateContent("/b.ts", "modified content");
    render(<TabBar />);

    const tabs = getTabButtons();
    fireEvent.contextMenu(tabs[0], { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByText("关闭已保存的"));

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/b.ts"]);
  });

  it("copies file path to clipboard when '复制文件路径' is selected", () => {
    openFiles("/src/hello.ts");
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(<TabBar />);

    const tabs = getTabButtons();
    fireEvent.contextMenu(tabs[0], { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByText("复制文件路径"));

    expect(writeTextMock).toHaveBeenCalledWith("/src/hello.ts");
  });

  it("dispatches ftre:reveal-in-sidebar event when '在侧边栏中定位' is selected", () => {
    openFiles("/src/hello.ts");
    const handler = vi.fn();
    window.addEventListener("ftre:reveal-in-sidebar", handler);

    render(<TabBar />);

    const tabs = getTabButtons();
    fireEvent.contextMenu(tabs[0], { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByText("在侧边栏中定位"));

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ path: "/src/hello.ts" });

    window.removeEventListener("ftre:reveal-in-sidebar", handler);
  });

  it("closes context menu after selecting an item", () => {
    openFiles("/a.ts", "/b.ts");
    render(<TabBar />);

    const tabs = getTabButtons();
    fireEvent.contextMenu(tabs[0], { clientX: 100, clientY: 200 });
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.click(screen.getByText("关闭其他"));

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not close tabs to the right when right-clicking the last tab", () => {
    openFiles("/a.ts", "/b.ts", "/c.ts");
    render(<TabBar />);

    const tabs = getTabButtons();
    fireEvent.contextMenu(tabs[2], { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByText("关闭右侧所有"));

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/a.ts", "/b.ts", "/c.ts"]);
  });
});
