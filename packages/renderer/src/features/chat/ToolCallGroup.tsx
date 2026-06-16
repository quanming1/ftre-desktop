import { memo, useMemo, useState } from "react";
import type { ToolCall } from "@/stores/chat";
import { ChevronRight } from "lucide-react";
import { InlineToolCallCard } from "./InlineToolCallCard";

const AUTO_COLLAPSE_THRESHOLD = 3;

function normalizeToolName(name: string): string {
  switch (name) {
    case "bash":
    case "exec":
    case "shell":
      return "bash";
    case "read":
    case "read_file":
      return "read";
    case "write":
    case "write_file":
      return "write";
    case "edit":
    case "edit_file":
      return "edit";
    default:
      return name || "unknown";
  }
}

function getToolDisplayName(name: string): string {
  switch (name) {
    case "bash":
      return "执行命令";
    case "read":
      return "读取文件";
    case "write":
      return "写入文件";
    case "edit":
      return "编辑文件";
    case "set_workspace":
      return "切换工作区";
    case "loadSkill":
      return "加载 Skill";
    case "task":
      return "派发任务";
    case "send_message":
      return "发送消息";
    case "cron":
      return "计划任务";
    default:
      return name || "unknown";
  }
}

export const ToolCallGroup = memo(function ToolCallGroup({
  toolCalls,
}: {
  toolCalls: ToolCall[];
}) {
  const [expanded, setExpanded] = useState(false);

  const runningTools = toolCalls.filter(
    (toolCall) => toolCall.status === "pending" || toolCall.status === "running",
  );
  const completedTools = toolCalls.filter(
    (toolCall) => toolCall.status !== "pending" && toolCall.status !== "running",
  );

  const failedCount = completedTools.filter((toolCall) => toolCall.status === "error").length;

  const completedSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const toolCall of completedTools) {
      const label = normalizeToolName(toolCall.name);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, count]) => `${getToolDisplayName(label)} ${count} 次`)
      .join(" · ");
  }, [completedTools]);

  const hasRunning = runningTools.length > 0;
  const shouldCollapseCompleted = completedTools.length >= AUTO_COLLAPSE_THRESHOLD;

  if (!shouldCollapseCompleted && !hasRunning) {
    return (
      <div className="space-y-0.5">
        {toolCalls.map((toolCall) => (
          <InlineToolCallCard key={toolCall.id} toolCall={toolCall} />
        ))}
      </div>
    );
  }

  if (!shouldCollapseCompleted && hasRunning) {
    return (
      <div className="space-y-0.5">
        {toolCalls.map((toolCall) => (
          <InlineToolCallCard key={toolCall.id} toolCall={toolCall} />
        ))}
      </div>
    );
  }

  return (
    <div className="py-0.5">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group flex w-full items-center px-1.5 py-1 text-left transition-colors"
      >
        <span className="min-w-0 flex flex-1 items-center gap-1.5 text-[13px] leading-5 text-t-faint">
          <span className="shrink-0 font-medium text-t-dim">已进行 {completedTools.length} 次工具调用</span>
          <span className="min-w-0 truncate text-[13px] text-t-faint/90">{completedSummary}</span>
          <span className="shrink-0 text-t-faint">
            <ChevronRight
              size={13}
              className={`transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
            />
          </span>
          {failedCount > 0 && (
            <span className="shrink-0 rounded-full bg-danger/8 px-1.5 py-[1px] text-[10px] text-danger/80">
              {failedCount} 次失败
            </span>
          )}
        </span>
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0.92,
        }}
      >
        <div className="overflow-hidden">
          <div className="ml-3.5 mt-1 border-l border-border-subtle/70 pl-3 space-y-0.5">
            {completedTools.map((toolCall) => (
              <InlineToolCallCard key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        </div>
      </div>

      {hasRunning && <RunningToolsTree runningTools={runningTools} withTopConnector />}
    </div>
  );
});

function RunningToolsTree({
  runningTools,
  withTopConnector = false,
}: {
  runningTools: ToolCall[];
  withTopConnector?: boolean;
}) {
  return (
    <div className="mt-0.5">
      {withTopConnector ? <div className="ml-[18px] h-3 w-px bg-border-subtle/70" /> : null}
      {runningTools.map((toolCall) => (
        <div key={toolCall.id} className="relative pl-8">
          <span className="pointer-events-none absolute left-[18px] top-0 h-full w-px bg-border-subtle/70" />
          <span className="pointer-events-none absolute left-[18px] top-[14px] h-px w-3 bg-border-subtle/70" />
          <InlineToolCallCard toolCall={toolCall} />
        </div>
      ))}
    </div>
  );
}
