import { describe, it, expect, beforeEach, vi } from "vitest";
import { useChat } from "@/stores/chat";
import type { ChatMessage } from "@/stores/chat";

/**
 * Performance verification tests — programmatic simulation of manual perf scenarios.
 * Validates: Requirements 7.4
 *
 * Note: These tests validate the store's performance characteristics
 * after the ws-stream-manager merge into chat store.
 */

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

function makeMessage(
  id: string,
  role: "user" | "assistant" | "system",
  content: string,
): ChatMessage {
  return { id, role, content, timestamp: Date.now() };
}

beforeEach(() => {
  resetStore();
});

describe("performance — message list operations", () => {
  it("handles 100 messages efficiently", () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 100; i++) {
      messages.push(
        makeMessage(
          `msg-${i}`,
          i % 2 === 0 ? "user" : "assistant",
          `Message ${i}`,
        ),
      );
    }
    useChat.setState({ messages });
    expect(useChat.getState().messages).toHaveLength(100);
  });

  it("handles 1000 messages without significant overhead", () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 1000; i++) {
      messages.push(
        makeMessage(
          `msg-${i}`,
          i % 2 === 0 ? "user" : "assistant",
          `Message ${i}`,
        ),
      );
    }
    const start = performance.now();
    useChat.setState({ messages });
    const elapsed = performance.now() - start;
    expect(useChat.getState().messages).toHaveLength(1000);
    expect(elapsed).toBeLessThan(100); // Should complete in <100ms
  });

  it("streaming content updates are fast", () => {
    const messages: ChatMessage[] = [makeMessage("stream-1", "assistant", "")];
    messages[0].streaming = true;
    useChat.setState({ messages, isBusy: true });

    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      const msgs = [...useChat.getState().messages];
      msgs[0] = { ...msgs[0], content: msgs[0].content + "x".repeat(100) };
      useChat.setState({ messages: msgs });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(useChat.getState().messages[0].content.length).toBe(5000);
  });
});

describe("performance — mode switching", () => {
  it("mode switch is instant", () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      useChat.getState().setMode(i % 2 === 0 ? "chat" : "plan");
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
