import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchPanel } from "./SearchPanel";
import { useSearch, type SearchOptions } from "@/stores/search";

const defaultOptions: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  includePattern: "",
  excludePattern: "",
};

function resetStore() {
  useSearch.setState({
    query: "",
    results: [],
    isSearching: false,
    options: { ...defaultOptions },
  });
}

beforeEach(() => {
  resetStore();
});

describe("SearchPanel — rendering", () => {
  it("renders the search panel container", () => {
    render(<SearchPanel />);
    expect(screen.getByTestId("search-panel")).toBeTruthy();
  });

  it("renders search input with placeholder", () => {
    render(<SearchPanel />);
    const input = screen.getByTestId("search-input");
    expect(input).toBeTruthy();
    expect(input.getAttribute("placeholder")).toBe("搜索");
  });

  it("renders replace input with placeholder", () => {
    render(<SearchPanel />);
    const input = screen.getByTestId("replace-input");
    expect(input).toBeTruthy();
    expect(input.getAttribute("placeholder")).toBe("替换");
  });

  it("renders all three toggle buttons", () => {
    render(<SearchPanel />);
    expect(screen.getByTestId("toggle-case-sensitive")).toBeTruthy();
    expect(screen.getByTestId("toggle-whole-word")).toBeTruthy();
    expect(screen.getByTestId("toggle-regex")).toBeTruthy();
  });

  it("renders include and exclude pattern inputs", () => {
    render(<SearchPanel />);
    expect(screen.getByTestId("include-pattern")).toBeTruthy();
    expect(screen.getByTestId("exclude-pattern")).toBeTruthy();
  });
});

describe("SearchPanel — search query", () => {
  it("updates store query when typing in search input", () => {
    render(<SearchPanel />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "hello" },
    });
    expect(useSearch.getState().query).toBe("hello");
  });

  it("reflects store query value in the input", () => {
    useSearch.setState({ query: "existing" });
    render(<SearchPanel />);
    expect((screen.getByTestId("search-input") as HTMLInputElement).value).toBe("existing");
  });
});

