/**
 * ToolCallCardV2 — Renders tool calls with full lifecycle support.
 *
 * Tool call lifecycle (protocol v2):
 *   chat.tool_use (phase=start)   → status: "pending"  — card appears, args streaming in
 *   chat.tool_args_delta          → argsBuffer grows    — live args preview
 *   chat.tool_use (phase=ready)   → status: "running"  — args complete, executing
 *   chat.tool_result              → status: "ok"|"error" — result shown
 */

import { memo, useState, useCallback } from "react";
import type { ToolCall } from "@/services/ws-stream-manager";
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FileText,
  Search,
  Edit3,
  Loader2,
  Check,
  X,
  Copy,
} from "lucide-react";

// ─── Tool Icons ─────────────────────────────────────────────────────

const TOOL_ICONS: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  bash: Terminal,
  read: FileText,
  read_file: FileText,
  write: Edit3,
  write_file: Edit3,
  edit: Edit3,
  edit_file: Edit3,
  glob: Search,
  grep: Search,
  search: Search,
};

function getToolIcon(name: string) {
  if (TOOL_ICONS[name]) return TOOL_ICONS[name];
  for (const [key, Icon] of Object.entries(TOOL_ICONS)) {
    if (name.toLowerCase().includes(key)) return Icon;
  }
  return Terminal;
}

// ─── Status Indicator ───────────────────────────────────────────────

function StatusIndicator({ status }: { status: ToolCall["status"] }) {
  switch (status) {
    case "pending":
      // Args still streaming — subtle pulse
      return (
        <span className="w-2 h-2 rounded-full bg-neon/50 animate-pulse" />
      );
    case "running":
      return <Loader2 size={14} className="text-neon animate-spin" />;
    case "ok":
      return <Check size={14} className="text-green-500" />;
    case "error":
      return <X size={14} className="text-red-500" />;
    default:
      return null;
  }
}

// ─── Streaming Args Preview ──────────────────────────────────────────
// Shown while phase=start, args are still arriving as raw JSON fragments

function StreamingArgsPreview({ buffer }: { buffer: string }) {
  if (!buffer) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-t-ghost font-mono">
        <Loader2 size={10} className="animate-spin" />
        <span>等待参数...</span>
      </div>
    );
  }
  return (
    <pre className="mt-2 p-2 bg-white/5 rounded text-xs text-t-dim font-mono overflow-x-auto max-h-[120px] overflow-y-auto">
      {buffer}
      <span className="inline-block w-[5px] h-[11px] bg-neon/60 ml-0.5 align-middle animate-pulse" />
    </pre>
  );
}

// ─── Parsed Arguments Display ────────────────────────────────────────
// Shown once phase=ready (arguments are a proper dict)

