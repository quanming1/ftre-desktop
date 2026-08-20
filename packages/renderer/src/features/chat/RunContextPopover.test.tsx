import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/stores/chat";
import { RunContextPopover, collectActiveTurnFileChanges, getRunLabel } from "./RunContextPopover";

const {
  chatState,
  sessionState,
  openDiffPreview,
  openFilePreview,
  togglePanelVisible,
  gitFiles,
  gitInfo,
  gitInfoRequest,
  gitPoll,
  gitDiffFile,
} = vi.hoisted(() => ({
  chatState: {} as Record<string, unknown>,
  sessionState: {
    sessions: [] as Array<{ session_id: string; workspace: string }>,
    allSessions: [] as Array<{ session_id: string; workspace: string }>,
  },
  openDiffPreview: vi.fn(),
  openFilePreview: vi.fn(),
  togglePanelVisible: vi.fn(),
  gitFiles: [] as Array<Record<string, unknown>>,
  gitInfo: { branch: null, changedFiles: 0, isGitRepo: false },
  gitInfoRequest: vi.fn(),
  gitPoll: vi.fn(),
  gitDiffFile: vi.fn(),
}));

vi.mock("@/stores/chat", () => ({
  useChat: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));
vi.mock("@/stores/session", () => ({
  useSession: (selector: (state: typeof sessionState) => unknown) => selector(sessionState),
}));
vi.mock("@/stores/inspector", () => ({
  useInspector: {
    getState: () => ({ openDiffPreview, openFilePreview }),
  },
}));
vi.mock("@/stores/layout", () => ({
  useLayout: {
    getState: () => ({
      panelVisible: { inspector: false },
      togglePanelVisible,
    }),
  },
}));
vi.mock("@/services/visibility-manager", () => ({
  createManagedPoller: () => () => {},
}));
vi.mock("@ftre/ui", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/FileIconView", () => ({
  FileIconView: ({ path }: { path: string }) => <span>{path}</span>,
}));

function resetChatState(overrides: Record<string, unknown> = {}) {
  Object.assign(chatState, {
    messages: [],
    isBusy: false,
    sessionStatus: "idle",
    sessionActivity: "idle",
    queueDepth: 0,
    blockedReason: null,
    turnStartTs: null,
    plan: null,
    model: "tencent/glm-5.3",
    retryState: null,
    commandName: null,
    ...overrides,
  });
}

beforeEach(() => {
  localStorage.removeItem("ftre:run-context-popover-open");
  resetChatState();
  sessionState.sessions.splice(0);
  sessionState.allSessions.splice(0);
  openDiffPreview.mockReset();
  openFilePreview.mockReset();
  togglePanelVisible.mockReset();
  gitInfoRequest.mockReset();
  gitPoll.mockReset();
  gitDiffFile.mockReset();
  gitFiles.splice(0);
  Object.assign(gitInfo, { branch: null, changedFiles: 0, isGitRepo: false });
  gitInfoRequest.mockImplementation(async () => gitInfo);
  gitPoll.mockImplementation(async () => ({ changed: true, etag: "test", files: gitFiles }));
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: {
      git: {
        info: (...args: unknown[]) => gitInfoRequest(...args),
        poll: (...args: unknown[]) => gitPoll(...args),
        diffFile: (...args: unknown[]) => gitDiffFile(...args),
      },
    },
  });
});

