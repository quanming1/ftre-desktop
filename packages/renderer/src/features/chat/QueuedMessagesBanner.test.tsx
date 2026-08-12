import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MailboxItemPayload } from "@/services/websocket-client";
import { QueuedMessagesBanner } from "./QueuedMessagesBanner";

const { cancelQueuedMessage, addNotification } = vi.hoisted(() => ({
  cancelQueuedMessage: vi.fn(),
  addNotification: vi.fn(),
}));

vi.mock("@/services/api", () => ({
  cancelQueuedMessage: (...args: unknown[]) => cancelQueuedMessage(...args),
}));
vi.mock("@/stores/chat", () => ({
  useChat: (selector: (state: { sessionId: string }) => unknown) =>
    selector({ sessionId: "ws_sess_queue" }),
}));
vi.mock("@/stores/notification", () => ({
  useNotification: (selector: (state: { addNotification: typeof addNotification }) => unknown) =>
    selector({ addNotification }),
}));

const item = (requestId: string, content: string): MailboxItemPayload => ({
  request_id: requestId,
  sequence: 1,
  content,
});

describe("QueuedMessagesBanner", () => {
  it("directly renders pending items from the mailbox snapshot", () => {
    render(<QueuedMessagesBanner items={[item("one", "first"), item("two", "second")]} />);
    expect(screen.getByRole("region", { name: "消息队列" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /消息队列/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("first")).toBeInTheDocument();
  });

  it("cancels by pending request id and waits for the next snapshot to remove it", async () => {
    cancelQueuedMessage.mockResolvedValueOnce({ status: "cancelled" });
    render(<QueuedMessagesBanner items={[item("request-one", "remove me")]} />);
    fireEvent.click(screen.getByRole("button", { name: /消息队列/ }));
    fireEvent.click(screen.getByRole("button", { name: "从队列移除：remove me" }));
    await waitFor(() => {
      expect(cancelQueuedMessage).toHaveBeenCalledWith("ws_sess_queue", "request-one");
    });
    expect(addNotification).not.toHaveBeenCalled();
  });
});
