import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionPanel } from "./SessionPanel";

// Mock stores
vi.mock("@/stores/session", () => ({
  useSession: (selector: (s: any) => any) =>
    selector({
      allSessions: [],
      sessionsTotal: 0,
      loadAllSessions: vi.fn(),
      loadMoreSessions: vi.fn(),
      switchSession: vi.fn(),
      deleteSession: vi.fn(),
      newSession: vi.fn(),
      loadingSessionId: null,
    }),
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
      setActiveLeftPanel: vi.fn(),
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
  });

  it("renders the top action zone (New thread / Automations / Skills)", () => {
    render(<SessionPanel />);
    expect(screen.getByText("New thread")).toBeInTheDocument();
    expect(screen.getByText("Automations")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
  });

  it("renders the Threads section header and bottom Settings action", () => {
    render(<SessionPanel />);
    expect(screen.getByText("Ws Threads")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("shows empty placeholder when no sessions exist", () => {
    render(<SessionPanel />);
    expect(screen.getByText("暂无会话")).toBeInTheDocument();
  });
});
