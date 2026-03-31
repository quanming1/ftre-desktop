import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { useLayout } from "@/stores/layout";

// Mock ExplorerView to avoid heavy dependencies
vi.mock("./ExplorerView", () => ({
  ExplorerView: () => <div data-testid="explorer-view">Explorer</div>,
}));

// Mock GitPanel to avoid heavy dependencies
vi.mock("@/features/git/GitPanel", () => ({
  GitPanel: () => <div data-testid="git-panel">GitPanel</div>,
}));

beforeEach(() => {
  useLayout.setState({
    activeSidebarView: null,
    sidebarWidth: 220,
    sidebarVisible: true,
  });
});

describe("Sidebar — view switching", () => {
  it("renders nothing when activeSidebarView is null", () => {
    useLayout.setState({ activeSidebarView: null });
    const { container } = render(<Sidebar />);
    expect(container.innerHTML).toBe("");
  });

  it("renders ExplorerView when activeSidebarView is 'explorer'", () => {
    useLayout.setState({ activeSidebarView: "explorer" });
    render(<Sidebar />);
    expect(screen.getByTestId("explorer-view")).toBeTruthy();
  });

  it("renders GitPanel for git view", () => {
    useLayout.setState({ activeSidebarView: "git" });
    render(<Sidebar />);
    expect(screen.getByTestId("git-panel")).toBeTruthy();
  });

  it("renders placeholder for extensions view", () => {
    useLayout.setState({ activeSidebarView: "extensions" });
    render(<Sidebar />);
    expect(screen.getByText("Extensions")).toBeTruthy();
  });
});


