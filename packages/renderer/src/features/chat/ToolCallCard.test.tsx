import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToolCallCard } from "./ToolCallCard";
import type { ToolCallMessage } from "@/types/chat";

// ── Mock toolActions ─────────────────────────────────────────────────

const mockHandleOpenFile = vi.fn().mockResolvedValue(undefined);
const mockHandleShowDiff = vi.fn().mockResolvedValue(undefined);

vi.mock("./toolActions", () => ({
  handleOpenFile: (...args: unknown[]) => mockHandleOpenFile(...args),
  handleShowDiff: (...args: unknown[]) => mockHandleShowDiff(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────

function makeMsg(
  name: string,
  args: Record<string, unknown> = {},
  status: ToolCallMessage["status"] = "completed",
  result?: string,
): ToolCallMessage {
  return {
    id: `msg-${name}`,
    role: "tool",
    toolId: `tool-${name}`,
    name,
    arguments: args,
    status,
    result,
  };
}

beforeEach(() => {
  mockHandleOpenFile.mockClear();
  mockHandleShowDiff.mockClear();
});

// ── FileNavCard (read/write) ─────────────────────────────────────────

describe("ToolCallCard — read/write (FileNavCard)", () => {
  it("renders tool name and file basename", () => {
    render(<ToolCallCard message={makeMsg("read", { filePath: "/home/user/src/index.ts" })} />);
    expect(screen.getByText("read")).toBeTruthy();
    expect(screen.getByText("index.ts")).toBeTruthy();
  });

  it("calls handleOpenFile on click for read tool", async () => {
    render(<ToolCallCard message={makeMsg("read", { filePath: "src/a.ts" })} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(mockHandleOpenFile).toHaveBeenCalledWith("src/a.ts");
    });
  });

  it("calls handleOpenFile on click for write tool", async () => {
    render(<ToolCallCard message={makeMsg("write", { filePath: "src/b.ts" })} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(mockHandleOpenFile).toHaveBeenCalledWith("src/b.ts");
    });
  });

  it("is disabled when status is running", () => {
    render(<ToolCallCard message={makeMsg("read", { filePath: "f.ts" }, "running")} />);
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });

  it("shows spinner when status is running", () => {
    render(<ToolCallCard message={makeMsg("read", { filePath: "f.ts" }, "running")} />);
    expect(screen.getByTestId("status-running")).toBeTruthy();
  });

  it("shows error indicator when status is error", () => {
    render(<ToolCallCard message={makeMsg("read", { filePath: "f.ts" }, "error")} />);
    expect(screen.getByTestId("status-error")).toBeTruthy();
  });
});

// ── DiffNavCard (edit) ───────────────────────────────────────────────

describe("ToolCallCard — edit (DiffNavCard)", () => {
  it("renders edit label and file basename", () => {
    render(<ToolCallCard message={makeMsg("edit", { filePath: "src/utils.ts", oldString: "a", newString: "b" })} />);
    expect(screen.getByText("edit")).toBeTruthy();
    expect(screen.getByText("utils.ts")).toBeTruthy();
  });

  it("calls handleShowDiff on click", async () => {
    const msg = makeMsg("edit", { filePath: "src/a.ts", oldString: "foo", newString: "bar" });
    render(<ToolCallCard message={msg} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(mockHandleShowDiff).toHaveBeenCalledWith(msg);
    });
  });

  it("is disabled when status is running", () => {
    render(<ToolCallCard message={makeMsg("edit", { filePath: "f.ts" }, "running")} />);
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });
});

// ── ThinkCard ────────────────────────────────────────────────────────

describe("ToolCallCard — think (ThinkCard)", () => {
  it("renders thinking label", () => {
    render(<ToolCallCard message={makeMsg("think", { thought: "Let me analyze..." })} />);
    expect(screen.getByText("thinking")).toBeTruthy();
  });

  it("shows preview of thought content when collapsed", () => {
    render(<ToolCallCard message={makeMsg("think", { thought: "Let me analyze the code structure" })} />);
    expect(screen.getByText(/Let me analyze/)).toBeTruthy();
  });

  it("expands to show full thought content on click", () => {
    render(<ToolCallCard message={makeMsg("think", { thought: "Full thinking content here" }, "completed", "Full thinking content here")} />);
    fireEvent.click(screen.getByTestId("tool-card-header"));
    // After expanding, the full content should be visible in the expanded area
    const elements = screen.getAllByText(/Full thinking content here/);
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it("collapses on second click", () => {
    render(<ToolCallCard message={makeMsg("think", { thought: "content" }, "completed", "content")} />);
    const header = screen.getByTestId("tool-card-header");
    fireEvent.click(header);
    fireEvent.click(header);
    // Should be back to collapsed state — only preview visible
  });
});

// ── GenericCard (bash, search, etc.) ─────────────────────────────────

describe("ToolCallCard — bash (GenericCard)", () => {
  it("renders tool name and command summary", () => {
    render(<ToolCallCard message={makeMsg("bash", { command: "npm install" })} />);
    expect(screen.getByText("bash")).toBeTruthy();
    expect(screen.getByTestId("tool-summary").textContent).toBe("npm install");
  });

  it("does not show expanded content by default", () => {
    render(<ToolCallCard message={makeMsg("bash", { command: "ls" }, "completed", "output")} />);
    expect(screen.queryByText("$ ls")).toBeNull();
  });

  it("shows expanded content after clicking header", () => {
    render(<ToolCallCard message={makeMsg("bash", { command: "ls" }, "completed", "output")} />);
    fireEvent.click(screen.getByTestId("tool-card-header"));
    // $ is in a span, "ls" is a text node — check the container div contains both
    const container = screen.getByText("$").closest("div");
    expect(container?.textContent).toContain("ls");
  });

  it("truncates long command in summary", () => {
    const longCmd = "a".repeat(80);
    render(<ToolCallCard message={makeMsg("bash", { command: longCmd })} />);
    expect(screen.getByTestId("tool-summary").textContent).toBe("a".repeat(60) + "…");
  });
});

describe("ToolCallCard — search (GenericCard)", () => {
  it("renders tool name and pattern", () => {
    render(<ToolCallCard message={makeMsg("grep", { pattern: "TODO" })} />);
    expect(screen.getByText("grep")).toBeTruthy();
    expect(screen.getByTestId("tool-summary").textContent).toBe("TODO");
  });

  it("shows search results when expanded", () => {
    render(<ToolCallCard message={makeMsg("grep", { pattern: "TODO" }, "completed", "match1\nmatch2")} />);
    fireEvent.click(screen.getByTestId("tool-card-header"));
    expect(screen.getByText(/match1/)).toBeTruthy();
  });
});

// ── Status indicators ────────────────────────────────────────────────

describe("ToolCallCard — status indicators", () => {
  it("shows spinner for running bash tool", () => {
    render(<ToolCallCard message={makeMsg("bash", { command: "ls" }, "running")} />);
    expect(screen.getByTestId("status-running")).toBeTruthy();
  });

  it("shows error icon for error bash tool", () => {
    render(<ToolCallCard message={makeMsg("bash", { command: "ls" }, "error")} />);
    expect(screen.getByTestId("status-error")).toBeTruthy();
  });

  it("shows cancelled icon for cancelled tool", () => {
    render(<ToolCallCard message={makeMsg("bash", { command: "ls" }, "cancelled")} />);
    expect(screen.getByTestId("status-cancelled")).toBeTruthy();
  });
});
