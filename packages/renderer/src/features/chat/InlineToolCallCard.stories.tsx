/**
 * Story: InlineToolCallCard
 *
 * 验证工具卡片在不同生命周期阶段的渲染：
 * - pending: 等待参数
 * - running: 执行中（参数已知）
 * - ok: 执行成功
 * - error: 执行失败
 *
 * 使用方法：粘贴后端真实的 tool_call / tool_result JSON 到 controls 面板验证渲染。
 */
import type { Meta, StoryObj } from "@storybook/react";
import { InlineToolCallCard } from "./InlineToolCallCard";
import type { ToolCall } from "@/services/ws-stream-manager";

const meta: Meta<typeof InlineToolCallCard> = {
  title: "Chat/InlineToolCallCard",
  component: InlineToolCallCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[600px] p-4 bg-[#1a1a2e] text-white">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof InlineToolCallCard>;

// ─── 生命周期各阶段 ─────────────────────────────────────────────────

export const Pending: Story = {
  args: {
    toolCall: {
      id: "functions.exec:0",
      name: "exec",
      arguments: "",
      status: "pending",
    },
  },
};

export const Running: Story = {
  args: {
    toolCall: {
      id: "functions.write_file:0",
      name: "write_file",
      arguments: JSON.stringify({ path: "C:\\Users\\Desktop\\tetris.html", content: "<!DOCTYPE html>..." }),
      status: "running",
    },
  },
};

export const Success: Story = {
  args: {
    toolCall: {
      id: "functions.exec:0",
      name: "exec",
      arguments: JSON.stringify({ command: "python --version" }),
      status: "ok",
      result: "Python 3.11.8\n\nExit code: 0",
    },
  },
};

export const Error: Story = {
  args: {
    toolCall: {
      id: "functions.read_file:0",
      name: "read_file",
      arguments: JSON.stringify({ path: "/not/exist.py" }),
      status: "error",
      result: "FileNotFoundError: [Errno 2] No such file or directory: '/not/exist.py'",
    },
  },
};

export const LongResult: Story = {
  args: {
    toolCall: {
      id: "functions.read_file:0",
      name: "read_file",
      arguments: JSON.stringify({ path: "src/main.py", limit: 50 }),
      status: "ok",
      result: Array.from({ length: 50 }, (_, i) => `${i + 1}| import something_${i}`).join("\n"),
    },
  },
};

// ─── 真实后端数据验证 ───────────────────────────────────────────────

export const FromBackendJSON: Story = {
  args: {
    toolCall: {
      id: "functions.greet:0",
      name: "greet",
      arguments: JSON.stringify({ name: "蒋全明" }),
      status: "ok",
      result: "Hello from plugin!, 蒋全明!",
    },
  },
};

export const ParallelTools: Story = {
  render: () => {
    const tools: ToolCall[] = [
      {
        id: "functions.cron:0",
        name: "cron",
        arguments: JSON.stringify({ action: "list" }),
        status: "ok",
        result: "Scheduled jobs:\n- dream (id: dream, every 2h)",
      },
      {
        id: "functions.glob:1",
        name: "glob",
        arguments: JSON.stringify({ pattern: "src/**/*.py" }),
        status: "ok",
        result: "src/ftre/__main__.py\nsrc/ftre/__init__.py\nsrc/ftre/ftre.py",
      },
      {
        id: "functions.grep:2",
        name: "grep",
        arguments: JSON.stringify({ pattern: "def greet", path: "src" }),
        status: "error",
        result: "No matches found for pattern 'def greet' in src",
      },
    ];
    return (
      <div className="space-y-2">
        {tools.map((tc) => (
          <InlineToolCallCard key={tc.id} toolCall={tc} />
        ))}
      </div>
    );
  },
};
