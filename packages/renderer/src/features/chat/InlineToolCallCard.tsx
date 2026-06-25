/**
 * InlineToolCallCard — Codex-style inline tool event
 *
 * 不是卡片，是消息流里的一行 timeline 事件：
 *   "Ran git status for 2s"
 *   "Read src/main.py (30 lines)"
 *   "Wrote output.txt"
 *
 * 点击展开看详情（命令输出 / 文件内容），默认折叠成一行。
 * 视觉上跟正文段落平级，不用边框/圆角/背景色包裹。
 */
import { memo, useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { ToolCall } from "@/stores/chat";
import hljs from "highlight.js/lib/common";
import {
  ChevronRight,
  Folder,
  Brain,
  Clock,
  Loader2,
  Check,
  X,
  Copy,
  Box,
} from "lucide-react";
import { Tooltip, TooltipProvider } from "@ftre/ui";

// ─── 摘要生成（一行描述） ───────────────────────────────────────────

/**
 * 用 "Verb target" 的句式描述这次工具调用，方便用户一眼看出"做了什么"。
 * Verb 用英文动词（参考 Codex 风格），target 是关键参数：
 *   Ran <command>          / 执行命令
 *   Read <file> [Lx-y]     / 读文件
 *   Wrote <file> (N lines) / 写文件
 *   Edited <file>          / 编辑文件
 *   Listed <dir>           / 列目录
 *   cd <dir>               / 切换工作区（动作语义就是 cd）
 *   Cron <action> "<title>"
 *   Task: <prompt head>
 *   Sent → <channel>
 *
 * status 决定动词时态：
 *   - pending/running → "...ing"
 *   - ok/error        → 过去式（哪怕错误也是"已经尝试过"，不能再回到 ing）
 */
function buildSummary(
  name: string | undefined,
  args: Record<string, unknown>,
  status: ToolCall["status"],
): string {
  const n = name ?? "unknown";
  // 完成态（含失败）一律给过去式 fallback，避免错误时摘要还停在 "...ing"
  const isDone = status === "ok" || status === "error";

  switch (n) {
    case "think":
      // think 走单独 inline 块，不会用到这条摘要
      return isDone ? "Thought" : "Thinking...";
    case "bash":
    case "exec":
    case "shell": {
      const rawCmd = args.command;
      const cmd = typeof rawCmd === "string" ? rawCmd : "";
      const oneLine = cmd.replace(/\s+/g, " ").trim();
      const display = oneLine.length > 70 ? oneLine.slice(0, 70) + "…" : oneLine;
      if (display) return `Ran ${display}`;
      return isDone ? "Ran command" : "Running...";
    }
    case "read":
    case "read_file": {
      const path = (args.path as string) ?? "";
      const file = basename(path);
      const start = args.start_line as number | undefined;
      const end = args.end_line as number | undefined;
      const range = start || end ? ` L${start || 1}-${end || "end"}` : "";
      if (file) return `Read ${file}${range}`;
      return isDone ? "Read" : "Reading...";
    }
    case "list_dir": {
      const path = (args.path as string) ?? "";
      if (path) return `Listed ${basename(path) || path}`;
      return isDone ? "Listed" : "Listing...";
    }
    case "write":
    case "write_file": {
      const path = (args.path as string) ?? "";
      const file = basename(path);
      const content = args.content as string | undefined;
      const lines = content ? content.split("\n").length : 0;
      const suffix = lines > 0 ? ` (${lines} lines)` : "";
      if (file) return `Wrote ${file}${suffix}`;
      return isDone ? "Wrote" : "Writing...";
    }
    case "edit":
    case "edit_file": {
      const path = (args.path as string) ?? "";
      const file = basename(path);
      if (file) return `Edited ${file}`;
      return isDone ? "Edited" : "Editing...";
    }
    case "set_workspace": {
      const path = (args.path as string) ?? "";
      const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
      const tail = parts.slice(-2).join("/");
      if (tail) return `cd ${tail}`;
      return isDone ? "set_workspace" : "切换工作区";
    }
    case "cron": {
      const action = (args.action as string) ?? "";
      const title = (args.title as string) ?? "";
      const jobId = (args.job_id as string) ?? "";
      switch (action) {
        case "create":
          return title ? `Cron · created "${title}"` : "Cron · create";
        case "list":
          return "Cron · list";
        case "delete":
          return jobId ? `Cron · deleted ${jobId}` : "Cron · delete";
        case "update":
          return jobId ? `Cron · updated ${jobId}` : "Cron · update";
        default:
          return action ? `Cron · ${action}` : "Cron";
      }
    }
    case "task": {
      const prompt = (args.prompt as string) ?? "";
      const sid = (args.session_id as string) ?? "";
      const short = prompt.split("\n")[0]?.slice(0, 50) ?? "";
      const head = short ? `Task · ${short}${prompt.length > 50 ? "…" : ""}` : "Task · 派发";
      return sid ? `${head} (resume)` : head;
    }
    case "send_message": {
      const ch = (args.channel_id as string) ?? "";
      const sid = (args.session_id as string) ?? "";
      if (ch && sid) return `Sent → ${ch}:${sid.slice(0, 8)}`;
      if (ch) return `Sent → ${ch}`;
      return isDone ? "Sent" : "Sending...";
    }
    case "loadSkill": {
      const skill = (args.skill as string) ?? "";
      if (skill) {
        return isDone ? `Loaded Skill «${skill}»` : `Loading Skill «${skill}»…`;
      }
      return isDone ? "Loaded Skill" : "Loading Skill…";
    }
    default:
      // 未知/插件工具：原样显示工具名
      return n;
  }
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

// ─── 参数解析 ───────────────────────────────────────────────────────

function parseArgs(raw: ToolCall["arguments"]): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    if (!raw.trim() || raw === "{}") return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch { /* streaming partial JSON */ }
  }
  return {};
}

