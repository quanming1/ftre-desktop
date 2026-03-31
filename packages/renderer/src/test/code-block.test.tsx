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
  it("displays the language label", () => {
    render(<CodeBlock language="typescript" code="const x = 1;" />);
    expect(screen.getByTestId("code-lang")).toHaveTextContent("typescript");
  });

  it("displays 'text' when language is empty", () => {
    render(<CodeBlock language="" code="hello" />);
    expect(screen.getByTestId("code-lang")).toHaveTextContent("text");
  });

  it("renders the code content", () => {
    render(<CodeBlock language="javascript" code='console.log("hi");' />);
    expect(screen.getByTestId("code-content")).toHaveTextContent('console.log("hi");');
  });

  it("copies code to clipboard and shows 'Copied' briefly", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CodeBlock language="python" code="print('hello')" />);

    const copyBtn = screen.getByTestId("copy-btn");
    expect(copyBtn).toHaveTextContent("Copy");

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeText).toHaveBeenCalledWith("print('hello')");
    expect(copyBtn).toHaveTextContent("Copied");

    // After timeout, should revert
    await act(async () => {
      vi.useFakeTimers();
      vi.advanceTimersByTime(1600);
      vi.useRealTimers();
    });
  });

  it("does not show Apply button (removed)", () => {
    render(<CodeBlock language="rust" code="fn main() {}" />);
    expect(screen.queryByTestId("apply-btn")).toBeNull();
  });
});
