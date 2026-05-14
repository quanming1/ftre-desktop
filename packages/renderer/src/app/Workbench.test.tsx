import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useLayout } from "@/stores/layout";

// Mock heavy child components to keep the test focused on Workbench mount behavior
vi.mock("./TitleBar", () => ({ TitleBar: () => <div data-testid="title-bar" /> }));
vi.mock("./ActivityBar", () => ({ ActivityBar: () => <div data-testid="activity-bar" /> }));
vi.mock("@/features/session/SessionPanel", () => ({ SessionPanel: () => <div data-testid="session-panel" /> }));
vi.mock("@/features/settings/SettingsPanel", () => ({ SettingsPanel: () => <div data-testid="settings-panel" /> }));
vi.mock("@/features/explorer/Sidebar", () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock("@/features/editor/EditorArea", () => ({ EditorArea: () => <div data-testid="editor-area" /> }));
vi.mock("@/features/chat/ChatPanel", () => ({ ChatPanel: () => <div data-testid="chat-panel" /> }));
vi.mock("@/features/bottom-panel/BottomPanel", () => ({ BottomPanel: () => <div data-testid="bottom-panel" /> }));
vi.mock("@/components/FilePalette", () => ({ FilePalette: () => null }));
vi.mock("@/components/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/NotificationStack", () => ({ NotificationStack: () => null }));
vi.mock("@/components/ResizeHandle", () => ({ ResizeHandle: () => <div /> }));
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
    activeSidebarView: "explorer",
    sidebarWidth: 220,
    centerRatio: 70,
    bottomPanelHeight: 200,
    sidebarVisible: true,
    bottomPanelVisible: false,
    activeBottomTab: "terminal",
    minimapEnabled: false,
    splitMode: "ai-center",
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
        sidebarWidth: 350,
        centerRatio: 60,
        bottomPanelHeight: 300,
        sidebarVisible: false,
        bottomPanelVisible: true,
        activeSidebarView: "git",
        activeBottomTab: "problems",
        minimapEnabled: true,
        splitMode: "code-center",
      }),
    );

    render(<Workbench />);

    const state = useLayout.getState();
    expect(state.sidebarWidth).toBe(350);
    expect(state.centerRatio).toBe(60);
    expect(state.bottomPanelHeight).toBe(300);
    expect(state.activeSidebarView).toBe("git");
    expect(state.activeBottomTab).toBe("problems");
    expect(state.minimapEnabled).toBe(true);
    expect(state.splitMode).toBe("code-center");
  });

  it("uses default layout when localStorage is empty", () => {
    render(<Workbench />);

    const state = useLayout.getState();
    expect(state.sidebarWidth).toBe(220);
    expect(state.centerRatio).toBe(70);
    expect(state.bottomPanelHeight).toBe(200);
    expect(state.activeSidebarView).toBe("explorer");
    expect(state.minimapEnabled).toBe(false);
    expect(state.splitMode).toBe("ai-center");
  });

  it("falls back to defaults when localStorage contains corrupted data", () => {
    localStorage.setItem("ftre-layout-state", "{invalid json!!!");
    // Set non-default values to verify they get reset
    useLayout.setState({ sidebarWidth: 999 });

    render(<Workbench />);

    expect(useLayout.getState().sidebarWidth).toBe(220);
  });
});
