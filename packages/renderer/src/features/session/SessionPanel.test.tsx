import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionPanel } from "./SessionPanel";

// Mock stores
vi.mock("@/stores/session", () => ({
  useSession: (selector: (s: any) => any) =>
    selector({
      allSessions: [],
      loadAllSessions: vi.fn(),
      switchSession: vi.fn(),
      deleteSession: vi.fn(),
      newSession: vi.fn(),
    }),
}));

vi.mock("@/stores/chat", () => ({
  useChat: (selector: (s: any) => any) => selector({ sessionId: null }),
}));

vi.mock("@/stores/workspace", () => ({
  useWorkspace: (selector: (s: any) => any) =>
    selector({
      rootPath: "/test/project",
      recentFolders: ["/test/project", "/other/project"],
      setRootPath: vi.fn(),
      removeRecentFolder: vi.fn(),
      reorderFolders: vi.fn(),
    }),
}));

describe("SessionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing", () => {
    render(<SessionPanel />);
    expect(screen.getByText("Open Workspace")).toBeInTheDocument();
  });

  it("displays workspace folders", () => {
    render(<SessionPanel />);
    // Both workspaces show "project" as folder name
    const projects = screen.getAllByText("project");
    expect(projects.length).toBe(2);
  });

  it("shows session counts for workspaces", () => {
    render(<SessionPanel />);
    // Both workspaces should show (0) since there are no sessions
    const counts = screen.getAllByText(/\(0\)/);
    expect(counts.length).toBe(2);
  });
});
