/**
 * Story: Live WebSocket Test
 *
 * 连接真实后端 WebSocket，发送真实消息，实时观察：
 * 1. 收到的原始消息流（带时间戳和 role 颜色标记）
 * 2. stream manager 组装后的 ChatMessage 渲染结果
 *
 * Features:
 * - 一键复制所有原始消息
 * - 下载为 .txt 文件
 * - 消息上限 500 条（超出自动截断旧消息，防止 DOM 爆炸）
 * - 点击单条消息复制其 JSON
 */
import { useState, useRef, useCallback, useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { isServerMessage } from "@/services/ws-protocol";
import type { ServerMessage } from "@/services/ws-protocol";
import { InlineToolCallCard } from "./InlineToolCallCard";
import type { ToolCall } from "@/services/ws-stream-manager";

// ─── Constants ──────────────────────────────────────────────────────

/** Max log entries to keep in DOM. Older entries are discarded from render but kept in full log for export. */
const MAX_VISIBLE_LOG = 200;

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
  "chat.send": "text-purple-300",
};

// ─── Utilities ──────────────────────────────────────────────────────

function formatLogForExport(entries: LogEntry[]): string {
  return entries
    .map((e) => `${e.time} ${e.direction === "send" ? ">" : "<"} ${e.raw}`)
    .join("\r\n");
}

function downloadAsFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

// ─── Log Entry Renderer (groups consecutive deltas) ─────────────────

interface LogGroup {
  type: "single" | "delta-group";
  entries: LogEntry[];
  role: string;
}

/** Group consecutive delta messages (assistant.delta, tool_call.delta) into collapsible groups */
function groupLogEntries(entries: LogEntry[]): LogGroup[] {
  const groups: LogGroup[] = [];
  let currentDeltaGroup: LogEntry[] | null = null;
  let currentDeltaRole = "";

  for (const entry of entries) {
    const isDelta = entry.role === "assistant.delta" || entry.role === "tool_call.delta";

    if (isDelta) {
      if (currentDeltaGroup && currentDeltaRole === entry.role) {
        currentDeltaGroup.push(entry);
      } else {
        if (currentDeltaGroup) {
          groups.push({ type: "delta-group", entries: currentDeltaGroup, role: currentDeltaRole });
        }
        currentDeltaGroup = [entry];
        currentDeltaRole = entry.role || "";
      }
    } else {
      if (currentDeltaGroup) {
        groups.push({ type: "delta-group", entries: currentDeltaGroup, role: currentDeltaRole });
        currentDeltaGroup = null;
      }
      groups.push({ type: "single", entries: [entry], role: entry.role || "" });
    }
  }
  if (currentDeltaGroup) {
    groups.push({ type: "delta-group", entries: currentDeltaGroup, role: currentDeltaRole });
  }

  return groups;
}