describe("SearchPanel — toggle buttons", () => {
  it("toggles case sensitive option on click", () => {
    render(<SearchPanel />);
    const btn = screen.getByTestId("toggle-case-sensitive");
    expect(btn.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(btn);
    expect(useSearch.getState().options.caseSensitive).toBe(true);
  });

  it("toggles whole word option on click", () => {
    render(<SearchPanel />);
    fireEvent.click(screen.getByTestId("toggle-whole-word"));
    expect(useSearch.getState().options.wholeWord).toBe(true);
  });

  it("toggles regex option on click", () => {
    render(<SearchPanel />);
    fireEvent.click(screen.getByTestId("toggle-regex"));
    expect(useSearch.getState().options.useRegex).toBe(true);
  });

  it("toggles option off when clicked again", () => {
    render(<SearchPanel />);
    const btn = screen.getByTestId("toggle-case-sensitive");

    fireEvent.click(btn);
    expect(useSearch.getState().options.caseSensitive).toBe(true);

    fireEvent.click(btn);
    expect(useSearch.getState().options.caseSensitive).toBe(false);
  });

  it("reflects active state via aria-pressed", () => {
    useSearch.setState({
      options: { ...defaultOptions, caseSensitive: true, useRegex: true },
    });
    render(<SearchPanel />);

    expect(screen.getByTestId("toggle-case-sensitive").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("toggle-whole-word").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("toggle-regex").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("SearchPanel — glob patterns", () => {
  it("updates include pattern in store", () => {
    render(<SearchPanel />);
    fireEvent.change(screen.getByTestId("include-pattern"), {
      target: { value: "**/*.ts" },
    });
    expect(useSearch.getState().options.includePattern).toBe("**/*.ts");
  });

  it("updates exclude pattern in store", () => {
    render(<SearchPanel />);
    fireEvent.change(screen.getByTestId("exclude-pattern"), {
      target: { value: "node_modules/**" },
    });
    expect(useSearch.getState().options.excludePattern).toBe("node_modules/**");
  });

  it("reflects existing include pattern from store", () => {
    useSearch.setState({
      options: { ...defaultOptions, includePattern: "src/**" },
    });
    render(<SearchPanel />);
    expect((screen.getByTestId("include-pattern") as HTMLInputElement).value).toBe("src/**");
  });

  it("reflects existing exclude pattern from store", () => {
    useSearch.setState({
      options: { ...defaultOptions, excludePattern: "dist/**" },
    });
    render(<SearchPanel />);
    expect((screen.getByTestId("exclude-pattern") as HTMLInputElement).value).toBe("dist/**");
  });
});

describe("SearchPanel — accessibility", () => {
  it("search input has aria-label", () => {
    render(<SearchPanel />);
    expect(screen.getByTestId("search-input").getAttribute("aria-label")).toBe("搜索");
  });

  it("replace input has aria-label", () => {
    render(<SearchPanel />);
    expect(screen.getByTestId("replace-input").getAttribute("aria-label")).toBe("替换");
  });

  it("toggle buttons have aria-label and title", () => {
    render(<SearchPanel />);
    const caseSensitive = screen.getByTestId("toggle-case-sensitive");
    expect(caseSensitive.getAttribute("aria-label")).toBe("区分大小写");
    expect(caseSensitive.getAttribute("title")).toBe("区分大小写");
  });

  it("glob pattern inputs have aria-labels", () => {
    render(<SearchPanel />);
    expect(screen.getByTestId("include-pattern").getAttribute("aria-label")).toBe("包含的文件");
    expect(screen.getByTestId("exclude-pattern").getAttribute("aria-label")).toBe("排除的文件");
  });
});

import { vi } from "vitest";
import { useEditor } from "@/stores/editor";

// ── helpers ──────────────────────────────────────────────────────────

const mockSearchResults = [
  {
    filePath: "/project/src/app.ts",
    fileName: "app.ts",
    matches: [
      { lineNumber: 10, lineContent: "const app = createApp();", matchStart: 6, matchEnd: 9 },
      { lineNumber: 25, lineContent: "app.listen(3000);", matchStart: 0, matchEnd: 3 },
    ],
  },
  {
    filePath: "/project/src/utils.ts",
    fileName: "utils.ts",
    matches: [{ lineNumber: 5, lineContent: "export function appHelper() {}", matchStart: 16, matchEnd: 19 }],
  },
];

describe("SearchPanel — search trigger", () => {
  it("calls executeSearch when Enter is pressed in search input", () => {
    const executeSpy = vi.fn();
    useSearch.setState({ query: "test", executeSearch: executeSpy });
    render(<SearchPanel />);

    fireEvent.keyDown(screen.getByTestId("search-input"), { key: "Enter" });
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it("does not call executeSearch on other key presses", () => {
    const executeSpy = vi.fn();
    useSearch.setState({ query: "test", executeSearch: executeSpy });
    render(<SearchPanel />);

    fireEvent.keyDown(screen.getByTestId("search-input"), { key: "a" });
    expect(executeSpy).not.toHaveBeenCalled();
  });
});

describe("SearchPanel — loading state", () => {
  it("shows loading indicator when isSearching is true", () => {
    useSearch.setState({ isSearching: true, query: "test" });
    render(<SearchPanel />);

    expect(screen.getByTestId("search-loading")).toBeTruthy();
    expect(screen.getByText("搜索中...")).toBeTruthy();
  });

  it("does not show loading indicator when isSearching is false", () => {
    useSearch.setState({ isSearching: false, query: "test" });
    render(<SearchPanel />);

    expect(screen.queryByTestId("search-loading")).toBeNull();
  });
});

describe("SearchPanel — results display", () => {
  it("shows result summary with total matches and file count", () => {
    useSearch.setState({ query: "app", results: mockSearchResults, isSearching: false });
    render(<SearchPanel />);

    const summary = screen.getByTestId("search-summary");
    expect(summary.textContent).toContain("3 个结果");
    expect(summary.textContent).toContain("2 个文件");
  });

  it("renders file group headers with file name and match count", () => {
    useSearch.setState({ query: "app", results: mockSearchResults, isSearching: false });
    render(<SearchPanel />);

    const header1 = screen.getByTestId("search-file-header-/project/src/app.ts");
    expect(header1.textContent).toContain("app.ts");
    expect(header1.textContent).toContain("2");

    const header2 = screen.getByTestId("search-file-header-/project/src/utils.ts");
    expect(header2.textContent).toContain("utils.ts");
    expect(header2.textContent).toContain("1");
  });

  it("renders match items with line number and content", () => {
    useSearch.setState({ query: "app", results: mockSearchResults, isSearching: false });
    render(<SearchPanel />);

    const match10 = screen.getByTestId("search-match-10");
    expect(match10).toBeTruthy();
    expect(match10.textContent).toContain("10");
    expect(match10.textContent).toContain("const app = createApp();");

    const match25 = screen.getByTestId("search-match-25");
    expect(match25).toBeTruthy();
    expect(match25.textContent).toContain("25");
  });

  it("highlights matched text in results", () => {
    useSearch.setState({ query: "app", results: mockSearchResults, isSearching: false });
    render(<SearchPanel />);

    const highlights = screen.getAllByTestId("match-highlight");
    expect(highlights.length).toBe(3);
    expect(highlights[0].textContent).toBe("app");
    expect(highlights[1].textContent).toBe("app");
    expect(highlights[2].textContent).toBe("app");
  });

  it("shows 'No results found' when query is non-empty but results are empty", () => {
    useSearch.setState({ query: "nonexistent", results: [], isSearching: false });
    render(<SearchPanel />);

    expect(screen.getByTestId("search-no-results")).toBeTruthy();
    expect(screen.getByText("未找到结果。")).toBeTruthy();
  });

  it("does not show 'No results found' when query is empty", () => {
    useSearch.setState({ query: "", results: [], isSearching: false });
    render(<SearchPanel />);

    expect(screen.queryByTestId("search-no-results")).toBeNull();
  });

  it("does not show 'No results found' when query is only whitespace", () => {
    useSearch.setState({ query: "   ", results: [], isSearching: false });
    render(<SearchPanel />);

    expect(screen.queryByTestId("search-no-results")).toBeNull();
  });
});

describe("SearchPanel — collapsible file groups", () => {
  it("file groups are expanded by default", () => {
    useSearch.setState({ query: "app", results: mockSearchResults, isSearching: false });
    render(<SearchPanel />);

    const header = screen.getByTestId("search-file-header-/project/src/app.ts");
    expect(header.getAttribute("aria-expanded")).toBe("true");
    // Matches should be visible
    expect(screen.getByTestId("search-match-10")).toBeTruthy();
    expect(screen.getByTestId("search-match-25")).toBeTruthy();
  });

  it("clicking file header collapses the group and hides matches", () => {
    useSearch.setState({ query: "app", results: mockSearchResults, isSearching: false });
    render(<SearchPanel />);

    const header = screen.getByTestId("search-file-header-/project/src/app.ts");
    fireEvent.click(header);

    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("search-match-10")).toBeNull();
    expect(screen.queryByTestId("search-match-25")).toBeNull();
  });

  it("clicking collapsed file header expands it again", () => {
    useSearch.setState({ query: "app", results: mockSearchResults, isSearching: false });
    render(<SearchPanel />);

    const header = screen.getByTestId("search-file-header-/project/src/app.ts");
    fireEvent.click(header); // collapse
    fireEvent.click(header); // expand

    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("search-match-10")).toBeTruthy();
  });

  it("collapsing one file group does not affect another", () => {
    useSearch.setState({ query: "app", results: mockSearchResults, isSearching: false });
    render(<SearchPanel />);

    // Collapse first file group
    fireEvent.click(screen.getByTestId("search-file-header-/project/src/app.ts"));

    // Second file group should still be expanded
    expect(screen.getByTestId("search-match-5")).toBeTruthy();
  });
});

describe("SearchPanel — click to open file", () => {
  it("opens file in editor and dispatches goto-line event on match click", () => {
    useSearch.setState({ query: "app", results: mockSearchResults, isSearching: false });

    const openFileSpy = vi.fn();
    useEditor.setState({ openFile: openFileSpy });

    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(<SearchPanel />);

    fireEvent.click(screen.getByTestId("search-match-10"));

    expect(openFileSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/project/src/app.ts",
        name: "app.ts",
      }),
    );

    const gotoEvent = dispatchSpy.mock.calls.find(([e]) => (e as CustomEvent).type === "ftre:goto-line");
    expect(gotoEvent).toBeTruthy();
    const detail = (gotoEvent![0] as CustomEvent).detail;
    expect(detail.filePath).toBe("/project/src/app.ts");
    expect(detail.lineNumber).toBe(10);

    dispatchSpy.mockRestore();
  });
});

describe("SearchPanel — result summary grammar", () => {
  it("uses singular 'result' and 'file' for single match in single file", () => {
    useSearch.setState({
      query: "test",
      results: [
        {
          filePath: "/a.ts",
          fileName: "a.ts",
          matches: [{ lineNumber: 1, lineContent: "test", matchStart: 0, matchEnd: 4 }],
        },
      ],
      isSearching: false,
    });
    render(<SearchPanel />);

    const summary = screen.getByTestId("search-summary");
    expect(summary.textContent).toContain("1 个结果");
    expect(summary.textContent).toContain("1 个文件");
  });
});
