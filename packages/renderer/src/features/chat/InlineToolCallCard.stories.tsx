/**
 * Story: InlineToolCallCard �?All Tools x All States
 *
 * Renders every known tool in every lifecycle state:
 * - pending: tool announced, waiting for arguments
 * - running: arguments received, executing
 * - ok: execution succeeded
 * - error: execution failed
 *
 * Use this to verify and customize rendering for each tool type.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { InlineToolCallCard } from "./InlineToolCallCard";
import type { ToolCall } from "@/stores/chat";

const meta: Meta<typeof InlineToolCallCard> = {
  title: "Chat/InlineToolCallCard",
  component: InlineToolCallCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[700px] p-4 bg-[#1a1a2e] text-white">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof InlineToolCallCard>;

// ─── Tool Definitions (realistic arguments + results) ───────────────

interface ToolFixture {
  name: string;
  args: Record<string, unknown>;
  result: string;
  error: string;
}

const TOOLS: ToolFixture[] = [
  {
    name: "exec",
    args: { command: "python --version" },
    result: "Python 3.11.8\r\n\n\nExit code: 0",
    error: "Command timed out after 60s",
  },
  {
    name: "read_file",
    args: { path: "src/ftre/agent/loop.py", limit: 30 },
    result: '1| """Agent loop �?main message processing."""\n2| \n3| from __future__ import annotations\n4| \n5| import asyncio\n...\n30| from ftre.message import Message',
    error: "FileNotFoundError: [Errno 2] No such file or directory: 'not_exist.py'",
  },
  {
    name: "write_file",
    args: { path: "C:\\Users\\Desktop\\tetris.html", content: "<!DOCTYPE html>\\n<html>..." },
    result: "Successfully wrote 3928 characters to C:\\Users\\Desktop\\tetris.html",
    error: "PermissionError: [Errno 13] Permission denied: 'C:\\Windows\\system32\\test.txt'",
  },
  {
    name: "edit_file",
    args: { path: "src/main.py", old_string: "print('hello')", new_string: "print('world')" },
    result: "Replaced 1 occurrence in src/main.py",
    error: "old_string not found in file",
  },
  {
    name: "glob",
    args: { pattern: "src/**/*.py", path: "E:/binn/ai-base" },
    result: "src/ftre/__main__.py\nsrc/ftre/__init__.py\nsrc/ftre/ftre.py\nsrc/ftre/agent/loop.py\nsrc/ftre/agent/runner.py",
    error: "Invalid glob pattern: [unclosed",
  },
  {
    name: "grep",
    args: { pattern: "def greet", path: "src", output_mode: "content" },
    result: "src/plugins/example.py:15: def greet(name: str) -> str:\nsrc/plugins/example.py:16:     return f'Hello, {name}!'",
    error: "No matches found for pattern 'def greet' in src",
  },
  {
    name: "web_search",
    args: { query: "2026 AI news", count: 3 },
    result: "Results for: 2026 AI news\n\n1. OpenAI announces GPT-5\n   https://openai.com/blog/gpt5\n2. Google DeepMind breakthrough\n   https://deepmind.google/research",
    error: "Search service unavailable (rate limited)",
  },
  {
    name: "web_fetch",
    args: { url: "https://example.com/api/data", method: "GET" },
    result: '{"status": "ok", "data": [1, 2, 3]}',
    error: "ConnectionError: Failed to establish connection to https://example.com",
  },
  {
    name: "list_dir",
    args: { path: "E:/binn/ai-base", max_entries: 10 },
    result: "src/\ndocs/\ntests/\nREADME.md\npackage.json\npyproject.toml\n.gitignore\nSOUL.md\nUSER.md\nTOOLS.md",
    error: "NotADirectoryError: [Errno 20] Not a directory: '/path/to/file.txt'",
  },
  {
    name: "my",
    args: { action: "check" },
    result: "max_iterations: 200\nmodel: 'mlamp/kimi-k2.6'\nworkspace: E:/binn/ai-base\nprovider_retry_mode: 'standard'",
    error: "Unknown action: 'invalid_action'",
  },
  {
    name: "greet",
    args: { name: "World" },
    result: "Hello from plugin!, World!",
    error: "Plugin not loaded: greet",
  },
  {
    name: "cron",
    args: { action: "list" },
    result: "Scheduled jobs:\n- dream (id: dream, every 2h)\n  Next run: 2026-05-14T08:56:17Z",
    error: "Cron service not running",
  },
];

const STATUSES: Array<{ status: ToolCall["status"]; label: string }> = [
  { status: "pending", label: "Pending" },
  { status: "running", label: "Running" },
  { status: "ok", label: "Success" },
  { status: "error", label: "Error" },
];

// ─── All Tools x All States (matrix view) ───────────────────────────

