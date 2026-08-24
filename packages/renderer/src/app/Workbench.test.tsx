import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useLayout } from "@/stores/layout";

// Mock heavy child components to keep the test focused on Workbench mount behavior
vi.mock("./TitleBar", () => ({ TitleBar: () => <div data-testid="title-bar" /> }));
vi.mock("@/features/session/SessionPanel", () => ({ SessionPanel: () => <div data-testid="session-panel" /> }));
vi.mock("@/features/settings/SettingsPanel", () => ({ SettingsPanel: () => <div data-testid="settings-panel" /> }));
vi.mock("@/features/chat/ChatPanel", () => ({ ChatPanel: () => <div data-testid="chat-panel" /> }));
vi.mock("@/components/FilePalette", () => ({ FilePalette: () => null }));
vi.mock("@/components/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/NotificationStack", () => ({ NotificationStack: () => null }));
vi.mock("@/lib/shortcuts", () => ({ useGlobalShortcuts: () => {} }));
vi.mock("@/lib/default-shortcuts", () => ({ registerDefaultShortcuts: () => {} }));
vi.mock("@/services/global-event-stream", () => ({
  globalEventStream: { connect: () => {}, disconnect: () => {} },
}));
vi.mock("@/services/performance-metrics", () => ({
  performanceMetrics: { count: () => {} },
}));

// Import Workbench after mocks are set up
import { Workbench } from "./Workbench";

beforeEach(() => {
  localStorage.clear();
  useLayout.setState({
    centerRatio: 70,
    minimapEnabled: false,
    activeLeftPanel: "chat",
  });
});

describe("Workbench — layout restore on mount", () => {
  it("calls restore() on mount to load persisted layout", () => {
    const restoreSpy = vi.spyOn(useLayout.getState(), "restore");
    render(<Workbench />);
    expect(restoreSpy).toHaveBeenCalledTimes(1);
    restoreSpy.mockRestore();
  });

  it("restores persisted layout values from localStorage on mount", () => {
    // Pre-populate localStorage with custom layout
    localStorage.setItem(
      "ftre-layout-state",
      JSON.stringify({
        centerRatio: 60,
        minimapEnabled: true,
      }),
    );

    render(<Workbench />);

    const state = useLayout.getState();
    expect(state.centerRatio).toBe(60);
    expect(state.minimapEnabled).toBe(true);
  });

  it("uses default layout when localStorage is empty", () => {
    render(<Workbench />);

    const state = useLayout.getState();
    expect(state.centerRatio).toBe(70);
    expect(state.minimapEnabled).toBe(false);
  });

  it("falls back to defaults when localStorage contains corrupted data", () => {
    localStorage.setItem("ftre-layout-state", "{invalid json!!!");
    // Set non-default values to verify they get reset
    useLayout.setState({ centerRatio: 99 });

    render(<Workbench />);

    expect(useLayout.getState().centerRatio).toBe(70);
  });
});
