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
import { render, screen, act } from "@testing-library/react";
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

const HELLO_DOC: Descendant[] = [
  { type: "paragraph", children: [{ text: "hello" }] } as Descendant,
];

describe("ChatInput 发送按钮", () => {
  beforeEach(() => {
    capturedOnChange = null;
    useChat.setState({
      sessionId: null,
      isBusy: false,
      sessionStatus: "idle",
      clientCanSend: true,
      hasCoordinatorState: false,
      canCancel: false,
    });
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
});