function LogEntries({ entries, onCopy }: { entries: LogEntry[]; onCopy: (e: LogEntry) => void }) {
  const groups = groupLogEntries(entries);

  return (
    <>
      {groups.map((group, gi) => {
        if (group.type === "single") {
          const entry = group.entries[0];
          return (
            <div
              key={gi}
              className="mb-0.5 text-[11px] font-mono leading-tight cursor-pointer hover:bg-white/5 px-1 rounded"
              onClick={() => onCopy(entry)}
              title="Click to copy"
            >
              <span className="text-t-ghost">{entry.time}</span>
              <span className={`ml-1 ${ROLE_COLORS[entry.role || ""] || "text-white"}`}>
                {entry.direction === "send" ? ">" : "<"} {entry.role || "?"}
              </span>
              <span className="ml-1 text-t-ghost truncate inline-block max-w-[400px] align-bottom">
                {entry.raw.length > 120 ? entry.raw.slice(0, 120) + "..." : entry.raw}
              </span>
            </div>
          );
        }

        // Delta group — collapsed by default
        const first = group.entries[0];
        const last = group.entries[group.entries.length - 1];
        return (
          <details key={gi} className="mb-0.5">
            <summary className="text-[11px] font-mono leading-tight cursor-pointer hover:bg-white/5 px-1 rounded list-none">
              <span className="text-t-ghost">{first.time}</span>
              <span className={`ml-1 ${ROLE_COLORS[group.role] || "text-white"}`}>
                {"<"} {group.role}
              </span>
              <span className="ml-1 text-t-ghost">
                [{group.entries.length} deltas, {first.time} - {last.time}]
              </span>
            </summary>
            <div className="ml-4 border-l border-white/10 pl-2">
              {group.entries.map((entry, ei) => (
                <div
                  key={ei}
                  className="text-[10px] font-mono text-t-ghost leading-tight cursor-pointer hover:bg-white/5 px-1 rounded"
                  onClick={() => onCopy(entry)}
                >
                  <span>{entry.time}</span>
                  <span className="ml-1 text-white/50">
                    {entry.parsed?.data?.delta !== undefined
                      ? JSON.stringify(entry.parsed.data.delta)
                      : entry.raw.slice(0, 80)}
                  </span>
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </>
  );
}

// ─── Live WebSocket Panel ───────────────────────────────────────────

function LiveWebSocketPanel() {
  const [url, setUrl] = useState("ws://127.0.0.1:18790/");
  const [connected, setConnected] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [input, setInput] = useState("");

  // Preset test prompts
  const presets = [
    "你好，你现在在测试。请尝试一下并行调用工具，调用工具之后再回答一些问题、说一些话，然后再调用工具",
    "帮我同时执行三个命令：python --version, echo hello, dir",
    "读一下 README.md 的前10行",
    "你是谁",
  ];
  const [assembled, setAssembled] = useState<AssembledMessage[]>([]);
  const [copyFeedback, setCopyFeedback] = useState("");

  const [autoScroll, setAutoScroll] = useState(false);

  // Full log (for export) — never truncated
  const fullLogRef = useRef<LogEntry[]>([]);
  // Visible log (for DOM) — capped at MAX_VISIBLE_LOG
  const [visibleLog, setVisibleLog] = useState<LogEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when enabled
  useEffect(() => {
    if (autoScroll) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [visibleLog, autoScroll]);

  // ─── Assemble messages from log ─────────────────────────────────
  const reassemble = useCallback((entries: LogEntry[]) => {
    const result: AssembledMessage[] = [];

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
            if (data.name) existing.name = data.name;
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
              ast.toolCalls.push({ id: call.call_id, name: call.name, arguments: args, status: "running" });
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

  // ─── Add log entry ──────────────────────────────────────────────
  const addLogEntry = useCallback((entry: LogEntry) => {
    fullLogRef.current.push(entry);
    setVisibleLog((prev) => {
      const next = [...prev, entry];
      // Cap visible entries
      return next.length > MAX_VISIBLE_LOG ? next.slice(-MAX_VISIBLE_LOG) : next;
    });
    reassemble(fullLogRef.current);
  }, [reassemble]);

  // ─── WebSocket Connection ───────────────────────────────────────
  const connect = useCallback(() => {
    if (wsRef.current) wsRef.current.close();

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      fullLogRef.current = [];
      setVisibleLog([]);
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
          if (role === "control" && parsed.data?.event === "session.ready") {
            setChatId(parsed.data.chat_id);
          }
        }
      } catch { /* not JSON */ }

      addLogEntry({ time: now, direction: "recv", raw, parsed, role });
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
  }, [url, addLogEntry]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  // ─── Send Message ───────────────────────────────────────────────
  const send = useCallback(() => {
    if (!wsRef.current || !chatId || !input.trim()) return;

    const frameId = crypto.randomUUID().slice(0, 12);
    const frame = { id: frameId, type: "chat.send", data: { chat_id: chatId, text: input, webui: true } };
    const raw = JSON.stringify(frame);
    wsRef.current.send(raw);

    const now = new Date().toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 });
    addLogEntry({ time: now, direction: "send", raw, parsed: frame, role: "chat.send" });
    setInput("");
  }, [chatId, input, addLogEntry]);

  // ─── Export Actions ─────────────────────────────────────────────
  const handleCopyAll = useCallback(async () => {
    const text = formatLogForExport(fullLogRef.current);
    await copyToClipboard(text);
    setCopyFeedback("已复制!");
    setTimeout(() => setCopyFeedback(""), 2000);
  }, []);

  const handleDownload = useCallback(() => {
    const text = formatLogForExport(fullLogRef.current);
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadAsFile(text, `ws-log-${ts}.txt`);
  }, []);

  const handleCopySingle = useCallback(async (entry: LogEntry) => {
    await copyToClipboard(entry.raw);
    setCopyFeedback("已复制单条!");
    setTimeout(() => setCopyFeedback(""), 1500);
  }, []);

  const handleClear = useCallback(() => {
    fullLogRef.current = [];
    setVisibleLog([]);
    setAssembled([]);
  }, []);

  // ─── Render ─────────────────────────────────────────────────────
  const totalCount = fullLogRef.current.length;
  const hiddenCount = totalCount - visibleLog.length;

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
        <div className="space-y-1.5">
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
          <div className="flex gap-1.5 flex-wrap">
            {presets.map((p, i) => (
              <button
                key={i}
                onClick={() => { setInput(p); }}
                className="px-2 py-0.5 text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 rounded text-t-secondary truncate max-w-[280px]"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main content: 50/50 split */}
      <div className="flex-1 flex gap-3 min-h-0">
        {/* Left: Raw message log */}
        <div className="w-1/2 flex flex-col min-h-0">
          {/* Log toolbar */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-t-ghost flex-1">
              原始消息流 ({totalCount}条{hiddenCount > 0 ? `，显示最近${visibleLog.length}条` : ""})
            </span>
            <button onClick={handleCopyAll} className="px-2 py-0.5 text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 rounded" title="复制全部">
              Copy All
            </button>
            <button onClick={handleDownload} className="px-2 py-0.5 text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 rounded" title="下载为 txt">
              Download
            </button>
            <button onClick={handleClear} className="px-2 py-0.5 text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 rounded" title="清空">
              Clear
            </button>
            {copyFeedback && <span className="text-[10px] text-green-400">{copyFeedback}</span>}
          </div>

          {/* Log entries */}
          <div className="flex-1 overflow-y-auto bg-black/20 rounded border border-white/5 p-2">
            {hiddenCount > 0 && (
              <div className="text-[10px] text-t-ghost mb-2 text-center">
                ... {hiddenCount} older entries hidden (export includes all)
              </div>
            )}
            <LogEntries entries={visibleLog} onCopy={handleCopySingle} />
            <div ref={logEndRef} />
          </div>
        </div>

        {/* Right: Assembled render preview */}
        <div className="w-1/2 overflow-y-auto bg-black/20 rounded border border-white/5 p-2">
          <div className="text-xs text-t-ghost mb-2">渲染预览</div>
          <div className="space-y-3">
            {assembled.map((msg, i) => (
              <div key={i} className={`p-2 rounded ${msg.role === "user" ? "bg-purple-500/10 border border-purple-500/20" : "bg-white/5 border border-white/10"}`}>
                <div className="text-[10px] text-t-ghost mb-1">{msg.role}</div>
                {msg.toolCalls.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {msg.toolCalls.map((tc) => (
                      <InlineToolCallCard key={tc.id} toolCall={tc} />
                    ))}
                  </div>
                )}
                {msg.content && (
                  <div className="text-sm text-t-primary whitespace-pre-wrap">{msg.content}</div>
                )}
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

      {/* Status bar */}
      <div className="text-[10px] text-t-ghost">
        chat_id: {chatId || "—"} | total: {totalCount} | visible: {visibleLog.length}
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
