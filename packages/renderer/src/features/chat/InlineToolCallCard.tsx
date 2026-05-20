/**
 * InlineToolCallCard — Renders a tool call embedded in an assistant message.
 * Supports all states: pending, running, ok, error.
 */

import { memo, useState, useCallback } from "react";
import type { ToolCall } from "@/stores/chat";
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FileText,
  Search,
  Edit3,
  Check,
  X,
  Copy,
  Loader2,
} from "lucide-react";

const TOOL_ICONS: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  bash: Terminal,
  exec: Terminal,
  read: FileText,
  read_file: FileText,
  write: Edit3,
  write_file: Edit3,
  edit: Edit3,
  edit_file: Edit3,
  glob: Search,
  grep: Search,
  search: Search,
  web_search: Search,
  web_fetch: Search,
  list_dir: FileText,
};

function getToolIcon(name: string | undefined) {
  if (!name) return Terminal;
  if (TOOL_ICONS[name]) return TOOL_ICONS[name];
  for (const [key, Icon] of Object.entries(TOOL_ICONS)) {
    if (name.toLowerCase().includes(key)) return Icon;
  }
  return Terminal;
}

/** Status indicator for tool call state */
function StatusIndicator({ status }: { status: ToolCall["status"] }) {
  switch (status) {
    case "pending":
      return <span className="w-2 h-2 rounded-full bg-neon/50 animate-pulse" />;
    case "running":
      return <Loader2 size={14} className="text-neon animate-spin" />;
    case "ok":
      return <Check size={14} className="text-green-500" />;
    case "error":
      return <X size={14} className="text-red-500" />;
    default:
      return <Check size={14} className="text-green-500" />;
  }
}

interface Props {
  toolCall: ToolCall;
}

export const InlineToolCallCard = memo(
  function InlineToolCallCard({ toolCall }: Props) {
    const [expanded, setExpanded] = useState(false);
    const Icon = getToolIcon(toolCall.name);
    const status = toolCall.status || "ok";
    const isError = status === "error";
    const isPending = status === "pending";
    const isRunning = status === "running";
    const isComplete = status === "ok" || status === "error";

    // Parse arguments - could be string or object
    let parsedArgs: Record<string, unknown> = {};
    if (typeof toolCall.arguments === "string") {
      try {
        parsedArgs = JSON.parse(toolCall.arguments);
      } catch {
        // If not valid JSON, show raw string
        if (toolCall.arguments && toolCall.arguments !== "{}") {
          parsedArgs = { _raw: toolCall.arguments };
        }
      }
    } else if (typeof toolCall.arguments === "object") {
      parsedArgs = toolCall.arguments as Record<string, unknown>;
    }

    const hasArgs = Object.keys(parsedArgs).length > 0;
    const hasResult = !!toolCall.result;
    const [copied, setCopied] = useState(false);

    const toggleExpand = useCallback(() => setExpanded((p) => !p), []);

    const handleCopy = useCallback(() => {
      if (!toolCall.result) return;
      navigator.clipboard.writeText(toolCall.result).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }, [toolCall.result]);

    // Auto-expand on error
    const shouldAutoExpand = isError && !expanded;
    const isOpen = expanded || shouldAutoExpand;

    return (
      <div
        className={`border rounded-lg overflow-hidden transition-colors ${
          isError
            ? "border-red-500/30 bg-red-500/5"
            : "border-border-subtle bg-panel"
        }`}
      >
        <button
          onClick={toggleExpand}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
        >
          <span className="text-t-ghost">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <Icon size={14} className="text-t-secondary shrink-0" />
          <span className="text-sm font-mono text-t-primary flex-1 truncate">
            {toolCall.name ?? "unknown"}
          </span>

          {/* Status label for pending/running */}
          {isPending && (
            <span className="text-[11px] text-t-ghost mr-1">准备中</span>
          )}
          {isRunning && (
            <span className="text-[11px] text-neon/70 mr-1">执行中</span>
          )}

          <StatusIndicator status={status} />
        </button>

        {isOpen && (
          <div className="px-3 pb-3 border-t border-border-subtle">
            {/* Streaming args preview (pending state) */}
            {isPending && !hasArgs && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-t-ghost font-mono">
                <Loader2 size={10} className="animate-spin" />
                <span>等待参数...</span>
              </div>
            )}

            {/* Arguments */}
            {hasArgs && (
              <div className="mt-2 space-y-1 text-xs font-mono">
                {Object.entries(parsedArgs).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="text-t-ghost shrink-0">
                      {key === "_raw" ? "args" : key}:
                    </span>
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
            )}

            {/* Running indicator */}
            {isRunning && (
              <div className="mt-2 flex items-center gap-2 text-xs text-t-ghost">
                <Loader2 size={12} className="animate-spin" />
                <span>执行中...</span>
              </div>
            )}

            {/* Result */}
            {isComplete && hasResult && (
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
                  className={`p-2 bg-white/5 rounded text-xs font-mono overflow-x-auto ${
                    isError ? "text-red-400" : "text-t-secondary"
                  } ${
                    toolCall.result!.length > 500
                      ? "max-h-[200px] overflow-y-auto"
                      : ""
                  }`}
                >
                  {toolCall.result}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.toolCall.id === next.toolCall.id &&
    prev.toolCall.status === next.toolCall.status &&
    prev.toolCall.arguments === next.toolCall.arguments &&
    prev.toolCall.result === next.toolCall.result,
);
