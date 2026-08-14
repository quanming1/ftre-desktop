import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { ChatMessage, ContentBlock } from "@/stores/chat";
import { AssistantMessage } from "./AssistantMessage";
import { assistantMessagePropsEqual } from "./assistantMessageEquality";
import {
  collapsedAssistantBlocks,
  lastDisplayTextBlock,
  summarizeNonTextBlocks,
} from "./assistantMessageDisplay";

vi.mock("./InlineToolCallCard", () => ({
  InlineToolCallCard: () => null,
}));
vi.mock("./TurnFileChanges", () => ({
  TurnFileChanges: () => null,
}));
vi.mock("@/hooks/auto-scroll", () => ({
  useAutoScrollToBottom: () => ({
    ref: { current: null },
    scrollToBottom: vi.fn(),
    resetLock: vi.fn(),
  }),
}));

// mermaid 是动态 import，vitest 对动态 import 的 mock 同样生效
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mmd-svg"></svg>' }),
  },
}));

describe("AssistantMessage tool result rendering", () => {
  it("re-renders a running edit tool immediately when TOOL_RESULT_END completes it", () => {
    const blocks: ContentBlock[] = [{
      type: "toolCall",
      id: "edit-1",
      name: "edit",
      arguments: {
        file_path: "src/app.ts",
        old_string: "before",
        new_string: "after",
      },
    }];
    const running: ChatMessage = {
      id: "reply-1",
      role: "assistant",
      content: null,
      timestamp: 1,
      streaming: true,
      blocks,
      toolResults: {},
    };

    const completed: ChatMessage = {
      ...running,
      // TOOL_RESULT_END only changes toolResults. The blocks reference deliberately
      // stays identical to reproduce the memoization regression.
      toolResults: {
        "edit-1": {
          id: "edit-1",
          name: "edit",
          result: "updated",
          error: null,
          status: "completed",
          metadata: {
            file: "src/app.ts",
            before: "before",
            after: "after",
          },
        },
      },
    };

    expect(assistantMessagePropsEqual(
      { message: running },
      { message: completed },
    )).toBe(false);
  });

  it("re-renders when only the Assistant error state changes", () => {
    const normal: ChatMessage = {
      id: "reply-1",
      role: "assistant",
      content: "partial",
      timestamp: 1,
      streaming: false,
    };
    expect(assistantMessagePropsEqual(
      { message: normal, showActions: true },
      { message: { ...normal, isError: true }, showActions: true },
    )).toBe(false);
  });
});

