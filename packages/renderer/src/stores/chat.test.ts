import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChat } from "./chat";

vi.mock("@/services/websocket-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/websocket-client")>();
  return {
    ...actual,
    wsClient: {
      onMessage: vi.fn(),
      onDisconnect: vi.fn(),
      onConnect: vi.fn(),
      onStatusChange: vi.fn(),
      sendChat: vi.fn(),
      sendCancel: vi.fn(),
      subscribeOnly: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      connected: false,
      status: "disconnected",
    },
  };
});

function resetStore() {
  useChat.getState().newChat();
  useChat.setState({
    connected: false,
    wsStatus: "disconnected",
    model: null,
    provider: null,
    agentId: "default",
  });
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe("chat store", () => {
  it("starts with an empty idle conversation", () => {
    const state = useChat.getState();
    expect(state.messages).toEqual([]);
    expect(state.sessionId).toBeNull();
    expect(state.sessionStatus).toBe("idle");
  });

  it("updates model, provider and agent", () => {
    const state = useChat.getState();
    state.setModel("gpt-4");
    state.setProvider("openai");
    state.setAgentId("reviewer");

    expect(useChat.getState()).toMatchObject({
      model: "gpt-4",
      provider: "openai",
      agentId: "reviewer",
    });
  });

  it("newChat resets the active conversation", async () => {
    const { wsClient } = await import("@/services/websocket-client");
    useChat.setState({
      sessionId: "s1",
      messages: [{ id: "u1", role: "user", content: "hello", timestamp: 1 }],
      isBusy: true,
      sessionStatus: "running",
    });

    useChat.getState().newChat();

    expect(useChat.getState()).toMatchObject({
      sessionId: null,
      messages: [],
      isBusy: false,
      sessionStatus: "idle",
    });
    expect(wsClient.subscribeOnly).toHaveBeenCalledWith(null);
  });

  it("sends non-empty content through the active session", async () => {
    const { wsClient } = await import("@/services/websocket-client");
    useChat.setState({ sessionId: "s1" });

    useChat.getState().sendMessage(" hello ");

    expect(wsClient.sendChat).toHaveBeenCalledWith(
      [{ type: "text", text: "hello" }],
      expect.objectContaining({ session_id: "s1", agent_id: "default" }),
      undefined,
      expect.any(String),
    );
    const messages = useChat.getState().messages;
    expect(messages[messages.length - 1]).toMatchObject({
      role: "user",
      content: "hello",
    });
  });

  it("does not send empty content", async () => {
    const { wsClient } = await import("@/services/websocket-client");
    useChat.setState({ sessionId: "s1" });

    useChat.getState().sendMessage("   ");

    expect(wsClient.sendChat).not.toHaveBeenCalled();
  });
});
