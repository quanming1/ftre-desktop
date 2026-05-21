/**
 * InlineToolCallCard — 工具调用卡片（嵌入 assistant 消息中）
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

// ─── 工具图标映射 ───────────────────────────────────────────────────

const TOOL_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  bash: Terminal, exec: Terminal,
  read: FileText, read_file: FileText, list_dir: FileText,
  write: Edit3, write_file: Edit3, edit: Edit3, edit_file: Edit3,
  glob: Search, grep: Search, search: Search, web_search: Search, web_fetch: Search,
};

function getToolIcon(name: string | undefined) {
  if (!name) return Terminal;
  if (TOOL_ICONS[name]) return TOOL_ICONS[name];
  for (const [key, Icon] of Object.entries(TOOL_ICONS)) {
    if (name.toLowerCase().includes(key)) return Icon;
  }
  return Terminal;
}

// ─── 状态指示器 ─────────────────────────────────────────────────────

function StatusIndicator({ status }: { status: ToolCall["status"] }) {
  switch (status) {
    case "pending":
      return <span className="w-2 h-2 rounded-full bg-neon/50 animate-pulse" />;
    case "running":
      return <Loader2 size={14} className="text-neon animate-spin" />;
    case "ok":
      return <Check size={14} className="text-green-600" />;
    case "error":
      return <X size={14} className="text-red-500" />;
    default:
      return <Check size={14} className="text-green-600" />;
  }
}

// ─── 主组件 ─────────────────────────────────────────────────────────

export const InlineToolCallCard = memo(
  function InlineToolCallCard({ toolCall }: { toolCall: ToolCall }) {
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);

    const Icon = getToolIcon(toolCall.name);
    const status = toolCall.status || "ok";
    const isError = status === "error";
    const isPending = status === "pending";
    const isRunning = status === "running";
    const isComplete = status === "ok" || status === "error";

    // 解析参数
    let parsedArgs: Record<string, unknown> = {};
    if (typeof toolCall.arguments === "string") {
      try { parsedArgs = JSON.parse(toolCall.arguments); } catch {
        if (toolCall.arguments && toolCall.arguments !== "{}") {
          parsedArgs = { _raw: toolCall.arguments };
        }
      }
    } else if (typeof toolCall.arguments === "object") {
      parsedArgs = toolCall.arguments as Record<string, unknown>;
    }

    const hasArgs = Object.keys(parsedArgs).length > 0;
    const hasResult = !!toolCall.result;

    const toggleExpand = useCallback(() => setExpanded((p) => !p), []);
    const handleCopy = useCallback(() => {
      if (!toolCall.result) return;
      navigator.clipboard.writeText(toolCall.result).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }, [toolCall.result]);

    // 错误时自动展开
    const isOpen = expanded || (isError && !expanded);

    return (
      <div className="w-full border border-border-subtle rounded-3xl overflow-hidden bg-panel">
        {/* 标题栏 */}
        <button
          onClick={toggleExpand}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-hover transition-colors"
        >
          <span className="text-t-dim">
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <Icon size={13} className="text-t-muted shrink-0" />
          <span className="text-[12px] font-mono text-t-primary flex-1 truncate">
            {toolCall.name ?? "unknown"}
          </span>
          {isPending && <span className="text-[11px] text-t-ghost">准备中</span>}
          {isRunning && <span className="text-[11px] text-neon/80">执行中</span>}
          <StatusIndicator status={status} />
        </button>

        {/* 展开内容 */}
        <div className={`grid transition-[grid-template-rows] duration-200 ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className="overflow-hidden">
            <div className="px-4 pb-4 pt-2 border-t border-border-subtle">

              {/* 等待参数 */}
              {isPending && !hasArgs && (
                <div className="flex items-center gap-2 text-[13px] text-t-dim font-mono">
                  <Loader2 size={12} className="animate-spin" />
                  <span>等待参数...</span>
                </div>
              )}

              {/* 参数列表 */}
              {hasArgs && (
                <div className="space-y-1.5">
                  {Object.entries(parsedArgs).map(([key, value]) => (
                    <div key={key} className="flex gap-2 text-[13px] font-mono leading-relaxed">
                      <span className="text-t-dim shrink-0 select-none">
                        {key === "_raw" ? "args" : key}:
                      </span>
                      <span className="text-t-primary break-all">
                        {typeof value === "string"
                          ? value.length > 200 ? value.slice(0, 200) + "…" : value
                          : JSON.stringify(value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* 执行中 */}
              {isRunning && (
                <div className="mt-3 flex items-center gap-2 text-[13px] text-t-dim">
                  <Loader2 size={13} className="animate-spin text-neon" />
                  <span>执行中...</span>
                </div>
              )}

              {/* 结果 */}
              {isComplete && hasResult && (
                <div className="mt-3 relative group">
                  <button
                    onClick={handleCopy}
                    className="absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-elevated hover:bg-hover"
                    title="复制结果"
                  >
                    {copied
                      ? <Check size={13} className="text-green-600" />
                      : <Copy size={13} className="text-t-dim" />
                    }
                  </button>
                  <pre className={`p-3 rounded-lg bg-base text-[13px] font-mono leading-relaxed overflow-x-auto ${
                    isError ? "text-red-500" : "text-t-secondary"
                  } ${toolCall.result!.length > 500 ? "max-h-[240px] overflow-y-auto" : ""}`}>
                    {toolCall.result}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.toolCall.id === next.toolCall.id &&
    prev.toolCall.status === next.toolCall.status &&
    prev.toolCall.arguments === next.toolCall.arguments &&
    prev.toolCall.result === next.toolCall.result,
);
