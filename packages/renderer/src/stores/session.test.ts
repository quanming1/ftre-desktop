import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSession } from "./session";
import { useChat } from "./chat";

// Mock the API module
vi.mock("@/services/api", () => ({
  fetchSessions: vi.fn().mockResolvedValue([]),
  fetchSessionMessages: vi.fn().mockResolvedValue([]),
  fetchUsage: vi.fn().mockResolvedValue(0),
}));

// Mock websocket-client (chat.ts uses it directly)
vi.mock("@/services/websocket-client", () => ({
  wsClient: {
    onMessage: vi.fn(),
    onDisconnect: vi.fn(),
    onConnect: vi.fn(),
    onStatusChange: vi.fn(),
    chatSend: vi.fn(),
    sessionNew: vi.fn(),
    sessionAttach: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
    status: "disconnected",
  },
}));

// Mock workspace store
vi.mock("./workspace", () => ({
  useWorkspace: {
    getState: () => ({ rootPath: "/test", setRootPath: vi.fn() }),
  },
}));

function resetStores() {
  useSession.setState({
    sessions: [],
    allSessions: [],
    openTabs: [],
    loading: false,
  });
  useChat.setState({
    sessionId: null,
    activeChatId: null,
    messages: [],
    isBusy: false,
    error: null,
    connected: false,
    model: null,
    contextTokens: 0,
    mode: "chat",
    agentId: "code_agent",
    retryState: null,
    toolCalls: [],
    progress: null,
  });
}

beforeEach(() => {
  resetStores();
  vi.clearAllMocks();
});

describe("session store — basic operations", () => {
  it("starts with empty sessions", () => {
    expect(useSession.getState().sessions).toEqual([]);
    expect(useSession.getState().allSessions).toEqual([]);
    expect(useSession.getState().loading).toBe(false);
  });

  it("openTab adds session to openTabs", () => {
    useSession.getState().openTab("s1");
    expect(useSession.getState().openTabs).toContain("s1");
  });

  it("openTab is idempotent", () => {
    useSession.getState().openTab("s1");
    useSession.getState().openTab("s1");
    expect(
      useSession.getState().openTabs.filter((id) => id === "s1"),
    ).toHaveLength(1);
  });

  it("closeTab removes session from openTabs", () => {
    useSession.getState().openTab("s1");
    useSession.getState().openTab("s2");
    useSession.getState().closeTab("s1");
    expect(useSession.getState().openTabs).not.toContain("s1");
    expect(useSession.getState().openTabs).toContain("s2");
  });

  it("newSession calls wsClient.sessionNew", async () => {
    const { wsClient } = await import("@/services/websocket-client");
    useSession.getState().newSession();
    expect(wsClient.sessionNew).toHaveBeenCalled();
  });

  it("switchSession calls wsClient.sessionAttach", async () => {
    const { wsClient } = await import("@/services/websocket-client");
    await useSession.getState().switchSession("s1");
    expect(wsClient.sessionAttach).toHaveBeenCalledWith("s1");
  });

  it("switchSession adds to openTabs", async () => {
    await useSession.getState().switchSession("s1");
    expect(useSession.getState().openTabs).toContain("s1");
  });

  it("deleteSession removes from sessions", async () => {
    useSession.setState({
      sessions: [
        { session_id: "s1", title: "Test" },
        { session_id: "s2", title: "Test2" },
      ],
    });
    await useSession.getState().deleteSession("s1");
    expect(
      useSession.getState().sessions.find((s) => s.session_id === "s1"),
    ).toBeUndefined();
  });

  it("patchSession updates session meta", () => {
    useSession.setState({
      sessions: [
        { session_id: "s1", title: "Test", agent_id: "code_agent", meta: {} },
      ],
    });
    useSession
      .getState()
      .patchSession("s1", { model: "gpt-4", agentId: "plan_agent" });
    const session = useSession
      .getState()
      .sessions.find((s) => s.session_id === "s1");
    expect(session?.agent_id).toBe("plan_agent");
    expect(session?.meta?.model).toBe("gpt-4");
  });
});
