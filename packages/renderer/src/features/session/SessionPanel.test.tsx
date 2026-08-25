import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionPanel } from "./SessionPanel";

const sessionState = vi.hoisted(() => ({
  allSessions: [] as any[],
  sessionsTotal: 0,
  workspacePaging: {} as Record<string, any>,
  wsFlatPaging: { total: 0, loaded: 0 },
  sortMode: "workspace" as const,
  loadAllSessions: vi.fn(),
  loadMoreWorkspaceSessions: vi.fn(),
  loadMoreGlobalSessions: vi.fn(),
  setSortMode: vi.fn(),
  loadMoreSessions: vi.fn(),
  switchSession: vi.fn(),
  deleteSession: vi.fn(),
  newSession: vi.fn(),
  loadingSessionId: null as string | null,
  unreadSessions: new Set<string>(),
}));

// Mock stores
vi.mock("@/stores/session", () => ({
  useSession: (selector: (s: any) => any) =>
    selector(sessionState),
}));

vi.mock("@/stores/chat", () => ({
  useChat: (selector: (s: any) => any) => selector({ sessionId: null }),
}));

vi.mock("@/stores/workspace", () => ({
  useWorkspace: (selector: (s: any) => any) =>
    selector({
      rootPath: "/test/project",
      setRootPath: vi.fn(),
    }),
}));

vi.mock("@/stores/layout", () => ({
  useLayout: (selector: (s: any) => any) =>
    selector({
      activeLeftPanel: "chat",
      sessionsCollapsed: false,
      sessionsWidth: 240,
      setActiveLeftPanel: vi.fn(),
      locateTraceSession: vi.fn(),
      toggleSessionsCollapsed: vi.fn(),
    }),
}));

vi.mock("@/stores/notification", () => ({
  useNotification: { getState: () => ({ addNotification: vi.fn() }) },
}));

vi.mock("@/services/api", () => ({
  triggerCompaction: vi.fn(),
  updateSession: vi.fn(),
}));

describe("SessionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionState.allSessions = [];
    sessionState.workspacePaging = {};
    sessionState.wsFlatPaging = { total: 0, loaded: 0 };
    sessionState.loadingSessionId = null;
    sessionState.unreadSessions.clear();
  });

  it("renders the top action zone (New thread / Cron / Skills)", () => {
    render(<SessionPanel />);
    expect(screen.getByText("新会话")).toBeInTheDocument();
    expect(screen.getByText("定时任务")).toBeInTheDocument();
    expect(screen.getByText("技能")).toBeInTheDocument();
  });

  it("renders the Threads section header and bottom Settings action", () => {
    render(<SessionPanel />);
    expect(screen.getByText("Ws Threads")).toBeInTheDocument();
    expect(screen.getByText("设置")).toBeInTheDocument();
  });

  it("shows empty placeholder when no sessions exist", () => {
    render(<SessionPanel />);
    expect(screen.getByText("暂无会话")).toBeInTheDocument();
  });

  it("keeps the row compact and shows session details in the tooltip", async () => {
    sessionState.allSessions = [
      {
        session_id: "ws_s1",
        title: "分析 cordis-py 项目架构",
        channel: "ws",
        workspace: "E:/ftre-agent-core",
        updated_at: Date.now() / 1000,
        last_user_text: "这是最后一条用户消息",
      },
    ];

    render(<SessionPanel />);

    expect(screen.getByTestId("session-row-ws_s1")).toHaveClass("h-9");
    expect(screen.queryByText("这是最后一条用户消息")).not.toBeInTheDocument();

    fireEvent.pointerMove(screen.getByTestId("session-row-ws_s1"));

    await waitFor(() => {
      expect(screen.getAllByText("这是最后一条用户消息").length).toBeGreaterThan(0);
      expect(screen.getAllByText("ftre-agent-core").length).toBeGreaterThan(0);
    });
  });
});
