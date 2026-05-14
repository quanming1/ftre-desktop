/**
 * Story: Protocol Validator
 *
 * 粘贴后端真实的 WebSocket 消息 JSON，验证：
 * 1. 消息格式是否符合 v5 协议（有 id, role, data）
 * 2. 各 role 的 data 结构是否正确
 * 3. 消息序列经过 convertHistoryMessages 后渲染是否正确
 *
 * 使用方法：
 * - 从 DevTools Network 面板复制 WebSocket 消息
 * - 粘贴到 textarea
 * - 查看解析结果和渲染预览
 */
import { useState, useCallback } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { isServerMessage } from "@/services/ws-protocol";
import type { ServerMessage } from "@/services/ws-protocol";
import { InlineToolCallCard } from "./InlineToolCallCard";
import type { ToolCall } from "@/services/ws-stream-manager";

// ─── Protocol Validation Logic ──────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  role: string;
  errors: string[];
  warnings: string[];
  data: Record<string, unknown>;
}

function validateMessage(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isServerMessage(raw)) {
    return { valid: false, role: "unknown", errors: ["Not a valid v5 message: missing id, role, or data"], warnings: [], data: {} };
  }

  const msg = raw as ServerMessage;
  const { role, data } = msg;

  switch (role) {
    case "control": {
      const d = data as Record<string, unknown>;
      if (!d.event) errors.push("control message missing data.event");
      break;
    }
    case "assistant.delta": {
      const d = data as Record<string, unknown>;
      if (typeof d.delta !== "string") errors.push("assistant.delta missing data.delta (string)");
      if (typeof d.seq !== "number") errors.push("assistant.delta missing data.seq (number)");
      if (typeof d.content !== "string") errors.push("assistant.delta missing data.content (string)");
      break;
    }
    case "assistant": {
      const d = data as Record<string, unknown>;
      if (!("content" in d)) errors.push("assistant missing data.content");
      if (!d.timestamp) warnings.push("assistant missing data.timestamp");
      break;
    }
    case "tool_call": {
      const d = data as Record<string, unknown>;
      if (!Array.isArray(d.calls)) {
        errors.push("tool_call missing data.calls (array)");
      } else {
        for (let i = 0; i < d.calls.length; i++) {
          const call = d.calls[i] as Record<string, unknown>;
          if (!call.call_id) errors.push(`calls[${i}] missing call_id`);
          if (!call.name) errors.push(`calls[${i}] missing name`);
          if (typeof call.arguments !== "object") errors.push(`calls[${i}].arguments should be object, got ${typeof call.arguments}`);
        }
      }
      break;
    }
    case "tool_call.delta": {
      const d = data as Record<string, unknown>;
      if (!d.call_id) errors.push("tool_call.delta missing data.call_id");
      if (typeof d.delta !== "string") errors.push("tool_call.delta missing data.delta (string)");
      break;
    }
    case "tool_result": {
      const d = data as Record<string, unknown>;
      if (!d.call_id) errors.push("tool_result missing data.call_id");
      if (!d.name) errors.push("tool_result missing data.name");
      if (!("output" in d) && !("error" in d)) warnings.push("tool_result has neither output nor error");
      break;
    }
    case "user": {
      const d = data as Record<string, unknown>;
      if (!("content" in d)) errors.push("user missing data.content");
      break;
    }
    default:
      warnings.push(`Unknown role: "${role}"`);
  }

  return { valid: errors.length === 0, role, errors, warnings, data: data as Record<string, unknown> };
}

// ─── Components ─────────────────────────────────────────────────────

