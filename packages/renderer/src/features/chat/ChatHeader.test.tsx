import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ChatHeader } from "./ChatHeader";

const { chatState, sessionState } = vi.hoisted(() => ({
  chatState: { sessionId: "session-1" },
  sessionState: {
    sessions: [{ session_id: "session-1", title: "当前会话", channel: "ws" }],
    allSessions: [{ session_id: "session-1", title: "当前会话", channel: "ws" }],
    loadAllSessions: vi.fn(),
    deleteSession: vi.fn(),
    switchSession: vi.fn(),
  },
}));

vi.mock("@/stores/chat", () => ({
  useChat: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));
vi.mock("@/stores/session", () => ({
  useSession: (selector: (state: typeof sessionState) => unknown) => selector(sessionState),
}));
vi.mock("@/stores/notification", () => ({
  useNotification: { getState: () => ({ addNotification: vi.fn() }) },
}));
vi.mock("@/services/api", () => ({ updateSession: vi.fn() }));
vi.mock("@ftre/ui", () => ({
  ContextMenu: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./RunContextPopover", () => ({
  RunContextButton: () => <button type="button" aria-label="运行详情" />,
}));
vi.mock("@/components/InspectorVisibilityButton", () => ({
  InspectorVisibilityButton: () => <button type="button" aria-label="显示侧面板" />,
}));

beforeEach(() => {
  sessionState.loadAllSessions.mockReset();
  sessionState.deleteSession.mockReset();
  sessionState.switchSession.mockReset();
});

describe("ChatHeader", () => {
  it("将更多操作放在会话标题右侧，而不是右侧操作区", () => {
    render(<ChatHeader runContextOpen={false} onToggleRunContext={vi.fn()} />);

    const title = screen.getByRole("button", { name: "切换会话：当前会话" });
    const more = screen.getByRole("button", { name: "更多操作" });
    const headerTitleGroup = title.parentElement?.parentElement;

    expect(headerTitleGroup).toContainElement(more);
    expect(headerTitleGroup).not.toContainElement(screen.getByRole("button", { name: "运行详情" }));
    expect(more).toHaveClass("text-t-muted", "top-px");
  });
});
