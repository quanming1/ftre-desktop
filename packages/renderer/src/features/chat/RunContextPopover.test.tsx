import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/stores/chat";
import { RunContextPopover, collectActiveTurnFileChanges, getRunLabel } from "./RunContextPopover";

const {
  chatState,
  openDiffPreview,
  togglePanelVisible,
  gitFiles,
  gitInfo,
  gitDiffFile,
  editorAddDiff,
} = vi.hoisted(() => ({
  chatState: {} as Record<string, unknown>,
  openDiffPreview: vi.fn(),
  togglePanelVisible: vi.fn(),
  gitFiles: [] as Array<Record<string, unknown>>,
  gitInfo: { branch: null, changedFiles: 0, isGitRepo: false },
  gitDiffFile: vi.fn(),
  editorAddDiff: vi.fn(),
}));

vi.mock("@/stores/chat", () => ({
  useChat: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));
vi.mock("@/stores/inspector", () => ({
  useInspector: {
    getState: () => ({ openDiffPreview }),
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
vi.mock("@/stores/editor", () => ({
  useEditor: {
    getState: () => ({ addDiff: editorAddDiff }),
  },
}));
vi.mock("@/services/visibility-manager", () => ({
  createManagedPoller: () => () => {},
}));
vi.mock("@/services/git-service", () => ({
  gitService: { diffFile: (...args: unknown[]) => gitDiffFile(...args) },
  useGitService: (selector: (service: { getFiles: () => typeof gitFiles; getInfo: () => typeof gitInfo }) => unknown) => selector({
    getFiles: () => gitFiles,
    getInfo: () => gitInfo,
  }),
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
  resetChatState();
  openDiffPreview.mockReset();
  togglePanelVisible.mockReset();
  gitDiffFile.mockReset();
  editorAddDiff.mockReset();
  gitFiles.splice(0);
  Object.assign(gitInfo, { branch: null, changedFiles: 0, isGitRepo: false });
});

describe("RunContextPopover", () => {
  it("没有运行上下文时不渲染 Header 按钮", () => {
    render(<RunContextPopover />);
    expect(screen.queryByLabelText(/打开运行详情/)).not.toBeInTheDocument();
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

    render(<RunContextPopover />);
    fireEvent.click(screen.getByRole("button", { name: /打开运行详情/ }));

    expect(screen.getByRole("region", { name: "运行详情" })).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("tencent/glm-5.3")).toBeInTheDocument();
    expect(screen.getByText("任务")).toBeInTheDocument();
    expect(screen.getByText("文件变更")).toBeInTheDocument();
    expect(screen.getByText("Git 分支")).toBeInTheDocument();
    expect(screen.getByText("develop")).toBeInTheDocument();
    expect(screen.getByText("Git 变更")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /任务/ }));
    expect(screen.getByText("更新界面")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /文件变更/ }));
    fireEvent.click(screen.getByRole("button", { name: /docs\/plan\.md/ }));
    expect(openDiffPreview).toHaveBeenCalledWith(
      "edit-1", "docs/plan.md", "before", "after", 4, 1,
    );
    expect(togglePanelVisible).toHaveBeenCalledWith("inspector");

    fireEvent.click(screen.getByRole("button", { name: /Git 变更/ }));
    fireEvent.click(screen.getByRole("button", { name: /src\/main\.ts/ }));
    await waitFor(() => expect(editorAddDiff).toHaveBeenCalledWith(expect.objectContaining({
      id: "git-change:E:/ftre/src/main.ts",
      toolName: "Git",
    })));

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
