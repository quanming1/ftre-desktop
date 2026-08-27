/**
 * ChatInput 发送按钮回归测试
 *
 * 背景（bug）：Slate 以非受控方式挂载，打普通文本时 handleSlateChange 里唯一的
 * setState（setSkillSearch）拿到 null → React 跳过重渲染 → hasDraft 停留旧值，
 * 发送按钮保持 disabled。修复：onChange 中显式同步 hasText state。
 *
 * jsdom 无法驱动 Slate 的 beforeinput 编辑管线（无 getTargetRanges），
 * 故 mock slate-react 的渲染边界、保留真实 editor，用捕获的 onChange
 * 模拟"用户输入"——这正是回归所在的接线层。
 */
import { render, screen, act, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Descendant } from "slate";

// 捕获 Slate 挂载时的 editor 与 onChange，供测试驱动
let capturedOnChange: ((value: Descendant[]) => void) | null = null;

vi.mock("slate-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("slate-react")>();
  const { Editor } = await import("slate");
  return {
    ...actual,
    Slate: ({
      editor,
      initialValue,
      onChange,
      children,
    }: {
      editor: import("slate").BaseEditor
        & import("slate-react").ReactEditor
        & import("slate-history").HistoryEditor;
      initialValue: Descendant[];
      onChange: (value: Descendant[]) => void;
      children: React.ReactNode;
    }) => {
      // 复刻真实 Slate 挂载行为：写入 initialValue 并强制 normalize，
      // 否则后续 clear()/setContent() 在未规范化的空树上会抛错
      editor.children = initialValue;
      Editor.normalize(editor, { force: true });
      capturedOnChange = onChange;
      return <>{children}</>;
    },
    Editable: () => <div data-testid="slate-editable" />,
    ReactEditor: { ...actual.ReactEditor, focus: vi.fn() },
  };
});

// 重型子组件与本 bug 无关，mock 掉以隔离 store / API 副作用
vi.mock("./AgentBar", () => ({ AgentBar: () => <div data-testid="agent-bar" /> }));
vi.mock("./TokenRing", () => ({ TokenRing: () => <div data-testid="token-ring" /> }));
vi.mock("./WorkspaceBadge", () => ({ WorkspaceBadge: () => <div data-testid="workspace-badge" /> }));
vi.mock("@/services/api", () => ({
  fetchCommands: vi.fn().mockResolvedValue([]),
}));

import { ChatInput } from "./ChatInput";
import { useChat } from "@/stores/chat";
import { useInspector } from "@/stores/inspector";

const HELLO_DOC: Descendant[] = [
  { type: "paragraph", children: [{ text: "hello" }] } as Descendant,
];