function ArgumentsBlock({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args);
  if (entries.length === 0) return null;

  return (
    <div className="mt-2 space-y-1 text-xs font-mono">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <span className="text-t-ghost shrink-0">{key}:</span>
          <span className="text-t-secondary truncate">
            {typeof value === "string"
              ? value.length > 100
                ? value.slice(0, 100) + "…"
                : value
              : JSON.stringify(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Result Display ─────────────────────────────────────────────────

function ResultBlock({
  result,
  error,
  status,
}: {
  result?: unknown;
  error?: string;
  status: ToolCall["status"];
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text =
      error ||
      (typeof result === "string" ? result : JSON.stringify(result, null, 2));
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result, error]);

  if (status === "pending" || status === "running") return null;

  if (status === "error" && error) {
    return (
      <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400 font-mono">
        {error}
      </div>
    );
  }

  if (result === undefined || result === null) return null;

  const resultText =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const isLong = resultText.length > 500;

  return (
    <div className="mt-2 relative group">
      <button
        onClick={handleCopy}
        className="absolute top-1 right-1 p-1 opacity-0 group-hover:opacity-100 transition-opacity bg-bg-primary/80 rounded"
        title="复制结果"
      >
        {copied ? (
          <Check size={12} className="text-green-500" />
        ) : (
          <Copy size={12} className="text-t-ghost" />
        )}
      </button>
      <pre
        className={`p-2 bg-white/5 rounded text-xs text-t-secondary font-mono overflow-x-auto ${
          isLong ? "max-h-[200px] overflow-y-auto" : ""
        }`}
      >
        {resultText}
      </pre>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

interface ToolCallCardV2Props {
  toolCall: ToolCall;
}

export const ToolCallCardV2 = memo(
  function ToolCallCardV2({ toolCall }: ToolCallCardV2Props) {
    const [expanded, setExpanded] = useState(false);

    const Icon = getToolIcon(toolCall.name);
    const isComplete = toolCall.status === "ok" || toolCall.status === "error";
    const isPending = toolCall.status === "pending";
    const isRunning = toolCall.status === "running";
    const hasArgs = Object.keys(toolCall.arguments).length > 0;

    // Auto-expand on error; keep collapsed otherwise unless user opened it
    const shouldAutoExpand = toolCall.status === "error" && !expanded;
    const isOpen = expanded || shouldAutoExpand;

    const toggleExpand = useCallback(() => setExpanded((p) => !p), []);

    return (
      <div
        className={`
          border rounded-lg overflow-hidden transition-colors
          ${toolCall.status === "error"
            ? "border-red-500/30 bg-red-500/5"
            : "border-border-subtle bg-panel"}
        `}
      >
        {/* Header */}
        <button
          onClick={toggleExpand}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
        >
          <span className="text-t-ghost">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>

          <Icon size={14} className="text-t-secondary shrink-0" />

          <span className="text-sm font-mono text-t-primary flex-1 truncate">
            {toolCall.name}
          </span>

          {/* Status label for pending/running */}
          {isPending && (
            <span className="text-[11px] text-t-ghost mr-1">准备中</span>
          )}
          {isRunning && (
            <span className="text-[11px] text-neon/70 mr-1">执行中</span>
          )}

          <StatusIndicator status={toolCall.status} />
        </button>

        {/* Expanded content */}
        {isOpen && (
          <div className="px-3 pb-3 border-t border-border-subtle">
            {/* While args are streaming (pending), show raw buffer */}
            {isPending && (
              <StreamingArgsPreview buffer={toolCall.argsBuffer} />
            )}

            {/* Once args are ready (running or complete), show parsed dict */}
            {!isPending && hasArgs && (
              <ArgumentsBlock args={toolCall.arguments} />
            )}

            {/* Executing indicator */}
            {isRunning && (
              <div className="mt-2 flex items-center gap-2 text-xs text-t-ghost">
                <Loader2 size={12} className="animate-spin" />
                <span>执行中...</span>
              </div>
            )}

            {/* Result */}
            {isComplete && (
              <ResultBlock
                result={toolCall.result}
                error={toolCall.error}
                status={toolCall.status}
              />
            )}
          </div>
        )}
      </div>
    );
  },
  // Custom memo comparator — re-render when any visible field changes
  (prev, next) =>
    prev.toolCall.status === next.toolCall.status &&
    prev.toolCall.argsBuffer === next.toolCall.argsBuffer &&
    prev.toolCall.arguments === next.toolCall.arguments &&
    prev.toolCall.result === next.toolCall.result &&
    prev.toolCall.error === next.toolCall.error,
);

// ─── Tool Call List ─────────────────────────────────────────────────

interface ToolCallListProps {
  toolCalls: ToolCall[];
}

export const ToolCallList = memo(function ToolCallList({
  toolCalls,
}: ToolCallListProps) {
  if (toolCalls.length === 0) return null;

  return (
    <div className="space-y-2">
      {toolCalls.map((tc) => (
        <ToolCallCardV2 key={tc.call_id} toolCall={tc} />
      ))}
    </div>
  );
});
