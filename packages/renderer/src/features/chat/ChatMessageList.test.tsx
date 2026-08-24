import { render, screen } from "@testing-library/react";
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
  it("renders all messages from earlier complete turns", () => {
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
    expect(screen.getByText("assistant zero a")).toBeInTheDocument();
    expect(screen.getByText("assistant zero b")).toBeInTheDocument();
    expect(screen.getByText("assistant zero c")).toBeInTheDocument();
    expect(screen.getByText("user one")).toBeInTheDocument();
    expect(screen.getByText("assistant one")).toBeInTheDocument();
    expect(screen.getByText("user two")).toBeInTheDocument();
    expect(screen.getByText("assistant two")).toBeInTheDocument();
  });

  it("keeps earlier messages visible while the latest turn is rendered", () => {
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

    const { container } = render(<ChatMessageList messages={messages} isBusy />);

    expect(screen.getByText("user zero")).toBeInTheDocument();
    expect(screen.getByText("assistant zero a")).toBeInTheDocument();
    expect(screen.getByText("assistant zero b")).toBeInTheDocument();

    const content = container.textContent ?? "";
    expect(content.indexOf("user zero")).toBeGreaterThan(-1);
    expect(content.indexOf("assistant zero a")).toBeGreaterThan(
      content.indexOf("user zero"),
    );
    expect(content.indexOf("assistant zero c")).toBeGreaterThan(
      content.indexOf("assistant zero b"),
    );
  });

  it("renders every message in a locally paged history", () => {
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
    expect(screen.getByText("tail assistant one")).toBeInTheDocument();
    expect(screen.getByText("tail assistant two")).toBeInTheDocument();
    expect(screen.getByText("tail assistant three")).toBeInTheDocument();
  });

  it("shows a thinking placeholder while the latest user message has no assistant reply", () => {
    render(
      <ChatMessageList
        messages={[message("u1", "user", "请修改文件")]}
        isBusy
      />,
    );

    const placeholder = screen.getByTestId("thinking-placeholder");
    expect(placeholder).toHaveTextContent("处理中");
    expect(placeholder.querySelector("span")).toHaveClass("animate-process-breath", "text-[14px]");
  });

  it("hides the thinking placeholder after the assistant message starts", () => {
    render(
      <ChatMessageList
        messages={[
          message("u1", "user", "请修改文件"),
          {
            ...message("a1", "assistant", "正在处理"),
            streaming: true,
            blocks: [{ type: "thinking", thinking: "正在处理", blockId: "thinking-1" }],
          },
        ]}
        isBusy
      />,
    );

    expect(screen.queryByTestId("thinking-placeholder")).not.toBeInTheDocument();
  });
});
