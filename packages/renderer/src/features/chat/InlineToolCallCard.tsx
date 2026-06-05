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
import {
  ChevronRight,
  Terminal,
  FileText,
  FilePenLine,
  Folder,
  Brain,
  Clock,
  MessagesSquare,
  Send,
  Search,
  Loader2,
  Check,
  X,
  Copy,
  FilePlus2,
  FileSearch,
  FolderTree,
  Box,
} from "lucide-react";

// ─── 工具图标 ───────────────────────────────────────────────────────

type IconType = React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

const TOOL_ICONS: Record<string, IconType> = {
  think: Brain, bash: Terminal, exec: Terminal, shell: Terminal,
  read: FileSearch, read_file: FileSearch, list_dir: FolderTree,
  write: FilePlus2, write_file: FilePlus2,
  edit: FilePenLine, edit_file: FilePenLine,
  set_workspace: Folder, cron: Clock, task: MessagesSquare,
  send_message: Send, glob: Search, grep: Search,
  search: Search, web_search: Search, web_fetch: Search,
  loadSkill: Box,
};

function getIcon(name: string | undefined): IconType {
  if (!name) return Terminal;
  if (TOOL_ICONS[name]) return TOOL_ICONS[name];
  const lower = name.toLowerCase();
  for (const [key, Icon] of Object.entries(TOOL_ICONS)) {
    if (lower.includes(key)) return Icon;
  }
  return Terminal;
}

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
      const cmd = (args.command as string) ?? "";
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

// ─── 主组件 ─────────────────────────────────────────────────────────

