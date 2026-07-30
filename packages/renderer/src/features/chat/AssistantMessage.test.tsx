import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import type { ChatMessage, ContentBlock } from "@/stores/chat";
import { AssistantMessage } from "./AssistantMessage";
import { assistantMessagePropsEqual } from "./assistantMessageEquality";
import {
  collapsedAssistantBlocks,
  lastDisplayTextBlock,
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
  it("shows only the last text block while keeping the full process available", () => {
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

  it("collapses to no body when an interrupted reply has no text", () => {
    const blocks: ContentBlock[] = [{
      type: "toolCall",
      id: "read-1",
      name: "read",
      arguments: {},
    }];

    expect(collapsedAssistantBlocks(blocks)).toEqual([]);
  });

  it("expands a running turn by default and collapses it when completed", async () => {
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

    expect(screen.getByRole("button", { name: /处理中/ }))
      .toHaveAttribute("aria-expanded", "true");
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
});
