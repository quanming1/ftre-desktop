import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QueueItemView } from "@/services/websocket-client";
import { QueuedMessagesBanner } from "./QueuedMessagesBanner";

const { cancelQueuedMessage, promoteQueueItemToSteer, addNotification } = vi.hoisted(() => ({
  cancelQueuedMessage: vi.fn(),
  promoteQueueItemToSteer: vi.fn(),
  addNotification: vi.fn(),
}));

vi.mock("@/services/api", () => ({
  cancelQueuedMessage: (...args: unknown[]) => cancelQueuedMessage(...args),
}));
vi.mock("@/services/websocket-client", () => ({
  wsClient: { promoteQueueItemToSteer: (...args: unknown[]) => promoteQueueItemToSteer(...args) },
}));
vi.mock("@/stores/chat", () => ({
  useChat: (selector: (state: {
    sessionId: string;
  }) => unknown) => selector({
    sessionId: "ws_sess_queue",
  }),
}));
vi.mock("@/stores/notification", () => ({
  useNotification: (selector: (state: { addNotification: typeof addNotification }) => unknown) =>
    selector({ addNotification }),
}));

const item = (requestId: string, content: string): QueueItemView => ({
  request_id: requestId,
  sequence: 1,
  content,
});

describe("QueuedMessagesBanner", () => {
  it("directly renders pending items from the Inbox queue snapshot", () => {
    render(<QueuedMessagesBanner items={[item("one", "first"), item("two", "second")]} />);
    expect(screen.getByRole("region", { name: "消息队列" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("first")).toBeInTheDocument();
  });

  it("renders a queued Skill token as the shared Skill UI", () => {
    render(<QueuedMessagesBanner items={[item(
      "skill-item",
      "请使用 ![ftre:skill](ftre://v1/skill/review-code)",
    )]} />);
    expect(screen.getByRole("button", { name: "打开 Skill：Review Code" })).toBeInTheDocument();
  });

  it("cancels by pending request id and waits for the next snapshot to remove it", async () => {
    cancelQueuedMessage.mockResolvedValueOnce({ status: "cancelled" });
    render(<QueuedMessagesBanner items={[item("request-one", "remove me")]} />);
    fireEvent.click(screen.getByRole("button", { name: "从队列移除：remove me" }));
    await waitFor(() => {
      expect(cancelQueuedMessage).toHaveBeenCalledWith("ws_sess_queue", "request-one");
    });
    expect(addNotification).not.toHaveBeenCalled();
  });

  it("promotes a queued item to steer without removing it optimistically", async () => {
    promoteQueueItemToSteer.mockResolvedValueOnce({
      session_id: "ws_sess_queue",
      revision: 1,
      items: [],
    });
    render(<QueuedMessagesBanner items={[{
      ...item("request-steer", "插入下一轮"),
      placement: "queued",
    }]} />);
    fireEvent.click(screen.getByRole("button", { name: "插入当前运行：插入下一轮" }));
    await waitFor(() => {
      expect(promoteQueueItemToSteer).toHaveBeenCalledWith("ws_sess_queue", "request-steer");
    });
    expect(screen.getByText("插入下一轮")).toBeInTheDocument();
    expect(addNotification).not.toHaveBeenCalled();
  });

  it("keeps queued state and reports an upgrade failure", async () => {
    promoteQueueItemToSteer.mockRejectedValueOnce(new Error("网络断开"));
    render(<QueuedMessagesBanner items={[{
      ...item("request-failed", "稍后重试"),
      placement: "queued",
    }]} />);
    fireEvent.click(screen.getByRole("button", { name: "插入当前运行：稍后重试" }));
    await waitFor(() => {
      expect(addNotification).toHaveBeenCalledWith({ level: "error", message: "网络断开" });
    });
    expect(screen.getByText("稍后重试")).toBeInTheDocument();
  });
});
