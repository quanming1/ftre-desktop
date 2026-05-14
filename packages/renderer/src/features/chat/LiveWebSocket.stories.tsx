/**
 * Story: Live WebSocket Test
 *
 * 连接真实后端 WebSocket，发送真实消息，实时观察：
 * 1. 收到的原始消息流（带时间戳和 role 颜色标记）
 * 2. stream manager 组装后的 ChatMessage 渲染结果
 *
 * 使用方法：
 * 1. 确保后端 gateway 在运行（默认 ws://127.0.0.1:18790/）
 * 2. 打开这个 story
 * 3. 输入消息发送
 * 4. 左侧看原始协议消息，右侧看渲染结果
 */
import { useState, useRef, useCallback, useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { isServerMessage } from "@/services/ws-protocol";
import type { ServerMessage } from "@/services/ws-protocol";
import { InlineToolCallCard } from "./InlineToolCallCard";
import type { ToolCall } from "@/services/ws-stream-manager";

// ─── Types ──────────────────────────────────────────────────────────

interface LogEntry {
  time: string;
  direction: "send" | "recv";
  raw: string;
  parsed: any;
  role?: string;
}

interface AssembledMessage {
  id: string;
  role: "user" | "assistant";
  content: string | null;
  toolCalls: ToolCall[];
  reasoning?: string;
}

// ─── Role Colors ────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  control: "text-gray-400",
  "assistant.delta": "text-blue-400",
  assistant: "text-cyan-400",
  "tool_call.delta": "text-orange-300",
  tool_call: "text-orange-400",
  tool_result: "text-green-400",
  user: "text-purple-400",
};

// ─── Live WebSocket Panel ───────────────────────────────────────────

