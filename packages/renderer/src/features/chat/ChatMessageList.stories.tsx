/**
 * Story: ChatMessageList
 *
 * Tests the full message list rendering in two modes:
 * 1. Mock data — predefined conversations with various message types
 * 2. Live WebSocket — connects to real backend, renders real-time messages
 */
import { useState, useCallback, useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ChatMessageList } from "./ChatMessageList";
import type { ChatMessage, ToolCall } from "@/services/ws-stream-manager";

const meta: Meta<typeof ChatMessageList> = {
  title: "Chat/ChatMessageList",
  component: ChatMessageList,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-screen bg-[#1a1a2e]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ChatMessageList>;

// ─── Mock Data ──────────────────────────────────────────────────────

const MOCK_SIMPLE: ChatMessage[] = [
  { id: "m1", role: "user", content: "Hello", timestamp: Date.now() - 5000 },
  { id: "m2", role: "assistant", content: "Hi! How can I help you?", timestamp: Date.now() - 4000 },
  { id: "m3", role: "user", content: "What is 2+2?", timestamp: Date.now() - 3000 },
  { id: "m4", role: "assistant", content: "2 + 2 = **4**", timestamp: Date.now() - 2000 },
];

const MOCK_WITH_TOOLS: ChatMessage[] = [
  { id: "m1", role: "user", content: "Read my README.md", timestamp: Date.now() - 10000 },
  {
    id: "m2",
    role: "assistant",
    content: "Here's the content of your README.md:",
    timestamp: Date.now() - 8000,
    toolCalls: [
      {
        id: "tc_1",
        name: "read_file",
        arguments: JSON.stringify({ path: "README.md", limit: 20 }),
        status: "ok",
        result: "1| # ftre\n2| \n3| AI Agent Gateway Framework\n4| \n5| ## Quick Start\n6| \n7| ```bash\n8| pip install -e .\n9| ```",
      },
    ],
  },
];

const MOCK_PARALLEL_TOOLS: ChatMessage[] = [
  { id: "m1", role: "user", content: "Run three tools in parallel", timestamp: Date.now() - 15000 },
  {
    id: "m2",
    role: "assistant",
    content: "All three tools executed successfully:\n\n1. **greet** returned a greeting\n2. **my check** shows model info\n3. **web_search** found some results",
    timestamp: Date.now() - 8000,
    toolCalls: [
      { id: "greet:0", name: "greet", arguments: JSON.stringify({ name: "Test" }), status: "ok", result: "Hello, Test!" },
      { id: "my:1", name: "my", arguments: JSON.stringify({ action: "check" }), status: "ok", result: "model: kimi-k2.6\nmax_iterations: 200" },
      { id: "web:2", name: "web_search", arguments: JSON.stringify({ query: "AI news", count: 3 }), status: "ok", result: "1. OpenAI GPT-5\n2. Claude 4\n3. Gemini 2" },
    ],
  },
];

const MOCK_STREAMING: ChatMessage[] = [
  { id: "m1", role: "user", content: "Tell me a story", timestamp: Date.now() - 3000 },
  { id: "m2", role: "assistant", content: "Once upon a time, in a land far away...", timestamp: Date.now(), streaming: true },
];

const MOCK_ERROR_TOOL: ChatMessage[] = [
  { id: "m1", role: "user", content: "Read a file that doesn't exist", timestamp: Date.now() - 5000 },
  {
    id: "m2",
    role: "assistant",
    content: "The file doesn't exist. Would you like me to create it?",
    timestamp: Date.now() - 3000,
    toolCalls: [
      { id: "read:0", name: "read_file", arguments: JSON.stringify({ path: "/not/exist.py" }), status: "error", result: "FileNotFoundError: No such file or directory" },
    ],
  },
];

const MOCK_REASONING: ChatMessage[] = [
  { id: "m1", role: "user", content: "What is the meaning of life?", timestamp: Date.now() - 5000 },
  {
    id: "m2",
    role: "assistant",
    content: "42.",
    timestamp: Date.now() - 3000,
    reasoning: "The user is asking a philosophical question. This is a reference to The Hitchhiker's Guide to the Galaxy by Douglas Adams, where the answer to the ultimate question of life, the universe, and everything is 42. I'll give the concise answer.",
  },
];

const MOCK_MULTI_TURN: ChatMessage[] = [
  { id: "m1", role: "user", content: "Check my system", timestamp: Date.now() - 20000 },
  {
    id: "m2",
    role: "assistant",
    content: "System check complete. Python 3.11.8, all good.",
    timestamp: Date.now() - 15000,
    toolCalls: [
      { id: "exec:0", name: "exec", arguments: JSON.stringify({ command: "python --version" }), status: "ok", result: "Python 3.11.8\n\nExit code: 0" },
    ],
  },
  { id: "m3", role: "user", content: "Now list my files and search for TODO", timestamp: Date.now() - 10000 },
  {
    id: "m4",
    role: "assistant",
    content: "Found 3 files and 2 TODOs:",
    timestamp: Date.now() - 5000,
    toolCalls: [
      { id: "glob:0", name: "glob", arguments: JSON.stringify({ pattern: "src/**/*.py" }), status: "ok", result: "src/main.py\nsrc/utils.py\nsrc/config.py" },
      { id: "grep:1", name: "grep", arguments: JSON.stringify({ pattern: "TODO", path: "src" }), status: "ok", result: "src/main.py:15: # TODO: add error handling\nsrc/utils.py:42: # TODO: optimize" },
    ],
  },
];

// ─── Static Stories (Mock Data) ─────────────────────────────────────

export const SimpleConversation: Story = {
  args: { messages: MOCK_SIMPLE },
};

export const WithToolCalls: Story = {
  args: { messages: MOCK_WITH_TOOLS },
};

export const ParallelTools: Story = {
  args: { messages: MOCK_PARALLEL_TOOLS },
};

export const Streaming: Story = {
  args: { messages: MOCK_STREAMING, isBusy: true },
};

export const ToolError: Story = {
  args: { messages: MOCK_ERROR_TOOL },
};

export const WithReasoning: Story = {
  args: { messages: MOCK_REASONING },
};

export const MultiTurnWithTools: Story = {
  args: { messages: MOCK_MULTI_TURN },
};

export const Empty: Story = {
  args: { messages: [] },
};

export const BusyNoMessages: Story = {
  args: { messages: [], isBusy: true },
};

// ─── Live WebSocket Story ───────────────────────────────────────────

import { WsLogPanel, type LogEntry } from "./WsLogPanel";
import { wsClient } from "@/services/websocket-client";
import { streamManager } from "@/services/ws-stream-manager";
import type { ChatSession } from "@/services/ws-stream-manager";

/**
 * LiveChatPanel — uses the REAL streamManager and wsClient.
 * No duplicated message assembly logic. Tests the actual production code path.
 */
function LiveChatPanel() {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [input, setInput] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);

  // Subscribe to streamManager changes
  useEffect(() => {
    const unsub = streamManager.onChange((s) => {
      setSession({ ...s, messages: [...s.messages] });
    });
    const unsubFocus = streamManager.onFocus(() => {
      const active = streamManager.getActiveSession();
      if (active) setSession({ ...active, messages: [...active.messages] });
    });
    return () => { unsub(); unsubFocus(); };
  }, []);

  // Intercept raw WS messages for the log panel
  useEffect(() => {
    const origOnMessage = wsClient["ws"]?.onmessage;
    const unsub = wsClient.onMessage((msg) => {
      const time = new Date().toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 });
      setLogEntries((prev) => [...prev, {
        time,
        direction: "recv" as const,
        raw: JSON.stringify(msg),
        parsed: msg,
        role: msg.role,
      }]);
    });
    return unsub;
  }, []);

  // Connect on mount
  useEffect(() => {
    if (!wsClient.connected) {
      wsClient.connect();
    }
    // If already connected, grab current session
    const active = streamManager.getActiveSession();
    if (active) setSession({ ...active, messages: [...active.messages] });
  }, []);

  const chatId = streamManager.getActiveChatId();
  const connected = wsClient.connected;

  const send = useCallback(() => {
    if (!input.trim()) return;
    const time = new Date().toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 });
    setLogEntries((prev) => [...prev, { time, direction: "send", raw: input, parsed: null, role: "user" }]);
    streamManager.sendMessage(input);
    setInput("");
  }, [input]);

  const messages = session?.messages || [];
  const isBusy = session?.isBusy || false;

  return (
    <div className="h-full flex flex-col relative">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-white/10 bg-black/20">
        <span className="text-xs text-t-ghost font-mono flex-1">
          chat: {chatId || "—"} | msgs: {messages.length}
        </span>
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
        <span className="text-[10px] text-t-ghost">{connected ? "Connected" : "Disconnected"}</span>
        <button
          onClick={() => setShowLog((v) => !v)}
          className={`px-3 py-1 text-xs rounded border ${showLog ? "border-neon/50 text-neon bg-neon/10" : "border-white/20 text-t-ghost"}`}
        >
          WS Log ({logEntries.length})
        </button>
      </div>

      {/* Message list — uses the real ChatMessageList component */}
      <ChatMessageList messages={messages} isBusy={isBusy} className="flex-1" />

      {/* Input */}
      {connected && chatId && (
        <div className="flex gap-2 p-2 border-t border-white/10 bg-black/20">
          <input
            className="flex-1 bg-black/30 border border-white/10 rounded px-3 py-1.5 text-sm text-white"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Type a message..."
          />
          <button onClick={send} className="px-4 py-1.5 text-xs bg-neon/20 text-neon border border-neon/30 rounded">Send</button>
        </div>
      )}

      {/* WS Log Panel */}
      {showLog && (
        <div className="absolute top-0 right-0 w-[50%] h-full bg-[#0d0d1a] border-l border-white/10 z-50 flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10">
            <span className="text-xs text-t-secondary">WebSocket Log</span>
            <button onClick={() => setShowLog(false)} className="text-xs text-t-ghost hover:text-white">Close</button>
          </div>
          <WsLogPanel entries={logEntries} onClear={() => setLogEntries([])} className="flex-1 min-h-0" />
        </div>
      )}
    </div>
  );
}

export const LiveWebSocket: Story = {
  render: () => <LiveChatPanel />,
};
