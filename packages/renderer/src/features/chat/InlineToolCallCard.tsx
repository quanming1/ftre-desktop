/**
 * InlineToolCallCard — Renders a tool call from history messages.
 * Simpler than ToolCallCardV2 (no streaming states, just completed results).
 */

import { memo, useState, useCallback } from "react";
import type { InlineToolCall } from "@/services/ws-stream-manager";
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
} from "lucide-react";

const TOOL_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  bash: Terminal, exec: Terminal,
  read: FileText, read_file: FileText,
  write: Edit3, write_file: Edit3, edit: Edit3, edit_file: Edit3,
  glob: Search, grep: Search, search: Search, web_search: Search,
  list_dir: FileText,
};

function getToolIcon(name: string) {
  if (TOOL_ICONS[name]) return TOOL_ICONS[name];
  for (const [key, Icon] of Object.entries(TOOL_ICONS)) {
    if (name.toLowerCase().includes(key)) return Icon;
  }
  return Terminal;
}

interface Props {
  toolCall: InlineToolCall;
}

export const InlineToolCallCard = memo(function InlineToolCallCard({ toolCall }: Props) {
  const [expanded, setExpanded] = useState(false);
  const Icon = getToolIcon(toolCall.name);
  const isError = toolCall.status === "error";
  const hasArgs = Object.keys(toolCall.arguments).length > 0;
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

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-colors ${
        isError ? "border-red-500/30 bg-red-500/5" : "border-border-subtle bg-panel"
      }`}
    >
      <button
        onClick={toggleExpand}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-t-ghost">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <Icon size={14} className="text-t-secondary shrink-0" />
        <span className="text-sm font-mono text-t-primary flex-1 truncate">
          {toolCall.name}
        </span>
        {isError ? (
          <X size={14} className="text-red-500" />
        ) : (
          <Check size={14} className="text-green-500" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-border-subtle">
          {/* Arguments */}
          {hasArgs && (
            <div className="mt-2 space-y-1 text-xs font-mono">
              {Object.entries(toolCall.arguments).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <span className="text-t-ghost shrink-0">{key}:</span>
                  <span className="text-t-secondary truncate">
                    {typeof value === "string"
                      ? value.length > 100 ? value.slice(0, 100) + "…" : value
                      : JSON.stringify(value)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Result */}
          {hasResult && (
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
                  toolCall.result!.length > 500 ? "max-h-[200px] overflow-y-auto" : ""
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
});