describe("AssistantMessage collapsed display", () => {
  it("keeps the existing last-text collapse strategy", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "先检查代码", blockId: "text-1" },
      {
        type: "toolCall",
        id: "read-1",
        name: "read",
        arguments: { file_path: "src/app.ts" },
      },
      { type: "thinking", thinking: "分析结果", blockId: "thinking-1" },
      { type: "text", text: "最终回答", blockId: "text-2" },
    ];

    expect(collapsedAssistantBlocks(blocks)).toEqual([blocks[3]]);
    expect(lastDisplayTextBlock(blocks)?.text).toBe("最终回答");
    expect(blocks).toHaveLength(4);
  });

  it("skips an empty or dangling thinking marker at the tail", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "最后一段有效内容", blockId: "text-1" },
      { type: "text", text: "  ", blockId: "text-2" },
      { type: "text", text: "<thinking>", blockId: "text-3" },
    ];

    expect(lastDisplayTextBlock(blocks)?.blockId).toBe("text-1");
  });

  it("keeps data blocks visible instead of collapsing them into the process group", () => {
    const message: ChatMessage = {
      id: "reply-data",
      role: "assistant",
      content: null,
      timestamp: 1,
      streaming: true,
      blocks: [
        { type: "thinking", thinking: "分析中", blockId: "thinking-1" },
        { type: "data", data: "iVBORw0KGgo=", mediaType: "image/png", blockId: "data-1" },
        { type: "text", text: "最终回答", blockId: "text-1" },
      ],
      toolResults: {},
    };
    const { container } = render(<AssistantMessage message={message} />);

    // 只有 thinking 一个折叠组，图片直接可见（产物不属于"过程"）
    expect(screen.getAllByRole("button", { name: /进行了思考/ })).toHaveLength(1);
    expect(container.querySelector("img")).toBeInTheDocument();
  });

  it("keeps an asking tool call outside the process group until it is confirmed", () => {
    const message: ChatMessage = {
      id: "reply-asking",
      role: "assistant",
      content: null,
      timestamp: 1,
      streaming: true,
      blocks: [
        { type: "toolCall", id: "bash-1", name: "bash", arguments: {} },
        { type: "text", text: "最终回答", blockId: "text-1" },
      ],
      toolResults: {
        "bash-1": {
          id: "bash-1",
          name: "bash",
          result: null,
          error: null,
          status: "asking",
          confirm: { reason: "rule" },
        },
      },
    };
    const { rerender } = render(<AssistantMessage message={message} />);

    // asking：不折叠，无摘要按钮（确认按钮由卡片渲染）
    expect(screen.queryByRole("button", { name: /运行了命令/ })).not.toBeInTheDocument();

    // 用户确认后进入执行：进折叠组
    rerender(
      <AssistantMessage
        message={{
          ...message,
          toolResults: {
            "bash-1": {
              id: "bash-1",
              name: "bash",
              result: null,
              error: null,
              status: "running",
            },
          },
        }}
      />,
    );
    expect(screen.getByRole("button", { name: /运行了命令/ })).toBeInTheDocument();
  });

  it("skips empty thinking blocks so they never form an empty group", () => {
    const message: ChatMessage = {
      id: "reply-empty-thinking",
      role: "assistant",
      content: null,
      timestamp: 1,
      streaming: true,
      blocks: [
        { type: "thinking", thinking: "  ", blockId: "thinking-1" },
        { type: "text", text: "最终回答", blockId: "text-1" },
      ],
      toolResults: {},
    };
    render(<AssistantMessage message={message} />);

    expect(screen.queryByRole("button", { name: /进行了思考/ })).not.toBeInTheDocument();
    expect(screen.getByText("最终回答")).toBeInTheDocument();
  });

  it("collapses to no body when an interrupted reply has no text", () => {
    const blocks: ContentBlock[] = [{
      type: "toolCall",
      id: "read-1",
      name: "read",
      arguments: {},
    }];

    expect(collapsedAssistantBlocks(blocks)).toEqual([]);
  });

  it("summarizes the actions inside a non-text process group", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", thinking: "分析修改方案", blockId: "thinking-1" },
      { type: "toolCall", id: "edit-1", name: "edit", arguments: {} },
      { type: "toolCall", id: "bash-1", name: "bash", arguments: {} },
    ];

    expect(summarizeNonTextBlocks(blocks)).toBe("进行了思考、编辑了文件并运行了命令");
    expect(summarizeNonTextBlocks(blocks.slice(0, 2))).toBe("进行了思考并编辑了文件");
    // 单工具
    expect(summarizeNonTextBlocks(blocks.slice(1, 2))).toBe("编辑了文件");
    // 重复动作去重
    expect(summarizeNonTextBlocks([
      { type: "thinking", thinking: "第一段", blockId: "thinking-1" },
      { type: "thinking", thinking: "第二段", blockId: "thinking-2" },
      { type: "toolCall", id: "edit-1", name: "edit", arguments: {} },
      { type: "toolCall", id: "edit-2", name: "edit", arguments: {} },
    ])).toBe("进行了思考并编辑了文件");
    // 空 thinking 不产生动作
    expect(summarizeNonTextBlocks([
      { type: "thinking", thinking: "  ", blockId: "thinking-1" },
      { type: "toolCall", id: "bash-1", name: "bash", arguments: {} },
    ])).toBe("运行了命令");
    // plan / MCP 命名空间
    expect(summarizeNonTextBlocks([
      { type: "toolCall", id: "plan-1", name: "plan", arguments: {} },
    ])).toBe("制定了计划");
    expect(summarizeNonTextBlocks([
      { type: "toolCall", id: "pw-1", name: "mcp__playwright__browser_click", arguments: {} },
    ])).toBe("操作了浏览器");
    expect(summarizeNonTextBlocks([
      { type: "toolCall", id: "fg-1", name: "mcp__figma__get_file", arguments: {} },
    ])).toBe("操作了设计稿");
  });

  it("keeps the outer collapse and adds an inner non-text collapse", async () => {
    const running: ChatMessage = {
      id: "reply-running",
      role: "assistant",
      content: "最终回答",
      timestamp: 1,
      streaming: true,
      blocks: [
        { type: "thinking", thinking: "正在分析详细过程", blockId: "thinking-1" },
        { type: "text", text: "最终回答", blockId: "text-1" },
      ],
      toolResults: {},
    };
    const { rerender } = render(<AssistantMessage message={running} />);

    const processButtons = screen.getAllByRole("button", { name: /处理中/ });
    expect(processButtons).toHaveLength(1);
    const outerProcessButton = processButtons[0];
    expect(outerProcessButton).toHaveAttribute("aria-expanded", "true");
    // 内层按钮直接显示摘要，"处理中"状态由外层表达
    const innerProcessButton = screen.getByRole("button", { name: /进行了思考/ });
    expect(innerProcessButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(innerProcessButton);
    expect(innerProcessButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText("正在分析详细过程").length).toBeGreaterThan(0);

    rerender(
      <AssistantMessage
        message={{ ...running, streaming: false }}
        turnDurationSec={63}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /已处理 1分3秒/ }))
        .toHaveAttribute("aria-expanded", "false");
    });
    expect(screen.queryAllByText("正在分析详细过程")).toHaveLength(0);
    expect(screen.getByText("最终回答")).toBeInTheDocument();
  });

  it("keeps text and separate non-text process groups in their original order", () => {
    const message: ChatMessage = {
      id: "reply-ordered",
      role: "assistant",
      content: "最终回答",
      timestamp: 1,
      streaming: true,
      blocks: [
        { type: "text", text: "前置说明", blockId: "text-1" },
        { type: "thinking", thinking: "第一段思考", blockId: "thinking-1" },
        { type: "text", text: "中间说明", blockId: "text-2" },
        { type: "thinking", thinking: "第二段思考", blockId: "thinking-2" },
        { type: "text", text: "最终回答", blockId: "text-3" },
      ],
      toolResults: {},
    };

    const { container } = render(<AssistantMessage message={message} />);

    // 外层"处理中"1 个 + 两个 thinking 组各一个摘要按钮
    expect(screen.getByRole("button", { name: /处理中/ }))
      .toHaveAttribute("aria-expanded", "true");
    const innerButtons = screen.getAllByRole("button", { name: /进行了思考/ });
    expect(innerButtons).toHaveLength(2);
    innerButtons.forEach((button) => {
      expect(button).toHaveAttribute("aria-expanded", "false");
    });

    const bodyText = container.querySelector('[data-assistant-message="true"]')?.textContent ?? "";
    expect(bodyText).toContain("前置说明");
    expect(bodyText).toContain("中间说明");
    expect(bodyText).toContain("最终回答");
    expect(bodyText.indexOf("前置说明")).toBeLessThan(bodyText.indexOf("中间说明"));
    expect(bodyText.indexOf("中间说明")).toBeLessThan(bodyText.indexOf("最终回答"));
  });

  it("breathes the last process group's summary regardless of tool state until text follows", () => {
    const message: ChatMessage = {
      id: "reply-breath",
      role: "assistant",
      content: null,
      timestamp: 1,
      streaming: true,
      blocks: [{ type: "toolCall", id: "bash-1", name: "bash", arguments: {} }],
      toolResults: {
        "bash-1": { id: "bash-1", name: "bash", result: "ok", error: null, status: "completed" },
      },
    };
    const { rerender } = render(<AssistantMessage message={message} />);

    // 最后一个分组：即使工具已完成也呼吸
    const groupButton = screen.getByRole("button", { name: /运行了命令/ });
    expect(groupButton.querySelector("span")).toHaveClass("animate-process-breath");

    // 组后出现 text block（开始生成文本）：停止呼吸
    rerender(
      <AssistantMessage
        message={{
          ...message,
          blocks: [
            { type: "toolCall", id: "bash-1", name: "bash", arguments: {} },
            { type: "text", text: "最终回答", blockId: "text-1" },
          ],
        }}
      />,
    );
    expect(groupButton.querySelector("span")).not.toHaveClass("animate-process-breath");
  });

  it("breathes only the last process group", () => {
    const message: ChatMessage = {
      id: "reply-two-groups",
      role: "assistant",
      content: null,
      timestamp: 1,
      streaming: true,
      blocks: [
        { type: "thinking", thinking: "第一段思考", blockId: "thinking-1" },
        { type: "text", text: "中间说明", blockId: "text-1" },
        { type: "toolCall", id: "bash-1", name: "bash", arguments: {} },
      ],
      toolResults: {
        "bash-1": { id: "bash-1", name: "bash", result: null, error: null, status: "running" },
      },
    };
    const { rerender } = render(<AssistantMessage message={message} />);

    // 前面的组（组后有 text）不呼吸，最后一组呼吸
    const thinkingButton = screen.getByRole("button", { name: /进行了思考/ });
    const bashButton = screen.getByRole("button", { name: /运行了命令/ });
    expect(thinkingButton.querySelector("span")).not.toHaveClass("animate-process-breath");
    expect(bashButton.querySelector("span")).toHaveClass("animate-process-breath");

    // 新组接在最后一组后：组内合并（bash+edit），仍是最后一组，持续呼吸
    rerender(
      <AssistantMessage
        message={{
          ...message,
          blocks: [
            { type: "thinking", thinking: "第一段思考", blockId: "thinking-1" },
            { type: "text", text: "中间说明", blockId: "text-1" },
            { type: "toolCall", id: "bash-1", name: "bash", arguments: {} },
            { type: "toolCall", id: "edit-1", name: "edit", arguments: {} },
          ],
        }}
      />,
    );
    expect(thinkingButton.querySelector("span")).not.toHaveClass("animate-process-breath");
    expect(bashButton.querySelector("span")).toHaveClass("animate-process-breath");
  });
});

