import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserMessage } from "./UserMessage";

describe("UserMessage", () => {
  it("在用户气泡下方展示发送时间和复制按钮", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <UserMessage
        message={{
          id: "user-footer",
          role: "user",
          content: "你好",
          timestamp: Date.now(),
        }}
      />,
    );

    expect(screen.getByTestId("user-message-bubble")).toHaveClass("bg-user-message");
    expect(screen.getByTestId("user-message-bubble")).not.toHaveClass("border-input-border");
    const time = screen.getByTitle(/^发送时间：/);
    expect(time).toHaveTextContent("刚刚");
    expect(time).not.toHaveClass("font-mono");
    const copyButton = screen.getByRole("button", { name: "复制消息" });
    expect(time.parentElement).toContainElement(copyButton);

    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("你好"));
  });
});