describe("ChatInput 发送按钮", () => {
  beforeEach(() => {
    capturedOnChange = null;
    useChat.setState({
      sessionId: null,
      messages: [],
      pendingMessages: [],
      lastUserInputTs: null,
      sessionStatus: "idle",
      sessionActivity: "idle",
      clientCanSend: true,
      hasCoordinatorState: false,
      canCancel: false,
    });
  });

  it("输入框使用淡黑色边框并保留阴影", () => {
    render(<ChatInput />);

    const surface = screen.getByTestId("chat-input-surface");
    expect(surface).toHaveClass("bg-input");
    expect(surface).toHaveClass("border", "border-input-border");
    expect(surface).toHaveClass(
      "focus-within:shadow-[0_2px_12px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.6)]",
    );
    expect(surface).not.toHaveClass(
      "shadow-[0_2px_12px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.6)]",
    );
  });

  it("输入普通文本后发送按钮从禁用变为可点击", () => {
    render(<ChatInput />);

    // 初始无内容：禁用
    expect(screen.getByTitle("Send message")).toBeDisabled();

    // 模拟用户输入普通文本（非 "/" 指令——回归场景的关键：skillSearch 保持 null）
    expect(capturedOnChange).not.toBeNull();
    act(() => capturedOnChange!(HELLO_DOC));

    expect(screen.getByTitle("Send message")).not.toBeDisabled();
  });

  it("清空文本后发送按钮回到禁用", () => {
    render(<ChatInput />);

    act(() => capturedOnChange!(HELLO_DOC));
    expect(screen.getByTitle("Send message")).not.toBeDisabled();

    act(() => capturedOnChange!([{ type: "paragraph", children: [{ text: "" }] } as Descendant]));
    expect(screen.getByTitle("Send message")).toBeDisabled();
  });

  it("在输入框上方展示本轮文件变更摘要", () => {
    useChat.setState({
      messages: [
        { id: "u1", role: "user", content: "修改文件", timestamp: 1 },
        {
          id: "a1",
          role: "assistant",
          content: null,
          timestamp: 2,
          blocks: [
            { type: "toolCall", id: "edit-1", name: "edit", arguments: {} },
            { type: "toolCall", id: "edit-2", name: "edit", arguments: {} },
          ],
          toolResults: {
            "edit-1": {
              id: "edit-1",
              name: "edit",
              result: null,
              error: null,
              status: "completed",
              metadata: {
                file: "src/a.ts",
                before: "a",
                after: "b",
                additions: 4,
                deletions: 1,
              },
            },
            "edit-2": {
              id: "edit-2",
              name: "edit",
              result: null,
              error: null,
              status: "completed",
              metadata: {
                file: "src/a.ts",
                before: "b",
                after: "c",
                additions: 2,
                deletions: 3,
              },
            },
          },
        },
      ],
      sessionStatus: "running",
      sessionActivity: "executing",
      lastUserInputTs: 2,
    });

    render(<ChatInput />);

    expect(screen.getByTestId("turn-file-changes-summary")).toHaveTextContent("1 个文件已更改");
    expect(screen.getByTestId("turn-file-changes-summary")).toHaveTextContent("+6");
    expect(screen.getByTestId("turn-file-changes-summary")).toHaveTextContent("-4");
    expect(screen.getByTestId("turn-file-changes-summary")).toHaveClass("border", "border-white/60");
    expect(screen.getByTestId("turn-file-changes-summary")).toHaveClass("backdrop-blur-md");
    expect(screen.getByTestId("turn-file-changes-summary").parentElement).toHaveClass("justify-center");

    const openAuditTab = vi.spyOn(useInspector.getState(), "openAuditTab");
    fireEvent.click(screen.getByRole("button", { name: "审查本轮变更" }));
    expect(openAuditTab).toHaveBeenCalledWith("", expect.objectContaining({
      scope: "turn",
      turnId: "pending:u1",
    }));
    openAuditTab.mockRestore();
  });

  it("压缩期间隐藏上一轮文件变更摘要", () => {
    useChat.setState({
      messages: [
        { id: "u1", role: "user", content: "修改文件", timestamp: 1 },
        {
          id: "a1",
          role: "assistant",
          content: null,
          timestamp: 2,
          blocks: [{ type: "toolCall", id: "edit-1", name: "edit", arguments: {} }],
          toolResults: {
            "edit-1": {
              id: "edit-1",
              name: "edit",
              result: null,
              error: null,
              status: "completed",
              metadata: { file: "src/a.ts", before: "a", after: "b", additions: 1, deletions: 0 },
            },
          },
        },
      ],
      sessionStatus: "compacting",
      sessionActivity: "compacting",
      lastUserInputTs: 2,
    });

    render(<ChatInput />);

    expect(screen.queryByTestId("turn-file-changes-summary")).not.toBeInTheDocument();
  });

  it("新消息进入队列后立即隐藏上一轮摘要", () => {
    useChat.setState({
      messages: [
        { id: "u1", role: "user", content: "修改文件", timestamp: 1 },
        {
          id: "a1",
          role: "assistant",
          content: null,
          timestamp: 2,
          blocks: [{ type: "toolCall", id: "edit-1", name: "edit", arguments: {} }],
          toolResults: {
            "edit-1": {
              id: "edit-1",
              name: "edit",
              result: null,
              error: null,
              status: "completed",
              metadata: { file: "src/a.ts", before: "a", after: "b", additions: 1, deletions: 0 },
            },
          },
        },
      ],
      sessionStatus: "running",
      sessionActivity: "executing",
      pendingMessages: [{ request_id: "request-2", sequence: 1, content: "继续修改" }],
    });

    render(<ChatInput />);

    expect(screen.queryByTestId("turn-file-changes-summary")).not.toBeInTheDocument();
  });

  it("用户消息已回显时不受滞后队列快照影响", () => {
    useChat.setState({
      messages: [
        { id: "u1", role: "user", content: "修改文件", timestamp: 1 },
        {
          id: "a1",
          role: "assistant",
          content: null,
          timestamp: 2,
          blocks: [{ type: "toolCall", id: "edit-1", name: "edit", arguments: {} }],
          toolResults: {
            "edit-1": {
              id: "edit-1",
              name: "edit",
              result: null,
              error: null,
              status: "completed",
              metadata: { file: "src/a.ts", before: "a", after: "b", additions: 1, deletions: 0 },
            },
          },
        },
      ],
      sessionStatus: "running",
      sessionActivity: "executing",
      pendingMessages: [{ request_id: "stale-queue", sequence: 1, content: "已回显的消息" }],
      lastUserInputTs: 2,
    });

    render(<ChatInput />);

    expect(screen.getByTestId("turn-file-changes-summary")).toHaveTextContent("1 个文件已更改");
  });

  it("流式结束后关闭输入框上方摘要", () => {
    useChat.setState({
      messages: [
        { id: "u1", role: "user", content: "修改文件", timestamp: 1 },
        {
          id: "a1",
          role: "assistant",
          content: null,
          timestamp: 2,
          blocks: [{ type: "toolCall", id: "edit-1", name: "edit", arguments: {} }],
          toolResults: {
            "edit-1": {
              id: "edit-1",
              name: "edit",
              result: null,
              error: null,
              status: "completed",
              metadata: { file: "src/a.ts", before: "a", after: "b", additions: 1, deletions: 0 },
            },
          },
        },
      ],
      lastUserInputTs: 2,
    });

    render(<ChatInput />);

    expect(screen.queryByTestId("turn-file-changes-summary")).not.toBeInTheDocument();
  });

  it("消息队列横幅定位在输入框上方且无底部间距", () => {
    useChat.setState({
      pendingMessages: [{ request_id: "queued-1", sequence: 1, content: "下一条消息" }],
      sessionStatus: "running",
      sessionActivity: "dispatching",
    });

    render(<ChatInput />);

    const queue = screen.getByRole("region", { name: "消息队列" });
    const queueSurface = queue.parentElement;
    const inputSurface = screen.getByTestId("chat-input-surface");
    const composer = inputSurface.parentElement;
    const overlay = composer?.firstElementChild;
    expect(overlay).toHaveAttribute("data-chat-composer-stack", "");
    expect(overlay).toHaveClass("absolute", "bottom-full");
    expect(queueSurface?.parentElement).toBe(overlay);
    expect(queueSurface).toHaveClass("mx-4");
    expect(queueSurface).not.toHaveClass("mb-2");
    expect(queue).not.toHaveClass("mb-1");
  });

  it("文件摘要位于队列横幅上方，队列横幅直接贴住输入框", () => {
    useChat.setState({
      messages: [
        { id: "u1", role: "user", content: "修改文件", timestamp: 1 },
        {
          id: "a1",
          role: "assistant",
          content: null,
          timestamp: 2,
          blocks: [{ type: "toolCall", id: "edit-1", name: "edit", arguments: {} }],
          toolResults: {
            "edit-1": {
              id: "edit-1",
              name: "edit",
              result: null,
              error: null,
              status: "completed",
              metadata: { file: "src/a.ts", before: "a", after: "b", additions: 2, deletions: 1 },
            },
          },
        },
      ],
      pendingMessages: [{ request_id: "queued-2", sequence: 1, content: "下一条消息" }],
      lastUserInputTs: 2,
      sessionStatus: "running",
      sessionActivity: "executing",
    });

    render(<ChatInput />);

    const inputSurface = screen.getByTestId("chat-input-surface");
    const composer = inputSurface.parentElement;
    const overlay = composer?.firstElementChild;
    expect(overlay?.querySelector("[data-testid='turn-file-changes-summary']"))
      .toBe(screen.getByTestId("turn-file-changes-summary"));
    const queue = screen.getByRole("region", { name: "消息队列" });
    expect(queue.parentElement?.parentElement).toBe(overlay);
  });
});
