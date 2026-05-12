import { describe, it, expect, beforeEach, vi } from "vitest";
import { useChat } from "./chat";

// Mock ws-stream-manager
vi.mock("@/services/ws-stream-manager", () => ({
  streamManager: {
    sendMessage: vi.fn(),
    newChat: vi.fn(),
    switchChat: vi.fn(),
    getSession: vi.fn(() => ({
      chatId: "",
      messages: [],
      toolCalls: [],
      progress: null,
      isBusy: false,
      error: null,
    })),
    getActiveSession: vi.fn(),
    onChange: vi.fn(),
    onFocus: vi.fn(),
    getAllChatIds: vi.fn(() => []),
  },
}));

function resetStore() {
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
  resetStore();
});

describe("chat store — basic state", () => {
  it("defaults to empty messages", () => {
    expect(useChat.getState().messages).toHaveLength(0);
  });

  it("defaults to chat mode", () => {
    expect(useChat.getState().mode).toBe("chat");
  });

  it("setMode switches to plan", () => {
    useChat.getState().setMode("plan");
    expect(useChat.getState().mode).toBe("plan");
  });

  it("setMode switches back to chat", () => {
    useChat.getState().setMode("plan");
    useChat.getState().setMode("chat");
    expect(useChat.getState().mode).toBe("chat");
  });
});

describe("chat store — model", () => {
  it("setModel updates model", () => {
    useChat.getState().setModel("gpt-4");
    expect(useChat.getState().model).toBe("gpt-4");
  });

  it("setModel(null) clears model", () => {
    useChat.getState().setModel("gpt-4");
    useChat.getState().setModel(null);
    expect(useChat.getState().model).toBeNull();
  });
});

describe("chat store — connection", () => {
  it("setConnected updates connected state", () => {
    useChat.getState().setConnected(true);
    expect(useChat.getState().connected).toBe(true);
    useChat.getState().setConnected(false);
    expect(useChat.getState().connected).toBe(false);
  });
});

describe("chat store — clearMessages", () => {
  it("resets messages and session state", () => {
    useChat.setState({
      messages: [
        { id: "1", role: "user", content: "hi", timestamp: Date.now() },
      ],
      activeChatId: "x",
      sessionId: "x",
    });
    useChat.getState().clearMessages();

    const s = useChat.getState();
    expect(s.messages).toHaveLength(0);
    expect(s.sessionId).toBeNull();
    expect(s.activeChatId).toBeNull();
    expect(s.contextTokens).toBe(0);
  });
});

describe("chat store — sendMessage", () => {
  it("calls streamManager.sendMessage", async () => {
    const { streamManager } = await import("@/services/ws-stream-manager");
    useChat.getState().sendMessage("hello");
    expect(streamManager.sendMessage).toHaveBeenCalledWith("hello");
  });

  it("does not send empty messages", async () => {
    const { streamManager } = await import("@/services/ws-stream-manager");
    (streamManager.sendMessage as any).mockClear();
    useChat.getState().sendMessage("   ");
    expect(streamManager.sendMessage).not.toHaveBeenCalled();
  });
});