export const InlineToolCallCard = memo(
  function InlineToolCallCard({ toolCall }: { toolCall: ToolCall }) {
    const isLoadSkill = toolCall.name === "loadSkill";
    const [expanded, setExpanded] = useState(isLoadSkill);
    const [copied, setCopied] = useState(false);

    const status = toolCall.status || "ok";
    const isPending = status === "pending";
    const isRunning = status === "running";
    const isError = status === "error";
    const isComplete = status === "ok" || status === "error";

    const args = parseArgs(toolCall.arguments);
    const Icon = getIcon(toolCall.name);
    const summary = buildSummary(toolCall.name, args, status);
    const hasResult = !!toolCall.result;
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
      if (isLoadSkill) return; // loadSkill 不可折叠
      if (hasResult || isError) setExpanded((p) => !p);
    }, [hasResult, isError, isLoadSkill]);

    // loadSkill: 从 result 提取描述用于 tooltip
    const loadSkillMeta = useMemo(() => {
      if (!isLoadSkill) return null;
      return (toolCall.result || args.skill || "")
        ? parseSkillContent(toolCall.result ?? "")
        : null;
    }, [isLoadSkill, toolCall.result, args.skill]);

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
        <div
          className="flex items-center gap-2 text-left w-full group py-1"
          title={isLoadSkill && loadSkillMeta?.description ? loadSkillMeta.description : undefined}
        >
          {/* 展开箭头 — loadSkill 不显示 */}
          {isLoadSkill ? (
            <span className="w-3.5 shrink-0" />
          ) : hasResult || isError ? (
            <span className="text-t-ghost shrink-0 w-3.5">
              <ChevronRight size={13} className={`transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
            </span>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}

          {/* 图标 */}
          <Icon size={14} className={`shrink-0 ${isLoadSkill ? "text-[#1a7f37]" : "text-t-ghost"}`} strokeWidth={1.5} />

          {/* 摘要 */}
          <SummaryLine summary={summary} className={`flex-1 ${isLoadSkill ? "cursor-default" : "cursor-pointer"}`} />

          {/* 状态 */}
          {isPending && <Loader2 size={12} className="text-t-ghost animate-spin shrink-0" />}
          {isRunning && <Loader2 size={12} className="text-neon animate-spin shrink-0" />}
          {status === "ok" && <Check size={12} className="text-green-600 shrink-0" />}
          {isError && <X size={12} className="text-red-500 shrink-0" />}
        </div>

        {/* 展开详情 */}
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded && toolCall.result ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            {toolCall.result && (
              <div className="ml-[22px] mt-1 mb-2 relative group/result">
                <button
                  onClick={handleCopy}
                  className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover/result:opacity-100 transition-opacity bg-elevated hover:bg-hover z-10"
                  title="复制"
                >
                  {copied
                    ? <Check size={11} className="text-green-600" />
                    : <Copy size={11} className="text-t-dim" />}
                </button>
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
    <div className="pl-3 border-l-2 border-[#1a7f37]/30 space-y-2 animate-in fade-in duration-150">
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
        <p className="text-[12px] text-t-dim leading-relaxed line-clamp-2">{description}</p>
      )}
      {/* Body: raw markdown content, collapsed if huge */}
      <div className="relative">
        <pre className="text-[12px] font-mono leading-relaxed text-t-dim whitespace-pre-wrap break-words overflow-x-auto max-h-[320px] overflow-y-auto bg-elevated/30 rounded-lg p-3 border border-border-subtle">
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
      const descMatch = fm.match(/^description:\s*(.+)$/m);
      if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, "");
      body = text.slice(end + 3).trim();
    }
  }
  return { name, description, body };
}

/** 通用：原始文本 + 左竖线 + 引用色 */
function RawPre({ result, isError }: { result: string; isError: boolean }) {
  return (
    <pre
      className={`py-2 pl-3 border-l-2 border-border-subtle text-[12px] font-mono leading-relaxed overflow-x-auto ${
        isError ? "text-red-500" : "text-t-dim"
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
    <div className="pl-3 border-l-2 border-border-subtle space-y-2">
      {p.cwd && (
        <div className="text-[11px] font-mono text-t-ghost">
          cwd: <span className="text-t-dim">{p.cwd}</span>
        </div>
      )}
      {p.stdout && (
        <pre className="text-[12px] font-mono leading-relaxed text-t-dim whitespace-pre-wrap break-words overflow-x-auto max-h-[240px] overflow-y-auto">
          {p.stdout}
        </pre>
      )}
      {p.stderr && (
        <div className="space-y-0.5">
          <div className="text-[10.5px] font-mono uppercase tracking-wide text-amber-600">
            stderr
          </div>
          <pre className="text-[12px] font-mono leading-relaxed text-amber-700 dark:text-amber-400 whitespace-pre-wrap break-words overflow-x-auto max-h-[200px] overflow-y-auto">
            {p.stderr}
          </pre>
        </div>
      )}
      {p.exitCode !== undefined && p.exitCode !== 0 && (
        <div className="text-[11.5px] font-mono text-red-500">
          exit code: {p.exitCode}
        </div>
      )}
      {!p.stdout && !p.stderr && p.exitCode === 0 && (
        <div className="text-[11.5px] italic text-t-ghost">
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
    <div className="pl-3 border-l-2 border-border-subtle space-y-2">
      {oldStr && <DiffSide kind="old" text={oldStr} />}
      {newStr && <DiffSide kind="new" text={newStr} />}
      {result && (
        <div
          className={`text-[11.5px] font-mono ${
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
    <div className={`flex gap-2 px-2 py-1.5 rounded ${colorClass} font-mono text-[12px] leading-relaxed max-h-[200px] overflow-y-auto`}>
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

function CronListDetail({ result, isError }: { result: string; isError: boolean }) {
  if (isError) return <RawPre result={result} isError />;
  if (result.trim() === "当前没有定时任务") {
    return (
      <div className="pl-3 border-l-2 border-border-subtle text-[12px] italic text-t-ghost">
        当前没有定时任务
      </div>
    );
  }
  const jobs = parseCronList(result);
  if (jobs.length === 0) return <RawPre result={result} isError={false} />;

  return (
    <div className="pl-3 border-l-2 border-border-subtle space-y-2">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="flex items-start gap-2.5 py-1 text-[12px] font-mono"
        >
          <span
            className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
              job.enabled ? "bg-emerald-500" : "bg-t-ghost"
            }`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-t-secondary truncate">{job.title}</span>
              <span className="text-t-ghost text-[11px]">{job.cron}</span>
              {!job.enabled && (
                <span className="text-[10.5px] uppercase tracking-wide text-t-ghost">
                  disabled
                </span>
              )}
            </div>
            {job.prompt && (
              <div className="text-t-dim text-[11.5px] mt-0.5 truncate">
                {job.prompt}
              </div>
            )}
            <div className="text-t-ghost text-[11px] mt-0.5">
              {job.lastRun} · {job.runCount} 次
            </div>
          </div>
        </div>
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
    <div className="pl-3 border-l-2 border-border-subtle space-y-2">
      {(sid || status) && (
        <div className="flex items-center gap-2 text-[11px] font-mono">
          {status && (
            <span
              className={`px-1.5 py-0.5 rounded uppercase tracking-wide text-[10px] ${
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
              session=<span className="text-t-dim">{sid}</span>
            </span>
          )}
        </div>
      )}
      {body && (
        <pre
          className={`text-[12px] font-mono leading-relaxed whitespace-pre-wrap break-words overflow-x-auto max-h-[240px] overflow-y-auto ${
            isError ? "text-red-500" : "text-t-dim"
          }`}
        >
          {body}
        </pre>
      )}
    </div>
  );
}
