/**
 * Story: ChatMessageList
 *
 * Tests the full message list rendering in two modes:
 * 1. Mock data — predefined conversations with various message types
 * 2. Live WebSocket — connects to real backend, renders real-time messages
 */
import { useState, useRef, useCallback, useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ChatMessageList } from "./ChatMessageList";
import type { ChatMessage, ToolCall } from "@/services/ws-stream-manager";
import { isServerMessage } from "@/services/ws-protocol";
import type { ServerMessage, ToolCallData, ToolResultData, AssistantDeltaData, AssistantData, ToolCallDeltaData } from "@/services/ws-protocol";

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

function LiveChatPanel() {
  const [url, setUrl] = useState("ws://127.0.0.1:18790/");
  const [connected, setConnected] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [input, setInput] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const toolArgBuffers = useRef<Map<string, string>>(new Map());

  function addLog(direction: "send" | "recv", raw: string, parsed: any, role?: string) {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 });
    setLogEntries((prev) => [...prev, { time, direction, raw, parsed, role }]);
  }

  // Message assembly helpers
  function getCurrentAssistant(msgs: ChatMessage[]): ChatMessage {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant") return msgs[i];
      if (msgs[i].role === "user") break;
    }
    const msg: ChatMessage = { id: `ast_${Date.now()}`, role: "assistant", content: null, timestamp: Date.now(), toolCalls: [] };
    msgs.push(msg);
    return msg;
  }

  const handleServerMessage = useCallback((raw: string) => {
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { return; }
    if (!isServerMessage(parsed)) return;

    const { role, data, id } = parsed as ServerMessage;
    addLog("recv", raw, parsed, role);

    setMessages((prev) => {
      const msgs = [...prev];

      switch (role) {
        case "control": {
          const event = (data as any).event;
          if (event === "session.ready") setChatId((data as any).chat_id);
          if (event === "turn.start") setIsBusy(true);
          if (event === "turn.end") {
            setIsBusy(false);
            for (const m of msgs) {
              if (m.streaming) m.streaming = false;
              if (m.toolCalls) {
                for (const tc of m.toolCalls) {
                  if (tc.status === "running" || tc.status === "pending") tc.status = "ok";
                }
              }
            }
          }
          break;
        }

        case "assistant.delta": {
          const d = data as AssistantDeltaData;
          const ast = getCurrentAssistant(msgs);
          ast.content = d.content;
          ast.streaming = true;
          ast.id = id;
          const idx = msgs.indexOf(ast);
          if (idx !== -1) msgs[idx] = { ...ast };
          break;
        }

        case "assistant": {
          const d = data as AssistantData;
          const ast = getCurrentAssistant(msgs);
          ast.content = d.content || ast.content;
          ast.streaming = false;
          ast.id = id;
          if (d.reasoning) ast.reasoning = d.reasoning;
          const idx = msgs.indexOf(ast);
          if (idx !== -1) msgs[idx] = { ...ast };
          break;
        }

        case "tool_call.delta": {
          const d = data as ToolCallDeltaData;
          const buf = toolArgBuffers.current.get(d.call_id) || "";
          toolArgBuffers.current.set(d.call_id, buf + d.delta);
          const ast = getCurrentAssistant(msgs);
          if (!ast.toolCalls) ast.toolCalls = [];
          const existing = ast.toolCalls.find((tc) => tc.id === d.call_id);
          if (existing) {
            if (d.name) existing.name = d.name;
            existing.arguments = toolArgBuffers.current.get(d.call_id) || "";
          } else {
            ast.toolCalls.push({ id: d.call_id, name: d.name || "unknown", arguments: d.delta, status: "running" });
          }
          ast.streaming = true;
          const idx = msgs.indexOf(ast);
          if (idx !== -1) msgs[idx] = { ...ast, toolCalls: [...ast.toolCalls] };
          break;
        }

        case "tool_call": {
          const d = data as ToolCallData;
          const ast = getCurrentAssistant(msgs);
          if (!ast.toolCalls) ast.toolCalls = [];
          for (const call of d.calls) {
            const argsStr = typeof call.arguments === "object" ? JSON.stringify(call.arguments) : String(call.arguments);
            const existing = ast.toolCalls.find((tc) => tc.id === call.call_id);
            if (existing) { existing.arguments = argsStr; existing.name = call.name; }
            else { ast.toolCalls.push({ id: call.call_id, name: call.name, arguments: argsStr, status: "running" }); }
            toolArgBuffers.current.delete(call.call_id);
          }
          const idx = msgs.indexOf(ast);
          if (idx !== -1) msgs[idx] = { ...ast, toolCalls: [...ast.toolCalls] };
          break;
        }

        case "tool_result": {
          const d = data as ToolResultData;
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].toolCalls) {
              const tc = msgs[i].toolCalls!.find((t) => t.id === d.call_id);
              if (tc) {
                tc.status = d.error ? "error" : "ok";
                tc.result = d.error || d.output || "";
                tc.name = d.name || tc.name;
                msgs[i] = { ...msgs[i], toolCalls: [...msgs[i].toolCalls!] };
                break;
              }
            }
            if (msgs[i].role === "user") break;
          }
          break;
        }
      }

      return msgs;
    });
  }, []);

  const connect = useCallback(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => { setConnected(true); setMessages([]); setIsBusy(false); setLogEntries([]); toolArgBuffers.current.clear(); };
    ws.onmessage = (e) => handleServerMessage(e.data);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
  }, [url, handleServerMessage]);

  const disconnect = useCallback(() => { wsRef.current?.close(); wsRef.current = null; }, []);

  const send = useCallback(() => {
    if (!wsRef.current || !chatId || !input.trim()) return;
    const frame = { id: crypto.randomUUID().slice(0, 12), type: "chat.send", data: { chat_id: chatId, text: input, webui: true } };
    const raw = JSON.stringify(frame);
    wsRef.current.send(raw);
    addLog("send", raw, frame, "chat.send");
    setMessages((prev) => [...prev, { id: `user_${Date.now()}`, role: "user", content: input, timestamp: Date.now() }]);
    setInput("");
  }, [chatId, input]);

  return (
    <div className="h-full flex flex-col relative">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-white/10 bg-black/20">
        <input className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs font-mono text-white" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button onClick={connected ? disconnect : connect} className={`px-3 py-1 text-xs rounded border text-white ${connected ? "border-red-500/50" : "border-green-500/50"}`}>
          {connected ? "Disconnect" : "Connect"}
        </button>
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
        <button
          onClick={() => setShowLog((v) => !v)}
          className={`px-3 py-1 text-xs rounded border ${showLog ? "border-neon/50 text-neon bg-neon/10" : "border-white/20 text-t-ghost"}`}
        >
          WS Log ({logEntries.length})
        </button>
      </div>

      {/* Message list */}
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

      {/* WS Log Panel (slide-in from right) */}
      {showLog && (
        <div className="absolute top-0 right-0 w-[50%] h-full bg-[#0d0d1a] border-l border-white/10 z-50 flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10">
            <span className="text-xs text-t-secondary">WebSocket Log</span>
            <button onClick={() => setShowLog(false)} className="text-xs text-t-ghost hover:text-white">Close</button>
          </div>
          <WsLogPanel
            entries={logEntries}
            onClear={() => setLogEntries([])}
            className="flex-1 min-h-0"
          />
        </div>
      )}
    </div>
  );
}

export const LiveWebSocket: Story = {
  render: () => <LiveChatPanel />,
};