// ─── 摘要行渲染：动词加粗一档（只对第一个 token 加权重） ──────────

const VERB_PATTERN = /^(Ran|Read|Wrote|Edited|Listed|Sent|Cron|Task|cd)\b/;

function SummaryLine({ summary, className = "" }: { summary: string; className?: string }) {
  const m = summary.match(VERB_PATTERN);
  if (!m) {
    return (
      <span className={`text-[13px] font-mono text-t-dim group-hover:text-t-secondary transition-colors truncate ${className}`}>
        {summary}
      </span>
    );
  }
  const verb = m[0];
  const rest = summary.slice(verb.length);
  return (
    <span className={`text-[13px] font-mono truncate ${className}`}>
      <span className="text-t-secondary font-medium">{verb}</span>
      <span className="text-t-dim group-hover:text-t-secondary transition-colors">{rest}</span>
    </span>
  );
}

// ─── think 块（独立渲染） ────────────────────────────────────────────

function ThinkBlock({
  thought,
  isPending,
  isRunning,
  expanded,
  onToggle,
}: {
  thought: string;
  isPending: boolean;
  isRunning: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);

  // 测量内容高度判断是否需要"显示更多"按钮
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight > 120 + 4);
  }, [thought]);

  return (
    <div className="flex gap-2 py-1">
      <Brain size={14} className="text-t-ghost shrink-0 mt-0.5" strokeWidth={1.5} />
      <div className="flex-1 min-w-0">
        <div
          className={`relative ${expanded ? "max-h-[480px] overflow-y-auto" : "max-h-[120px] overflow-hidden"} transition-all duration-200 ease-out`}
        >
          <div
            ref={contentRef}
            className="text-[13px] text-t-dim italic leading-relaxed whitespace-pre-wrap break-words"
          >
            {thought || (isPending ? "..." : "")}
            {isRunning && (
              <span className="inline-block w-1.5 h-3 ml-1 align-middle bg-t-ghost/60 animate-pulse" />
            )}
          </div>
        </div>
        {overflows && (
          <button
            type="button"
            onClick={onToggle}
            className="mt-1 text-[11px] text-t-ghost hover:text-neon transition-colors"
          >
            {expanded ? "收起" : "显示更多"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── ArgsView：展示完整入参（带 JSON 语法高亮） ─────────────────────

/** 将参数对象格式化为缩进 JSON，大字符串截断 */
function formatArgs(args: Record<string, unknown>): string {
  const truncated: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > 2000) {
      truncated[k] = v.slice(0, 2000) + `\n… [${v.length} chars total]`;
    } else if (typeof v === "string" && v.includes("\n")) {
      const lines = v.split("\n");
      if (lines.length > 50) {
        truncated[k] = lines.slice(0, 50).join("\n") + `\n… [${lines.length} lines total]`;
      } else {
        truncated[k] = v;
      }
    } else {
      truncated[k] = v;
    }
  }
  return JSON.stringify(truncated, null, 2);
}

function ArgsView({ args, toolName }: { args: Record<string, unknown>; toolName?: string }) {
  const highlightedHtml = useMemo(() => {
    const formatted = formatArgs(args);
    try {
      return hljs.highlight(formatted, { language: "json" }).value;
    } catch {
      return null;
    }
  }, [args]);

  const isEmpty = Object.keys(args).length === 0;
  if (isEmpty) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[12px] font-mono tracking-wider text-t-ghost">
        <span>Arguments</span>
      </div>
      <pre className="tool-highlight text-[13px] font-mono leading-relaxed text-t-secondary whitespace-pre-wrap break-words overflow-x-auto max-h-[200px] overflow-y-auto">
        {highlightedHtml ? (
          <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        ) : (
          <code>{formatArgs(args)}</code>
        )}
      </pre>
    </div>
  );
}

// ─── 主组件 ─────────────────────────────────────────────────────────

export const InlineToolCallCard = memo(
  function InlineToolCallCard({ toolCall }: { toolCall: ToolCall }) {
    const isLoadSkill = toolCall.name === "loadSkill";
    const isSetWorkspace = toolCall.name === "set_workspace";
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);

    const status = toolCall.status || "ok";
    const isPending = status === "pending";
    const isRunning = status === "running";
    const isError = status === "error";
    const isComplete = status === "ok" || status === "error";

    const args = parseArgs(toolCall.arguments);
    const summary = buildSummary(toolCall.name, args, status);
    const hasResult = !!toolCall.result;
    const hasArgs = Object.keys(args).length > 0;
    const isThink = toolCall.name === "think";

    // think 工具：直接展示 thought 内容；点击切换展开/折叠
    if (isThink) {
      const thought = (args.thought as string) ?? toolCall.result ?? "";
      return (
        <ThinkBlock
          thought={thought}
          isPending={isPending}
          isRunning={isRunning}
          expanded={expanded}
          onToggle={() => setExpanded((p) => !p)}
        />
      );
    }

    const toggleExpand = useCallback(() => {
      if (hasResult || isError || hasArgs) setExpanded((p) => !p);
    }, [hasResult, isError, hasArgs]);

    // loadSkill: 从 result 提取 name + description 用于 tooltip
    const loadSkillMeta = useMemo(() => {
      if (!isLoadSkill || !toolCall.result) return { name: "", description: "" };
      const { name, description } = parseSkillContent(toolCall.result);
      // 把多行描述压成一行，避免 tooltip 里出现 \n 视觉断行
      const desc = (description || "").replace(/\s+/g, " ").trim();
      return {
        name: name || (args.skill as string) || "",
        description: desc,
      };
    }, [isLoadSkill, toolCall.result, args.skill]);

    // loadSkill：仅显示一行 title，hover 展示 skill 描述
    if (isLoadSkill) {
      return (
        <TooltipProvider>
          <Tooltip
            content={
              <div className="flex flex-col gap-1.5 max-w-[320px]">
                {/* Skill name */}
                <div className="flex items-center gap-1.5">
                  <Box size={12} strokeWidth={2} className="text-[#1a7f37] shrink-0" />
                  <span className="text-[13px] font-semibold text-[#1a7f37]">
                    {loadSkillMeta.name || (args.skill as string) || ""}
                  </span>
                </div>
                {/* Description */}
                {loadSkillMeta.description && (
                  <p className="text-[12px] text-t-secondary leading-relaxed">
                    {loadSkillMeta.description}
                  </p>
                )}
              </div>
            }
            side="top"
            sideOffset={4}
            className="max-w-[360px]"
          >
            <div className="inline-flex items-center gap-2 py-1 cursor-default">
              <Box size={14} className="text-[#1a7f37] shrink-0" strokeWidth={1.5} />
              <span className="text-[13px] font-mono text-t-dim truncate">
                <span className="text-t-secondary font-medium">Loaded Skill</span>
                {args.skill ? ` «${args.skill}»` : ""}
              </span>
              {status === "ok" && <Check size={12} className="text-green-600 shrink-0" />}
              {isError && <X size={12} className="text-red-500 shrink-0" />}
            </div>
          </Tooltip>
        </TooltipProvider>
      );
    }

    // set_workspace：仅显示一行，hover 展示完整路径
    if (isSetWorkspace) {
      const wsPath = (args.path as string) || "";
      // 从 tool result 解析路径变更信息
      const resultText = toolCall.result ?? "";
      const switched = resultText.match(/工作区已切换:\s*(.+?)\s*→\s*(.+)/);
      const changed = resultText.match(/工作区已变更:\s*(.+)/);
      const unchanged = resultText.match(/工作区未变化:\s*(.+)/);
      const fromPath = switched?.[1]?.trim();
      const toPath = switched?.[2]?.trim() || changed?.[1]?.trim() || wsPath;
      const displayPath = toPath || wsPath;

      return (
        <TooltipProvider>
          <Tooltip
            content={
              <div className="flex flex-col gap-1">
                {fromPath && (
                  <div className="text-[12px] text-t-ghost">
                    从 <span className="text-t-dim font-mono">{fromPath}</span>
                  </div>
                )}
                <div className="text-[12px] text-t-secondary">
                  {fromPath ? "到" : unchanged ? "未变化" : "切换到"}{" "}
                  <span className="text-t-primary font-mono">{toPath}</span>
                </div>
              </div>
            }
            side="top"
            sideOffset={4}
          >
            <div className="inline-flex items-center gap-2 py-1 cursor-default">
              <Folder size={14} className="text-[#0969da] shrink-0" strokeWidth={1.5} />
              <span className="text-[13px] font-mono text-t-dim truncate max-w-[400px]">
                <span className="text-t-secondary font-medium">set_workspace</span>
                {displayPath ? ` ${displayPath}` : ""}
              </span>
              {status === "ok" && <Check size={12} className="text-green-600 shrink-0" />}
              {isError && <X size={12} className="text-red-500 shrink-0" />}
            </div>
          </Tooltip>
        </TooltipProvider>
      );
    }

    const handleCopy = useCallback(() => {
      if (!toolCall.result) return;
      navigator.clipboard.writeText(toolCall.result).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }, [toolCall.result]);

    return (
      <div className="py-0.5">
        {/* 摘要行 */}
        <button
          onClick={toggleExpand}
          disabled={!hasResult && !isError && !hasArgs}
          className="flex items-center gap-2 text-left w-full group py-1 disabled:cursor-default"
        >
          {/* 展开箭头（有结果或有入参时才显示） */}
          {hasResult || isError || hasArgs ? (
            <span className="text-t-ghost shrink-0 w-3.5">
              <ChevronRight size={13} className={`transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
            </span>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}

          {/* 摘要 */}
          <SummaryLine summary={summary} className="flex-1" />

          {/* 状态 */}
          {isPending && <Loader2 size={12} className="text-t-ghost animate-spin shrink-0" />}
          {isRunning && <Loader2 size={12} className="text-neon animate-spin shrink-0" />}
          {status === "ok" && <Check size={12} className="text-green-600 shrink-0" />}
          {isError && <X size={12} className="text-red-500 shrink-0" />}
        </button>

        {/* 展开详情：上面完整入参，下面完整出参 */}
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div className="ml-[22px] mt-1 mb-2 space-y-3 rounded-xl p-3 bg-[#f6f7f9] dark:bg-white/[0.03]">
              {/* 入参区域 */}
              <ArgsView args={args} toolName={toolCall.name} />

              {/* 出参区域（如果有结果） */}
              {toolCall.result && (
                <div className="space-y-1 relative group/result">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[12px] font-mono tracking-wider text-t-ghost">
                      <span>Result</span>
                      {isError && <span className="text-red-500/70">· Error</span>}
                    </div>
                    <button
                      onClick={handleCopy}
                      className="p-1 rounded opacity-0 group-hover/result:opacity-100 transition-opacity bg-elevated hover:bg-hover"
                      title="复制结果"
                    >
                      {copied
                        ? <Check size={11} className="text-green-600" />
                        : <Copy size={11} className="text-t-dim" />}
                    </button>
                  </div>
                  <ExpandedDetail
                    toolCall={toolCall}
                    args={args}
                    isError={isError}
                  />
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

// ─── 展开详情：按工具类型分发 ──────────────────────────────────────

interface DetailProps {
  toolCall: ToolCall;
  args: Record<string, unknown>;
  isError: boolean;
}

function ExpandedDetail({ toolCall, args, isError }: DetailProps) {
  const name = toolCall.name;
  const result = toolCall.result ?? "";

  if (name === "loadSkill") {
    return <LoadSkillDetail result={result} isError={isError} />;
  }
  if (name === "bash" || name === "exec" || name === "shell") {
    return <BashDetail result={result} isError={isError} />;
  }
  if (name === "edit" || name === "edit_file") {
    return <EditDetail args={args} result={result} isError={isError} />;
  }
  if (name === "cron" && (args.action as string) === "list") {
    return <CronListDetail result={result} isError={isError} />;
  }
  if (name === "task") {
    return <TaskDetail result={result} isError={isError} />;
  }
  return <RawPre result={result} isError={isError} />;
}

/** loadSkill 工具结果 → 提取 frontmatter 并渲染为参考卡片 */
function LoadSkillDetail({ result, isError }: { result: string; isError: boolean }) {
  const { name, description, body } = useMemo(() => parseSkillContent(result), [result]);

  if (isError) return <RawPre result={result} isError />;
  return (
    <div className="space-y-2 animate-in fade-in duration-150">
      {/* Header: skill name + description from frontmatter */}
      {name && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1a7f37]">
            <Box size={14} strokeWidth={2} />
            {name}
          </span>
        </div>
      )}
      {description && (
        <p className="text-[13px] text-t-secondary leading-relaxed line-clamp-2">{description}</p>
      )}
      {/* Body: raw markdown content, collapsed if huge */}
      <div className="relative">
        <pre className="py-2 text-[13px] font-mono leading-relaxed text-t-secondary whitespace-pre-wrap break-words overflow-x-auto max-h-[320px] overflow-y-auto">
          {body}
        </pre>
      </div>
    </div>
  );
}

/** 从 Skill 正文中提取 frontmatter 的 name / description 和纯正文 */
function parseSkillContent(text: string): { name: string; description: string; body: string } {
  let name = "";
  let description = "";
  let body = text.trim();

  if (text.startsWith("---")) {
    const end = text.indexOf("---", 3);
    if (end > 0) {
      const fm = text.slice(3, end);
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      if (nameMatch) name = nameMatch[1].trim().replace(/['"]/g, "");

      const fmLines = fm.split("\n");
      for (let i = 0; i < fmLines.length; i++) {
        const line = fmLines[i];
        const m = line.match(/^description:\s*(.*)$/);
        if (!m) continue;
        const raw = m[1].trim();
        // YAML 块标量：description: | 或 > 或 |- ...
        if (/^[|>][-+]?$/.test(raw)) {
          const indent = (fmLines[i + 1]?.match(/^\s+/)?.[0] || "  ").length;
          const block: string[] = [];
          for (let j = i + 1; j < fmLines.length; j++) {
            const ln = fmLines[j];
            if (!ln.trim()) { block.push(""); continue; }
            if ((ln.match(/^\s+/)?.[0]?.length ?? 0) < indent) break;
            block.push(ln.slice(indent));
          }
          description = block.join(" ").replace(/\s+/g, " ").trim();
        } else {
          description = raw.replace(/^['"]|['"]$/g, "");
        }
        break;
      }
      body = text.slice(end + 3).trim();
    }
  }
  return { name, description, body };
}

/** 通用：原始文本 */
function RawPre({ result, isError }: { result: string; isError: boolean }) {
  return (
    <pre
      className={`py-2 text-[13px] font-mono leading-relaxed overflow-x-auto ${
        isError ? "text-red-500" : "text-t-secondary"
      } ${result.length > 500 ? "max-h-[240px] overflow-y-auto" : ""}`}
    >
      {result}
    </pre>
  );
}

// ─── bash detail ────────────────────────────────────────────────────

interface ParsedBash {
  cwd?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  raw?: string;
}

/** 解析 bash 工具的输出协议：[cwd] / [stderr] / [exit_code] */
function parseBashResult(text: string): ParsedBash {
  if (!text.startsWith("[cwd]")) return { raw: text };
  const lines = text.split("\n");
  const out: ParsedBash = {};
  let i = 0;

  if (lines[i]?.startsWith("[cwd]")) {
    out.cwd = lines[i].slice(5).trim();
    i++;
  }
  const stdoutLines: string[] = [];
  while (
    i < lines.length &&
    !lines[i].startsWith("[stderr]") &&
    !lines[i].startsWith("[exit_code]")
  ) {
    stdoutLines.push(lines[i]);
    i++;
  }
  if (stdoutLines.length) out.stdout = stdoutLines.join("\n").replace(/\n+$/, "");

  if (lines[i]?.startsWith("[stderr]")) {
    i++;
    const stderrLines: string[] = [];
    while (i < lines.length && !lines[i].startsWith("[exit_code]")) {
      stderrLines.push(lines[i]);
      i++;
    }
    out.stderr = stderrLines.join("\n").replace(/\n+$/, "");
  }
  if (lines[i]?.startsWith("[exit_code]")) {
    const m = lines[i].match(/\[exit_code\]\s*(-?\d+)/);
    if (m) out.exitCode = Number(m[1]);
  }
  return out;
}

function BashDetail({ result, isError }: { result: string; isError: boolean }) {
  const p = parseBashResult(result);
  if (p.raw !== undefined) return <RawPre result={p.raw} isError={isError} />;

  return (
    <div className="space-y-2">
      {p.cwd && (
        <div className="text-[12px] font-mono text-t-ghost">
          cwd: <span className="text-t-secondary">{p.cwd}</span>
        </div>
      )}
      {p.stdout && (
        <pre className="text-[13px] font-mono leading-relaxed text-t-secondary whitespace-pre-wrap break-words overflow-x-auto max-h-[240px] overflow-y-auto">
          {p.stdout}
        </pre>
      )}
      {p.stderr && (
        <div className="space-y-0.5">
          <div className="text-[12px] font-mono tracking-wide text-amber-600">
            Stderr
          </div>
          <pre className="text-[13px] font-mono leading-relaxed text-amber-700 dark:text-amber-400 whitespace-pre-wrap break-words overflow-x-auto max-h-[200px] overflow-y-auto">
            {p.stderr}
          </pre>
        </div>
      )}
      {p.exitCode !== undefined && p.exitCode !== 0 && (
        <div className="text-[12px] font-mono text-red-500">
          exit code: {p.exitCode}
        </div>
      )}
      {!p.stdout && !p.stderr && p.exitCode === 0 && (
        <div className="text-[12px] italic text-t-ghost">
          (没有输出，进程正常退出)
        </div>
      )}
    </div>
  );
}

// ─── edit detail ────────────────────────────────────────────────────

function EditDetail({
  args,
  result,
  isError,
}: {
  args: Record<string, unknown>;
  result: string;
  isError: boolean;
}) {
  const oldStr = args.old_str as string | undefined;
  const newStr = args.new_str as string | undefined;
  const hasDiff = oldStr !== undefined || newStr !== undefined;

  if (!hasDiff) return <RawPre result={result} isError={isError} />;

  return (
    <div className="space-y-2">
      {oldStr && <DiffSide kind="old" text={oldStr} />}
      {newStr && <DiffSide kind="new" text={newStr} />}
      {result && (
        <div
          className={`text-[12px] font-mono ${
            isError ? "text-red-500" : "text-t-ghost"
          }`}
        >
          {result}
        </div>
      )}
    </div>
  );
}

function DiffSide({ kind, text }: { kind: "old" | "new"; text: string }) {
  const isOld = kind === "old";
  const sign = isOld ? "-" : "+";
  const colorClass = isOld
    ? "bg-red-500/[0.06] text-red-700 dark:text-red-300"
    : "bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300";

  return (
    <div className={`flex gap-2 px-2 py-1.5 rounded ${colorClass} font-mono text-[13px] leading-relaxed max-h-[200px] overflow-y-auto`}>
      <span className="shrink-0 opacity-60 select-none">{sign}</span>
      <pre className="flex-1 whitespace-pre-wrap break-words m-0">{text}</pre>
    </div>
  );
}

// ─── cron list detail ──────────────────────────────────────────────

interface CronJobRow {
  id: string;
  enabled: boolean;
  cron: string;
  title: string;
  prompt: string;
  lastRun: string;
  runCount: number;
}

/**
 * 解析 cron 工具 list action 的 result。后端格式：
 *   - <id> | [启用]/[已禁用] | <cron expr> | <title>
 *     prompt: <prompt>...
 *     上次运行: <ts> | 累计运行: <n> 次
 */
function parseCronList(text: string): CronJobRow[] {
  const lines = text.split("\n");
  const jobs: CronJobRow[] = [];
  let cur: Partial<CronJobRow> | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("- ")) {
      if (cur && cur.id) jobs.push(cur as CronJobRow);
      const parts = line.slice(2).split(" | ");
      cur = {
        id: parts[0] || "",
        enabled: !(parts[1] || "").includes("已禁用"),
        cron: parts[2] || "",
        title: parts[3] || "",
        prompt: "",
        lastRun: "",
        runCount: 0,
      };
    } else if (cur && /^\s*prompt:/.test(line)) {
      cur.prompt = line.replace(/^\s*prompt:\s*/, "").trim();
    } else if (cur && /上次运行:/.test(line)) {
      const m = line.match(/上次运行:\s*(.+?)\s*\|\s*累计运行:\s*(\d+)/);
      if (m) {
        cur.lastRun = m[1].trim();
        cur.runCount = Number(m[2]);
      }
    }
  }
  if (cur && cur.id) jobs.push(cur as CronJobRow);
  return jobs;
}

/** 把 cron 翻译成简短中文描述 */
function translateCron(expr: string): string {
  const segs = expr.trim().split(/\s+/);
  if (segs.length !== 5) return expr;
  const [min, hour, day, month, week] = segs;

  if (day === "*" && month === "*" && week === "*") {
    if (min.startsWith("*/") && hour === "*") return `每${min.slice(2)}分钟`;
    if (hour.startsWith("*/") && min === "0") return `每${hour.slice(2)}小时`;
    if (hour !== "*" && min !== "*") return `每天 ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
    if (hour !== "*") return `每天 ${hour.padStart(2, "0")}:00`;
    if (min !== "*") return `每小时第${min}分`;
  }

  if (day === "*" && month === "*" && week !== "*") {
    const weekNames = ["日", "一", "二", "三", "四", "五", "六"];
    const w = weekNames[parseInt(week) % 7] || week;
    if (hour !== "*" && min !== "*") return `每周${w} ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
    return `每周${w}`;
  }

  if (day !== "*" && month === "*" && week === "*") {
    if (hour !== "*" && min !== "*") return `每月${day}日 ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
    return `每月${day}日`;
  }

  return expr;
}

/** 单个 Cron Job 卡片 —— 点击展开看详情 */
function CronJobCard({
  job,
  defaultExpanded,
}: {
  job: CronJobRow;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const cronLabel = translateCron(job.cron);

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      className={`group rounded-xl border transition-all duration-200 cursor-pointer select-none ${
        job.enabled
          ? "border-emerald-500/20 bg-emerald-500/[0.03] hover:border-emerald-500/35 hover:bg-emerald-500/[0.06]"
          : "border-border/20 bg-elevated/20 hover:border-border/35 hover:bg-elevated/40"
      }`}
    >
      {/* Header：始终可见 */}
      <div className="px-4 py-3 flex items-center gap-3 min-w-0">
        {/* 状态指示灯 */}
        <span
          className={`shrink-0 w-2 h-2 rounded-full ${
            job.enabled
              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]"
              : "bg-t-ghost"
          }`}
        />

        {/* 标题 + cron */}
        <div className="flex-1 min-w-0">
          <h4
            className={`text-[13px] font-semibold truncate ${
              job.enabled ? "text-t-primary" : "text-t-muted"
            }`}
          >
            {job.title}
          </h4>
          <p className="text-[12px] font-mono text-t-secondary mt-0.5 truncate">
            {cronLabel}
            {cronLabel !== job.cron && (
              <span className="text-t-ghost ml-1.5">({job.cron})</span>
            )}
          </p>
        </div>

        {/* 右侧元信息 */}
        <div className="shrink-0 flex items-center gap-2">
          {!job.enabled && (
            <span className="text-[12px] tracking-wider text-t-ghost bg-surface/60 px-1.5 py-0.5 rounded">
              Off
            </span>
          )}
          <ChevronRight
            size={14}
            className={`text-t-ghost transition-transform duration-200 ${
              expanded ? "rotate-90" : ""
            }`}
          />
        </div>
      </div>

      {/* Body：展开后显示 */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3 space-y-2">
            {job.prompt && (
              <div>
                <p className="text-[12px] tracking-wider text-t-ghost mb-1">
                  Prompt
                </p>
                <p className="text-[13px] text-t-secondary leading-relaxed whitespace-pre-wrap break-words">
                  {job.prompt}
                </p>
              </div>
            )}
            <div className="flex items-center gap-3 text-[12px] text-t-ghost font-mono pt-1 border-t border-border/20">
              <span>ID: {job.id}</span>
              {job.lastRun && <span>上次: {job.lastRun}</span>}
              {job.runCount > 0 && <span>运行 {job.runCount} 次</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CronListDetail({ result, isError }: { result: string; isError: boolean }) {
  if (isError) return <RawPre result={result} isError />;
  if (result.trim() === "当前没有定时任务") {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <Clock size={28} className="text-t-ghost/40" />
        <p className="text-[13px] text-t-ghost italic">当前没有定时任务</p>
      </div>
    );
  }
  const jobs = parseCronList(result);
  if (jobs.length === 0) return <RawPre result={result} isError={false} />;

  const enabledCount = jobs.filter((j) => j.enabled).length;
  const disabledCount = jobs.length - enabledCount;

  return (
    <div className="space-y-3 animate-in fade-in duration-150">
      {/* 小节标题 */}
      <div className="flex items-center gap-2 text-[12px] text-t-ghost">
        <Clock size={13} />
        <span>{jobs.length} 个任务</span>
        {enabledCount > 0 && (
          <span className="text-emerald-600 dark:text-emerald-400">
            · {enabledCount} 启用
          </span>
        )}
        {disabledCount > 0 && (
          <span>· {disabledCount} 禁用</span>
        )}
      </div>

      {/* 卡片列表：启用的在前，每个卡片默认折叠 */}
      {jobs
        .sort((a, b) => (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0))
        .map((job) => (
          <CronJobCard key={job.id} job={job} defaultExpanded={false} />
        ))}
    </div>
  );
}

// ─── task detail ────────────────────────────────────────────────────

/**
 * task 工具的返回格式：[session=<sid>, status=<...>]\n<content>
 */
function parseTaskResult(text: string): { sid?: string; status?: string; body: string } {
  const m = text.match(/^\[session=([^,\]]+),\s*status=([^\]]+)\](?:\n([\s\S]*))?$/);
  if (!m) return { body: text };
  return { sid: m[1].trim(), status: m[2].trim(), body: (m[3] ?? "").trim() };
}

function TaskDetail({ result, isError }: { result: string; isError: boolean }) {
  const { sid, status, body } = parseTaskResult(result);

  return (
    <div className="space-y-2">
      {(sid || status) && (
        <div className="flex items-center gap-2 text-[11px] font-mono">
          {status && (
            <span
              className={`px-1.5 py-0.5 rounded tracking-wide text-[12px] ${
                status === "completed"
                  ? "bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-400"
                  : status.includes("timeout")
                    ? "bg-amber-500/[0.08] text-amber-700 dark:text-amber-400"
                    : "bg-t-ghost/10 text-t-ghost"
              }`}
            >
              {status}
            </span>
          )}
          {sid && (
            <span className="text-t-ghost">
              session=<span className="text-t-secondary">{sid}</span>
            </span>
          )}
        </div>
      )}
      {body && (
        <pre
          className={`text-[13px] font-mono leading-relaxed whitespace-pre-wrap break-words overflow-x-auto max-h-[240px] overflow-y-auto ${
            isError ? "text-red-500" : "text-t-secondary"
          }`}
        >
          {body}
        </pre>
      )}
    </div>
  );
}