describe("AssistantMessage mermaid 渲染与源码/渲染切换", () => {
  const mermaidMessage: ChatMessage = {
    id: "reply-mermaid",
    role: "assistant",
    content: "流程如下：\n\n```mermaid\ngraph TD\nA-->B\n```",
    timestamp: 1,
    streaming: false,
  };

  it("含 mermaid 的消息渲染图表，并可切源码/渲染", async () => {
    render(<AssistantMessage message={mermaidMessage} />);

    // 切换按钮可见（含 mermaid 且流式结束）
    expect(screen.getByTitle("查看源码")).toBeInTheDocument();
    // 渲染视图：mermaid 渲染为 SVG
    await waitFor(() => expect(screen.getByTestId("mmd-svg")).toBeInTheDocument());

    // 切到源码：显示原始 markdown（含 mermaid 围栏），SVG 消失
    fireEvent.click(screen.getByTitle("查看源码"));
    expect(screen.getByText(/graph TD/)).toBeInTheDocument();
    expect(screen.queryByTestId("mmd-svg")).not.toBeInTheDocument();

    // 切回渲染：图表重新出现
    fireEvent.click(screen.getByTitle("预览渲染结果"));
    await waitFor(() => expect(screen.getByTestId("mmd-svg")).toBeInTheDocument());
  });

  it("流式中不显示切换按钮", () => {
    render(
      <AssistantMessage
        message={{ ...mermaidMessage, streaming: true }}
      />,
    );
    expect(screen.queryByTitle("查看源码")).not.toBeInTheDocument();
  });

  it("不含 mermaid 的消息不显示切换按钮", () => {
    render(
      <AssistantMessage
        message={{ id: "reply-plain", role: "assistant", content: "普通回答", timestamp: 1, streaming: false }}
      />,
    );
    expect(screen.queryByTitle("查看源码")).not.toBeInTheDocument();
    expect(screen.queryByTitle("预览渲染结果")).not.toBeInTheDocument();
  });

  it("mermaid 图表可放大全屏展示（Modal）", async () => {
    render(<AssistantMessage message={mermaidMessage} />);
    await waitFor(() => expect(screen.getByTestId("mmd-svg")).toBeInTheDocument());

    // 点击放大按钮 → 全屏 Modal 打开
    fireEvent.click(screen.getByTitle("放大"));
    expect(screen.getByText("Mermaid 图表")).toBeInTheDocument();

    // 关闭 Modal 后标题消失（framer-motion exit 动画需等待）
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByText("Mermaid 图表")).not.toBeInTheDocument());
  });
});
