import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatMessageList } from "./ChatMessageList";
import type { ChatMessage } from "@/stores/chat";

vi.mock("./UserMessage", () => ({
  UserMessage: ({ message }: { message: ChatMessage }) => (
    <div>{message.content}</div>
  ),
}));

vi.mock("./AssistantMessage", () => ({
  AssistantMessage: ({ message }: { message: ChatMessage }) => (
    <div>{message.content}</div>
  ),
}));

vi.mock("@/hooks/auto-scroll", () => ({
  useAutoScrollToBottom: () => ({
    ref: vi.fn(),
    scrollToBottom: vi.fn(),
    resetLock: vi.fn(),
  }),
}));

vi.mock("@/stores/chat", () => ({
  useChat: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      sessionId: null,
      retryState: null,
      hasMoreHistory: () => false,
    }),
}));

vi.mock("@/stores/session", () => ({
  useSession: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      loadEarlierMessages: vi.fn(),
    }),
}));

const message = (
  id: string,
  role: ChatMessage["role"],
  content: string,
): ChatMessage => ({
  id,
  role,
  content,
  timestamp: 1,
});

describe("ChatMessageList", () => {
  it("collapses older complete turns to their user head and final assistant tail", () => {
    const messages: ChatMessage[] = [
      message("u0", "user", "user zero"),
      message("a0a", "assistant", "assistant zero a"),
      message("a0b", "assistant", "assistant zero b"),
      message("a0c", "assistant", "assistant zero c"),
      message("u1", "user", "user one"),
      message("a1", "assistant", "assistant one"),
      message("u2", "user", "user two"),
      message("a2", "assistant", "assistant two"),
    ];

    render(<ChatMessageList messages={messages} />);

    expect(screen.getByText("user zero")).toBeInTheDocument();
    expect(screen.queryByText("assistant zero a")).not.toBeInTheDocument();
    expect(screen.queryByText("assistant zero b")).not.toBeInTheDocument();
    expect(screen.getByText("assistant zero c")).toBeInTheDocument();
    expect(screen.getByText("user one")).toBeInTheDocument();
    expect(screen.getByText("assistant one")).toBeInTheDocument();
    expect(screen.getByText("user two")).toBeInTheDocument();
    expect(screen.getByText("assistant two")).toBeInTheDocument();
  });

  it("shows a collapse control above all messages after expanding an older turn", () => {
    const messages: ChatMessage[] = [
      message("u0", "user", "user zero"),
      message("a0a", "assistant", "assistant zero a"),
      message("a0b", "assistant", "assistant zero b"),
      message("a0c", "assistant", "assistant zero c"),
      message("u1", "user", "user one"),
      message("a1", "assistant", "assistant one"),
      message("u2", "user", "user two"),
      message("a2", "assistant", "assistant two"),
    ];

    const { container } = render(<ChatMessageList messages={messages} />);

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("assistant zero a")).toBeInTheDocument();
    expect(screen.getByText("assistant zero b")).toBeInTheDocument();

    const firstTurn = container.querySelector("[class='space-y-12']");
    const firstTurnContent = firstTurn?.textContent ?? "";
    expect(firstTurnContent.indexOf("user zero")).toBeGreaterThan(-1);
    expect(firstTurnContent.indexOf("assistant zero a")).toBeGreaterThan(
      firstTurnContent.indexOf("user zero"),
    );
    expect(firstTurnContent.indexOf("assistant zero c")).toBeGreaterThan(
      firstTurnContent.indexOf("assistant zero b"),
    );
  });

  it("extends a local page cut back to the turn user before collapsing it", () => {
    const messages: ChatMessage[] = [
      message("u0", "user", "original user message"),
      message("a1", "assistant", "tail assistant one"),
      message("a2", "assistant", "tail assistant two"),
      message("a3", "assistant", "tail assistant three"),
      message("u4", "user", "second user message"),
      message("a5", "assistant", "second assistant"),
      message("u6", "user", "third user message"),
      message("a7", "assistant", "third assistant"),
      message("u8", "user", "fourth user message"),
      message("a9", "assistant", "fourth assistant"),
      message("u10", "user", "latest user message"),
    ];

    render(<ChatMessageList messages={messages} />);

    expect(screen.getByText("original user message")).toBeInTheDocument();
    expect(screen.queryByText("tail assistant one")).not.toBeInTheDocument();
    expect(screen.queryByText("tail assistant two")).not.toBeInTheDocument();
    expect(screen.getByText("tail assistant three")).toBeInTheDocument();
  });
});