describe("RunContextPopover", () => {
  it("空闲时仍常驻 Header 按钮，并可打开详情", () => {
    render(<RunContextPopover />);
    fireEvent.click(screen.getByRole("button", { name: "空闲，打开运行详情" }));
    const popover = screen.getByRole("region", { name: "运行详情" });
    expect(popover).toBeInTheDocument();
    expect(popover).not.toHaveClass("fixed");
    expect(popover).not.toHaveClass("border");
    expect(popover.querySelector('[class*="border-t"]')).toBeNull();
    expect(screen.getByText("空闲")).toBeInTheDocument();
  });

  it("将弹窗开关作为全局偏好持久化，不随会话切换丢失", () => {
    const { unmount } = render(<RunContextPopover />);
    fireEvent.click(screen.getByRole("button", { name: "空闲，打开运行详情" }));
    expect(localStorage.getItem("ftre:run-context-popover-open")).toBe("true");

    unmount();
    render(<RunContextPopover />);
    expect(screen.getByRole("region", { name: "运行详情" })).toBeInTheDocument();
  });

  it("将运行状态、任务、文件变更和 Git 变更收进可展开的 Header 弹窗", async () => {
    const messages: ChatMessage[] = [
      { id: "user-1", role: "user", content: "更新计划", timestamp: 1 },
      {
        id: "assistant-1",
        role: "assistant",
        content: "已修改",
        timestamp: 2,
        model: "tencent/glm-5.3",
        blocks: [{ type: "toolCall", id: "edit-1", name: "edit", arguments: {} }],
        toolResults: {
          "edit-1": {
            id: "edit-1",
            name: "edit",
            result: null,
            error: null,
            status: "completed",
            metadata: {
              file: "docs/plan.md",
              before: "before",
              after: "after",
              additions: 4,
              deletions: 1,
            },
          },
        },
      },
    ];
    resetChatState({
      sessionId: "session-1",
      messages,
      isBusy: true,
      sessionStatus: "running",
      sessionActivity: "executing",
      turnStartTs: Date.now() - 8_000,
      plan: {
        goal: "更新计划",
        steps: [
          { id: "step-1", content: "检查状态", status: "completed" },
          { id: "step-2", content: "更新界面", status: "in_progress" },
        ],
      },
    });
    gitFiles.push({
      path: "src/main.ts",
      absolutePath: "E:/ftre/src/main.ts",
      status: "modified",
      staged: false,
      isDir: false,
    });
    Object.assign(gitInfo, { branch: "develop", changedFiles: 1, isGitRepo: true });
    gitDiffFile.mockResolvedValue({ original: "old", modified: "new" });
    sessionState.sessions.push({ session_id: "session-1", workspace: "E:/ftre" });

    render(<RunContextPopover />);
    fireEvent.click(screen.getByRole("button", { name: /打开运行详情/ }));

    expect(screen.getByRole("region", { name: "运行详情" })).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("tencent/glm-5.3")).toBeInTheDocument();
    expect(screen.getByText("任务")).toBeInTheDocument();
    expect(screen.getByText("本轮修改")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Git 分支")).toBeInTheDocument();
      expect(screen.getByText("develop")).toBeInTheDocument();
      expect(screen.getByText("Changes")).toBeInTheDocument();
      expect(gitInfoRequest).toHaveBeenCalledWith("E:/ftre");
      expect(gitPoll).toHaveBeenCalledWith("E:/ftre", "", true);
    });

    fireEvent.click(screen.getByRole("button", { name: /任务/ }));
    expect(screen.getByText("更新界面")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /本轮修改/ }));
    fireEvent.click(screen.getByRole("button", { name: /docs\/plan\.md/ }));
    expect(openDiffPreview).toHaveBeenCalledWith(
      "edit-1", "docs/plan.md", "before", "after", 4, 1,
    );
    expect(togglePanelVisible).toHaveBeenCalledWith("inspector");

    fireEvent.click(screen.getByRole("button", { name: /Changes/ }));
    fireEvent.click(screen.getByRole("button", { name: /src\/main\.ts/ }));
    await waitFor(() => expect(openDiffPreview).toHaveBeenLastCalledWith(
      "gitfile-E:/ftre/src/main.ts", "E:/ftre/src/main.ts", "old", "new", 0, 0, "main.ts",
    ));
    expect(gitDiffFile).toHaveBeenCalledWith("E:/ftre", "src/main.ts", "modified", false, undefined);

    fireEvent.mouseDown(document.body);
    expect(screen.getByRole("region", { name: "运行详情" })).toBeInTheDocument();

    expect(screen.getByRole("region", { name: "运行详情" })).toHaveClass("animate-in");
    fireEvent.click(screen.getByRole("button", { name: /关闭运行详情/ }));
    expect(screen.queryByRole("region", { name: "运行详情" })).not.toBeInTheDocument();
  });

  it("按当前轮次聚合文件变更，并保留最新内容", () => {
    const changes = collectActiveTurnFileChanges([
      { id: "old-user", role: "user", content: "旧轮", timestamp: 1 },
      { id: "current-user", role: "user", content: "当前轮", timestamp: 2 },
      {
        id: "assistant", role: "assistant", content: "", timestamp: 3,
        blocks: [
          { type: "toolCall", id: "edit-1", name: "edit", arguments: {} },
          { type: "toolCall", id: "edit-2", name: "edit", arguments: {} },
        ],
        toolResults: {
          "edit-1": { id: "edit-1", name: "edit", result: null, error: null, status: "completed", metadata: { file: "src/a.ts", before: "a", after: "b", additions: 1, deletions: 0 } },
          "edit-2": { id: "edit-2", name: "edit", result: null, error: null, status: "completed", metadata: { file: "src/a.ts", before: "b", after: "c", additions: 2, deletions: 1 } },
        },
      },
    ], true);
    expect(changes).toEqual([{
      toolCallId: "edit-1",
      filePath: "src/a.ts",
      operation: "edit",
      additions: 3,
      deletions: 1,
      before: "a",
      after: "c",
    }]);
    expect(getRunLabel({
      sessionStatus: "compacting", sessionActivity: "compacting", queueDepth: 0,
      blockedReason: null, retryState: null, commandName: null, turnStartTs: 1,
    })).toBe("Compacting context");
  });
});
