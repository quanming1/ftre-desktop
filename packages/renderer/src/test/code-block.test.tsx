import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CodeBlock } from "@/features/chat/CodeBlock";

// ── mocks ────────────────────────────────────────────────────────────

vi.mock("highlight.js/lib/common", () => ({
  default: {
    highlightElement: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ── tests ────────────────────────────────────────────────────────────

describe("CodeBlock", () => {
  it("displays a friendly language label", () => {
    render(<CodeBlock language="typescript" code="const x = 1;" />);
    expect(screen.getByTestId("code-lang")).toHaveTextContent("TypeScript");
  });

  it("displays 'Text' fallback when language is empty", () => {
    render(<CodeBlock language="" code="hello" />);
    expect(screen.getByTestId("code-lang")).toHaveTextContent("Text");
  });

  it("renders the code content", () => {
    render(<CodeBlock language="javascript" code='console.log("hi");' />);
    expect(screen.getByTestId("code-content")).toHaveTextContent('console.log("hi");');
  });

  it("copies code to clipboard and shows feedback briefly", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CodeBlock language="python" code="print('hello')" />);

    const copyBtn = screen.getByTestId("copy-btn");
    expect(copyBtn).toHaveAttribute("aria-label", "Copy");

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeText).toHaveBeenCalledWith("print('hello')");
    expect(copyBtn).toHaveAttribute("aria-label", "Copied");

    await act(async () => {
      vi.useFakeTimers();
      vi.advanceTimersByTime(1600);
      vi.useRealTimers();
    });
  });

  it("exposes a download button next to copy", () => {
    render(<CodeBlock language="rust" code="fn main() {}" />);
    expect(screen.getByTestId("download-btn")).toBeInTheDocument();
  });

  it("does not show Apply button (removed)", () => {
    render(<CodeBlock language="rust" code="fn main() {}" />);
    expect(screen.queryByTestId("apply-btn")).toBeNull();
  });
});