function ValidationBadge({ result }: { result: ValidationResult }) {
  return (
    <div className={`p-3 rounded border ${result.valid ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${result.valid ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
          {result.role}
        </span>
        <span className={`text-xs ${result.valid ? "text-green-400" : "text-red-400"}`}>
          {result.valid ? "✓ Valid" : "✗ Invalid"}
        </span>
      </div>
      {result.errors.map((e, i) => (
        <div key={i} className="text-xs text-red-400 ml-2">✗ {e}</div>
      ))}
      {result.warnings.map((w, i) => (
        <div key={i} className="text-xs text-yellow-400 ml-2">⚠ {w}</div>
      ))}
    </div>
  );
}

function ToolSequencePreview({ messages }: { messages: any[] }) {
  // Simulate what the frontend does: extract tool calls from the sequence
  const toolCalls: ToolCall[] = [];

  for (const m of messages) {
    if (m.role === "tool_call" && m.data?.calls) {
      for (const call of m.data.calls) {
        toolCalls.push({
          id: call.call_id,
          name: call.name || "unknown",
          arguments: typeof call.arguments === "object" ? JSON.stringify(call.arguments) : call.arguments || "{}",
          status: "running",
        });
      }
    }
    if (m.role === "tool_result") {
      const tc = toolCalls.find((t) => t.id === m.data?.call_id);
      if (tc) {
        tc.status = m.data.error ? "error" : "ok";
        tc.result = m.data.error || m.data.output || "";
      }
    }
  }

  if (toolCalls.length === 0) return <div className="text-xs text-t-ghost">No tool calls in sequence</div>;

  return (
    <div className="space-y-2">
      <div className="text-xs text-t-secondary mb-1">Tool Render Preview:</div>
      {toolCalls.map((tc) => (
        <InlineToolCallCard key={tc.id} toolCall={tc} />
      ))}
    </div>
  );
}

// ─── Main Story Component ───────────────────────────────────────────

function ProtocolValidatorPanel() {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [parsedMessages, setParsedMessages] = useState<any[]>([]);

  const validate = useCallback(() => {
    const lines = input.trim().split("\n").filter(Boolean);
    const msgs: any[] = [];
    const res: ValidationResult[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        msgs.push(parsed);
        res.push(validateMessage(parsed));
      } catch {
        res.push({ valid: false, role: "parse_error", errors: [`Invalid JSON: ${line.slice(0, 50)}...`], warnings: [], data: {} });
      }
    }

    setResults(res);
    setParsedMessages(msgs);
  }, [input]);

  return (
    <div className="space-y-4 text-white">
      <div>
        <label className="text-sm text-t-secondary block mb-1">
          粘贴 WebSocket 消息（每行一条 JSON）：
        </label>
        <textarea
          className="w-full h-40 bg-black/30 border border-white/10 rounded p-2 text-xs font-mono text-white resize-y"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={'{"id":"ctrl_xxx","role":"control","data":{"event":"turn.start","chat_id":"abc"},"metadata":{"ephemeral":true}}\n{"id":"msg_xxx","role":"tool_call","data":{"calls":[{"call_id":"tc_1","name":"exec","arguments":{"command":"ls"}}],"timestamp":"..."}}\n{"id":"msg_yyy","role":"tool_result","data":{"call_id":"tc_1","name":"exec","output":"file1.txt\\nfile2.txt","timestamp":"..."}}'}
        />
        <button
          onClick={validate}
          className="mt-2 px-4 py-1.5 bg-neon/20 text-neon border border-neon/30 rounded text-sm hover:bg-neon/30 transition-colors"
        >
          验证协议格式
        </button>
      </div>

      {results.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm text-t-secondary">
            验证结果：{results.filter((r) => r.valid).length}/{results.length} 通过
          </div>
          {results.map((r, i) => (
            <ValidationBadge key={i} result={r} />
          ))}
        </div>
      )}

      {parsedMessages.length > 0 && (
        <div className="border-t border-white/10 pt-4">
          <ToolSequencePreview messages={parsedMessages} />
        </div>
      )}
    </div>
  );
}

// ─── Story Definition ───────────────────────────────────────────────

const meta: Meta = {
  title: "Debug/ProtocolValidator",
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[800px] p-6 bg-[#1a1a2e] min-h-screen">
        <Story />
      </div>
    ),
  ],
};

export default meta;

export const Validator: StoryObj = {
  render: () => <ProtocolValidatorPanel />,
};

// Pre-filled with a real tool sequence for quick testing
export const WithSampleData: StoryObj = {
  render: () => {
    const sampleMessages = [
      { id: "ctrl_001", role: "control", data: { event: "turn.start", chat_id: "abc123" }, metadata: { ephemeral: true } },
      { id: "msg_001", role: "tool_call.delta", data: { call_id: "functions.exec:0", delta: "", name: "exec" }, metadata: { ephemeral: true, chat_id: "abc123" } },
      { id: "msg_002", role: "tool_call", data: { calls: [{ call_id: "functions.exec:0", name: "exec", arguments: { command: "python --version" } }], timestamp: "2026-05-14T16:00:00Z" }, metadata: { chat_id: "abc123" } },
      { id: "msg_003", role: "tool_result", data: { call_id: "functions.exec:0", name: "exec", output: "Python 3.11.8\n\nExit code: 0", timestamp: "2026-05-14T16:00:01Z" }, metadata: { chat_id: "abc123" } },
      { id: "msg_004", role: "assistant", data: { content: "Python 版本是 3.11.8。", timestamp: "2026-05-14T16:00:01Z" }, metadata: { chat_id: "abc123" } },
      { id: "ctrl_002", role: "control", data: { event: "turn.end", chat_id: "abc123" }, metadata: { ephemeral: true } },
    ];

    const results = sampleMessages.map(validateMessage);
    const allValid = results.every((r) => r.valid);

    return (
      <div className="space-y-4 text-white">
        <div className={`text-sm font-mono ${allValid ? "text-green-400" : "text-red-400"}`}>
          {allValid ? "✓ All messages valid" : "✗ Some messages invalid"}
        </div>
        <div className="space-y-2">
          {results.map((r, i) => (
            <ValidationBadge key={i} result={r} />
          ))}
        </div>
        <div className="border-t border-white/10 pt-4">
          <ToolSequencePreview messages={sampleMessages} />
        </div>
      </div>
    );
  },
};