export const AllToolsAllStates: Story = {
  render: () => (
    <div className="space-y-6">
      {TOOLS.map((tool) => (
        <div key={tool.name} className="space-y-2">
          <h3 className="text-sm font-mono text-neon border-b border-white/10 pb-1">
            {tool.name}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {STATUSES.map(({ status, label }) => {
              const tc: ToolCall = {
                id: `${tool.name}:0`,
                name: tool.name,
                arguments: status === "pending" ? "" : JSON.stringify(tool.args),
                status,
                result: status === "ok" ? tool.result : status === "error" ? tool.error : undefined,
              };
              return (
                <div key={status}>
                  <div className="text-[10px] text-t-ghost mb-0.5">{label}</div>
                  <InlineToolCallCard toolCall={tc} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  ),
};

// ─── Individual tool stories for focused testing ────────────────────

export const Exec_Pending: Story = { args: { toolCall: { id: "exec:0", name: "exec", arguments: "", status: "pending" } } };
export const Exec_Running: Story = { args: { toolCall: { id: "exec:0", name: "exec", arguments: JSON.stringify({ command: "python -c 'import time; time.sleep(10)'" }), status: "running" } } };
export const Exec_Success: Story = { args: { toolCall: { id: "exec:0", name: "exec", arguments: JSON.stringify({ command: "python --version" }), status: "ok", result: "Python 3.11.8\n\nExit code: 0" } } };
export const Exec_Error: Story = { args: { toolCall: { id: "exec:0", name: "exec", arguments: JSON.stringify({ command: "rm -rf /" }), status: "error", result: "Command denied by security policy" } } };

export const ReadFile_Success: Story = { args: { toolCall: { id: "read:0", name: "read_file", arguments: JSON.stringify({ path: "README.md", limit: 20 }), status: "ok", result: "1| # ftre\n2| \n3| AI Agent Gateway\n4| \n5| ## Quick Start\n..." } } };
export const ReadFile_Error: Story = { args: { toolCall: { id: "read:0", name: "read_file", arguments: JSON.stringify({ path: "/etc/shadow" }), status: "error", result: "PermissionError: [Errno 13] Permission denied" } } };

export const WriteFile_Running: Story = { args: { toolCall: { id: "write:0", name: "write_file", arguments: JSON.stringify({ path: "tetris.html", content: "<!DOCTYPE html>..." }), status: "running" } } };
export const WriteFile_Success: Story = { args: { toolCall: { id: "write:0", name: "write_file", arguments: JSON.stringify({ path: "tetris.html", content: "..." }), status: "ok", result: "Successfully wrote 3928 characters to tetris.html" } } };

export const WebSearch_Success: Story = { args: { toolCall: { id: "ws:0", name: "web_search", arguments: JSON.stringify({ query: "latest AI news", count: 5 }), status: "ok", result: "1. GPT-5 released\n   https://openai.com\n2. Claude 4 announced\n   https://anthropic.com" } } };

export const Glob_Success: Story = { args: { toolCall: { id: "glob:0", name: "glob", arguments: JSON.stringify({ pattern: "**/*.ts" }), status: "ok", result: "src/index.ts\nsrc/app.ts\nsrc/utils/helpers.ts\ntests/app.test.ts" } } };

export const Grep_NoMatch: Story = { args: { toolCall: { id: "grep:0", name: "grep", arguments: JSON.stringify({ pattern: "TODO", path: "src" }), status: "error", result: "No matches found" } } };

// ─── Parallel tools (multiple in one turn) ──────────────────────────

export const ParallelThreeTools: Story = {
  render: () => {
    const tools: ToolCall[] = [
      { id: "greet:0", name: "greet", arguments: JSON.stringify({ name: "Test" }), status: "ok", result: "Hello, Test!" },
      { id: "my:1", name: "my", arguments: JSON.stringify({ action: "check" }), status: "ok", result: "model: kimi-k2.6\niterations: 0/200" },
      { id: "web_search:2", name: "web_search", arguments: JSON.stringify({ query: "news", count: 3 }), status: "error", result: "Rate limited" },
    ];
    return (
      <div className="space-y-2">
        {tools.map((tc) => <InlineToolCallCard key={tc.id} toolCall={tc} />)}
      </div>
    );
  },
};

export const ParallelMixedStates: Story = {
  render: () => {
    const tools: ToolCall[] = [
      { id: "exec:0", name: "exec", arguments: JSON.stringify({ command: "ls" }), status: "ok", result: "file1.txt\nfile2.txt" },
      { id: "read:1", name: "read_file", arguments: '{"path": "main.py"', status: "running" },
      { id: "write:2", name: "write_file", arguments: "", status: "pending" },
    ];
    return (
      <div className="space-y-2">
        {tools.map((tc) => <InlineToolCallCard key={tc.id} toolCall={tc} />)}
      </div>
    );
  },
};

// ─── Edge cases ─────────────────────────────────────────────────────

export const LongResult: Story = {
  args: {
    toolCall: {
      id: "read:0",
      name: "read_file",
      arguments: JSON.stringify({ path: "big_file.py" }),
      status: "ok",
      result: Array.from({ length: 100 }, (_, i) => `${i + 1}| import module_${i}`).join("\n"),
    },
  },
};

export const LongArguments: Story = {
  args: {
    toolCall: {
      id: "write:0",
      name: "write_file",
      arguments: JSON.stringify({ path: "output.html", content: "x".repeat(500) }),
      status: "running",
    },
  },
};

export const UnknownTool: Story = {
  args: {
    toolCall: {
      id: "custom:0",
      name: "my_custom_plugin_tool",
      arguments: JSON.stringify({ foo: "bar", nested: { a: 1 } }),
      status: "ok",
      result: "Custom result",
    },
  },
};
