import type { Meta, StoryObj } from "@storybook/react";
import type { ToolCall } from "@/stores/chat";
import { ToolCallGroup } from "./ToolCallGroup";

const meta: Meta<typeof ToolCallGroup> = {
  title: "Chat/ToolCallGroup",
  component: ToolCallGroup,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[760px] p-4 bg-[#1a1a2e] text-white">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ToolCallGroup>;

function tc(id: string, name: string, status: ToolCall["status"], args: Record<string, unknown>, result?: string): ToolCall {
  return {
    id,
    name,
    status,
    arguments: JSON.stringify(args),
    result,
  };
}

export const CompletedCollapsed: Story = {
  args: {
    toolCalls: [
      tc("1", "read", "ok", { path: "src/chat.ts" }, "1| export const a = 1"),
      tc("2", "read", "ok", { path: "src/AssistantMessage.tsx" }, "1| import React"),
      tc("3", "bash", "ok", { command: "dir /b" }, "src\r\npackage.json"),
      tc("4", "bash", "ok", { command: "findstr /s /n tool_call *.tsx" }, "packages\\renderer\\src\\features\\chat\\AssistantMessage.tsx:154"),
      tc("5", "loadSkill", "ok", { skill: "frontend-design" }, "skill loaded"),
    ],
  },
};

export const CompletedCollapsedWithRunning: Story = {
  args: {
    toolCalls: [
      tc("1", "read", "ok", { path: "src/chat.ts" }, "1| export const a = 1"),
      tc("2", "read", "ok", { path: "src/AssistantMessage.tsx" }, "1| import React"),
      tc("3", "bash", "ok", { command: "dir /b" }, "src\r\npackage.json"),
      tc("4", "bash", "ok", { command: "findstr /s /n tool_call *.tsx" }, "packages\\renderer\\src\\features\\chat\\AssistantMessage.tsx:154"),
      tc("5", "read", "running", { path: "src/ToolCallGroup.tsx" }),
    ],
  },
};

export const SmallCompletedWithRunning: Story = {
  args: {
    toolCalls: [
      tc("1", "bash", "ok", { command: "dir /b" }, "src\r\npackage.json"),
      tc("2", "read", "ok", { path: "src/chat.ts" }, "1| export const a = 1"),
      tc("3", "read", "running", { path: "src/ToolCallGroup.tsx" }),
    ],
  },
};

export const OnlyRunning: Story = {
  args: {
    toolCalls: [
      tc("1", "read", "running", { path: "src/ToolCallGroup.tsx" }),
      tc("2", "bash", "running", { command: "dir /s /b packages\\renderer\\src\\features\\chat" }),
    ],
  },
};