function LiveWebSocketPanel() {
  const [url, setUrl] = useState("ws://127.0.0.1:18790/");
  const [connected, setConnected] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [input, setInput] = useState("你好，试试调用一个工具");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [assembled, setAssembled] = useState<AssembledMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  // ─── Assemble messages from log (same logic as stream manager) ──
  const reassemble = useCallback((entries: LogEntry[]) => {
    const result: AssembledMessage[] = [];
    const toolCallMap = new Map<string, { msgIdx: number; tcIdx: number }>();

    function currentAssistant(): AssembledMessage {
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i].role === "assistant") return result[i];
        if (result[i].role === "user") break;
      }
      const msg: AssembledMessage = { id: `asm_${Date.now()}`, role: "assistant", content: null, toolCalls: [] };
      result.push(msg);
      return msg;
    }

    for (const entry of entries) {
      if (entry.direction !== "recv" || !entry.parsed) continue;
      const { role, data, id } = entry.parsed;
      if (!role || !data) continue;

      switch (role) {
        case "user":
          result.push({ id, role: "user", content: data.content || "", toolCalls: [] });
          break;

        case "assistant.delta":
          currentAssistant().content = data.content || "";
          break;

        case "assistant": {
          const ast = currentAssistant();
          ast.content = data.content || ast.content;
          ast.id = id;
          if (data.reasoning) ast.reasoning = data.reasoning;
          break;
        }

        case "tool_call.delta": {
          const ast = currentAssistant();
          const existing = ast.toolCalls.find((tc) => tc.id === data.call_id);
          if (!existing && data.name) {
            ast.toolCalls.push({ id: data.call_id, name: data.name, arguments: data.delta || "", status: "running" });
          } else if (existing) {
            existing.arguments += data.delta || "";
          }
          break;
        }

        case "tool_call": {
          const ast = currentAssistant();
          for (const call of data.calls || []) {
            const existing = ast.toolCalls.find((tc) => tc.id === call.call_id);
            const args = typeof call.arguments === "object" ? JSON.stringify(call.arguments) : call.arguments || "{}";
            if (existing) {
              existing.arguments = args;
            } else {
              const tcIdx = ast.toolCalls.length;
              ast.toolCalls.push({ id: call.call_id, name: call.name, arguments: args, status: "running" });
              toolCallMap.set(call.call_id, { msgIdx: result.indexOf(ast), tcIdx });
            }
          }
          break;
        }

        case "tool_result": {
          const ast = currentAssistant();
          const tc = ast.toolCalls.find((t) => t.id === data.call_id);
          if (tc) {
            tc.status = data.error ? "error" : "ok";
            tc.result = data.error || data.output || "";
          }
          break;
        }
      }
    }

    setAssembled([...result]);
  }, []);

  // ─── WebSocket Connection ───────────────────────────────────────
  const connect = useCallback(() => {
    if (wsRef.current) wsRef.current.close();

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setLog([]);
      setAssembled([]);
    };

    ws.onmessage = (event) => {
      const now = new Date().toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 });
      const raw = event.data as string;
      let parsed: any = null;
      let role: string | undefined;

      try {
        parsed = JSON.parse(raw);
        if (isServerMessage(parsed)) {
          role = parsed.role;
          // Extract chat_id from session.ready
          if (role === "control" && parsed.data?.event === "session.ready") {
            setChatId(parsed.data.chat_id);
          }
        }
      } catch { /* not JSON */ }

      const entry: LogEntry = { time: now, direction: "recv", raw, parsed, role };
      setLog((prev) => {
        const next = [...prev, entry];
        reassemble(next);
        return next;
      });
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
  }, [url, reassemble]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  // ─── Send Message ───────────────────────────────────────────────
  const send = useCallback(() => {
    if (!wsRef.current || !chatId || !input.trim()) return;

    const frameId = crypto.randomUUID().slice(0, 12);
    const frame = {
      id: frameId,
      type: "chat.send",
      data: { chat_id: chatId, text: input, webui: true },
    };
    const raw = JSON.stringify(frame);
    wsRef.current.send(raw);

    const now = new Date().toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 });
    setLog((prev) => [...prev, { time: now, direction: "send", raw, parsed: frame, role: "chat.send" }]);
    setInput("");
  }, [chatId, input]);

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="text-white h-[90vh] flex flex-col gap-3">
      {/* Connection bar */}
      <div className="flex items-center gap-2">
        <input
          className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs font-mono"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          onClick={connected ? disconnect : connect}
          className={`px-3 py-1 text-xs rounded border ${connected ? "border-red-500/50 text-red-400 hover:bg-red-500/10" : "border-green-500/50 text-green-400 hover:bg-green-500/10"}`}
        >
          {connected ? "断开" : "连接"}
        </button>
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
      </div>

      {/* Send bar */}
      {connected && chatId && (
        <div className="flex gap-2">
          <input
            className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="输入消息..."
          />
          <button onClick={send} className="px-3 py-1 text-xs bg-neon/20 text-neon border border-neon/30 rounded hover:bg-neon/30">
            发送
          </button>
        </div>
      )}

      {/* Main content: log + render preview */}
      <div className="flex-1 flex gap-3 min-h-0">
        {/* Left: Raw message log */}
        <div className="flex-1 overflow-y-auto bg-black/20 rounded border border-white/5 p-2">
          <div className="text-xs text-t-ghost mb-2">原始消息流 ({log.length})</div>
          {log.map((entry, i) => (
            <div key={i} className="mb-1 text-[11px] font-mono leading-tight">
              <span className="text-t-ghost">{entry.time}</span>
              <span className={`ml-1 ${entry.direction === "send" ? "text-purple-400" : ROLE_COLORS[entry.role || ""] || "text-white"}`}>
                {entry.direction === "send" ? "→" : "←"} {entry.role || "raw"}
              </span>
              <details className="ml-4 inline">
                <summary className="cursor-pointer text-t-ghost hover:text-white inline">
                  {entry.raw.length > 80 ? entry.raw.slice(0, 80) + "..." : entry.raw}
                </summary>
                <pre className="mt-1 p-1 bg-black/30 rounded text-[10px] whitespace-pre-wrap break-all">
                  {JSON.stringify(entry.parsed, null, 2)}
                </pre>
              </details>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        {/* Right: Assembled render preview */}
        <div className="flex-1 overflow-y-auto bg-black/20 rounded border border-white/5 p-2">
          <div className="text-xs text-t-ghost mb-2">渲染预览</div>
          <div className="space-y-3">
            {assembled.map((msg, i) => (
              <div key={i} className={`p-2 rounded ${msg.role === "user" ? "bg-purple-500/10 border border-purple-500/20" : "bg-white/5 border border-white/10"}`}>
                <div className="text-[10px] text-t-ghost mb-1">{msg.role} ({msg.id})</div>
                {/* Tool cards */}
                {msg.toolCalls.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {msg.toolCalls.map((tc) => (
                      <InlineToolCallCard key={tc.id} toolCall={tc} />
                    ))}
                  </div>
                )}
                {/* Text content */}
                {msg.content && (
                  <div className="text-sm text-t-primary whitespace-pre-wrap">{msg.content}</div>
                )}
                {/* Reasoning */}
                {msg.reasoning && (
                  <details className="mt-1">
                    <summary className="text-[10px] text-t-ghost cursor-pointer">reasoning</summary>
                    <div className="text-[11px] text-t-secondary mt-1 whitespace-pre-wrap">{msg.reasoning}</div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="text-[10px] text-t-ghost">
        chat_id: {chatId || "—"} | messages: {log.filter((l) => l.direction === "recv").length} recv, {log.filter((l) => l.direction === "send").length} sent
      </div>
    </div>
  );
}

// ─── Story ──────────────────────────────────────────────────────────

const meta: Meta = {
  title: "Debug/LiveWebSocket",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="p-4 bg-[#1a1a2e] min-h-screen">
        <Story />
      </div>
    ),
  ],
};

export default meta;

export const Live: StoryObj = {
  render: () => <LiveWebSocketPanel />,
};
