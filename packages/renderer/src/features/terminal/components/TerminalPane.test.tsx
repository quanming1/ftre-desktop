import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalPane } from "./TerminalPane";

const { getXterm } = vi.hoisted(() => ({
  getXterm: vi.fn(() => null),
}));

vi.mock("@/services/terminal", () => ({
  terminalManager: {
    getXterm,
    clearTerminal: vi.fn(),
    restartTerminal: vi.fn(),
  },
}));
vi.mock("@ftre/ui", () => ({
  ContextMenu: () => null,
}));

describe("TerminalPane", () => {
  it("使用不带 padding 的内层容器供 FitAddon 测量，避免末行被裁切", () => {
    const containerRef = vi.fn();

    render(
      <TerminalPane
        instance={{
          id: "term-1",
          ptyId: 1,
          label: "workspace",
          createdAt: 1,
          exited: false,
          exitCode: null,
        }}
        isActive
        containerRef={containerRef}
      />,
    );

    const measuredContainer = containerRef.mock.calls.at(-1)?.[1] as HTMLDivElement;
    expect(measuredContainer).toHaveClass("absolute", "inset-4");
    expect(measuredContainer.parentElement).toHaveClass("absolute", "inset-0", "overflow-hidden");
  });
});
