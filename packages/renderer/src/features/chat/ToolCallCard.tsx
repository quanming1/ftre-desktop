/**
 * ToolCallCard — 统一设计系统的工具调用渲染
 *
 * 设计原则：
 * - 统一的视觉语言：所有卡片共享相同的间距、圆角、颜色、字号
 * - 一致的交互模式：hover、点击、展开动画完全一致
 * - 清晰的层次结构：状态 → 图标 → 名称 → 内容 → 操作
 */
import { useState, memo, useMemo, useRef, useEffect } from "react";
import { FileText, Pencil, Terminal, Search, Brain, Loader2, ChevronRight, Copy, Check, AlertCircle, Ban, Undo2, ExternalLink, Diff } from "lucide-react";
import { useThrottledValue } from "@/hooks/useThrottledValue";
import { computeDiffLines, groupIntoSegments, InlineDiffView } from "@ftre/ui";
import type { ToolCallMessage } from "@/types/chat";
import { isToolCall } from "@/types/chat";
import { useMessageById } from "@/stores/chat";
import { handleOpenFile, handleShowDiff } from "./toolActions";
import { revertDiff } from "@/services/api";
import { getToolFilePath, getToolSummary, getGroupItemLabel, TOOL_CATEGORY_MAP, GROUP_DISPLAY_TITLE, getGroupKey } from "./toolClassification";

// ═══════════════════════════════════════════════════════════════════════
// 设计系统常量
// ═══════════════════════════════════════════════════════════════════════

const DESIGN = {
  // 间距系统
  spacing: {
    cardPadding: "px-3 py-1.5",
    contentPadding: "px-3 py-2",
    gap: "gap-2",
  },
  // 字体系统
  typography: {
    toolName: "text-[13px] font-mono",
    summary: "text-[13px] font-mono",
    content: "text-[13px] font-mono leading-relaxed",
  },
  // 颜色系统
  colors: {
    toolName: "text-t-muted",
    summary: "text-t-dim",
    content: "text-t-secondary",
    contentBg: "bg-base",
    hover: "hover:bg-white/[0.03]",
  },
  // 图标系统
  icons: {
    size: 14,
    chevronSize: 12,
    statusSize: 13,
  },
  // 圆角系统
  radius: {
    card: "rounded-lg",
    content: "rounded-md",
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════
// 共享组件
// ═══════════════════════════════════════════════════════════════════════

const StatusIndicator = memo(function StatusIndicator({ status }: { status: ToolCallMessage["status"] }) {
  if (status === "streaming") {
    // 三点脉冲：表示 AI 正在生成参数
    return (
      <div data-testid="status-streaming" className="flex items-center gap-[3px] shrink-0 w-[13px] justify-center">
        {[0, 1, 2].map((i) => (
          <div key={i}
            className="w-[3px] h-[3px] rounded-full bg-neon"
            style={{ animation: "thinking 1.2s ease-in-out infinite", animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
    );
  }
  if (status === "running") {
    return <Loader2 data-testid="status-running" size={DESIGN.icons.statusSize} className="animate-spin text-neon shrink-0" />;
  }
  if (status === "error") {
    return <AlertCircle data-testid="status-error" size={DESIGN.icons.statusSize} className="text-red-400 shrink-0" />;
  }
  if (status === "cancelled") {
    return <Ban data-testid="status-cancelled" size={DESIGN.icons.statusSize} className="text-yellow-400 shrink-0" />;
  }
  return null;
});

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-t-ghost hover:text-t-secondary transition-colors p-0.5 rounded"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
    </button>
  );
}

function ExpandToggle({ expanded }: { expanded: boolean }) {
  return <ChevronRight size={DESIGN.icons.chevronSize} className={`text-t-ghost transition-transform ${expanded ? "rotate-90" : ""}`} />;
}

// ═══════════════════════════════════════════════════════════════════════
// 卡片容器：统一的外壳
// ═══════════════════════════════════════════════════════════════════════

interface CardShellProps {
  status: ToolCallMessage["status"];
  icon: React.ReactNode;
  name: string;
  summary?: string;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  /** Optional action buttons rendered on the right side (shown on hover) */
  actions?: React.ReactNode;
}

const CardShell = memo(function CardShell({ status, icon, name, summary, onClick, disabled, loading, expandable, expanded, actions }: CardShellProps) {
  const isClickable = onClick && !disabled;

  return (
    <div
      data-testid={expandable ? "tool-card-header" : undefined}
      className={`
        group flex items-center w-full text-left
        ${DESIGN.spacing.cardPadding} ${DESIGN.spacing.gap}
        ${DESIGN.radius.card} ${DESIGN.typography.toolName}
        transition-colors
        ${isClickable ? `cursor-pointer ${DESIGN.colors.hover}` : ""}
        ${disabled ? "opacity-50 cursor-default" : ""}
      `}
      onClick={disabled ? undefined : onClick}
      role={isClickable ? "button" : undefined}
    >
      <StatusIndicator status={status} />
      {icon}
      <span className={DESIGN.colors.toolName}>{name}</span>
      {summary && (
        <span data-testid="tool-summary" className={`${DESIGN.typography.summary} ${DESIGN.colors.summary} truncate max-w-[200px]`}>
          {summary}
        </span>
      )}
      <div className="flex-1" />
      {loading && <Loader2 size={DESIGN.icons.statusSize} className="animate-spin text-t-ghost" />}
      {/* Action buttons: visible on hover */}
      {actions && (
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions}
        </div>
      )}
      {expandable && <ExpandToggle expanded={expanded || false} />}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 内容展示：统一的展开内容容器
// ═══════════════════════════════════════════════════════════════════════

function ContentBlock({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className={`mx-2.5 mb-1 ${DESIGN.radius.content} ${DESIGN.colors.contentBg} overflow-hidden`}>
      {title && (
        <div className="flex items-center justify-between px-2.5 py-1 border-b border-border">
          <span className="text-[12px] text-t-dim uppercase tracking-wider">{title}</span>
        </div>
      )}
      <div className={`${DESIGN.spacing.contentPadding} ${DESIGN.typography.content} ${DESIGN.colors.content}`}>{children}</div>
    </div>
  );
}

function OutputBlock({ output, title = "输出" }: { output: string; title?: string }) {
  return (
    <div className={`mx-2.5 mb-1 ${DESIGN.radius.content} ${DESIGN.colors.contentBg} overflow-hidden`}>
      <div className="flex items-center justify-between px-2.5 py-1 border-b border-border">
        <span className="text-[12px] text-t-dim uppercase tracking-wider">{title}</span>
        <CopyButton text={output} />
      </div>
      <pre
        className={`${DESIGN.spacing.contentPadding} ${DESIGN.typography.content} ${DESIGN.colors.content} whitespace-pre-wrap break-all max-h-[200px] overflow-hidden`}
      >
        {output}
      </pre>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 文件导航卡片：read
// ═══════════════════════════════════════════════════════════════════════

function FileNavCard({ message }: { message: ToolCallMessage }) {
  const [loading, setLoading] = useState(false);
  const filePath = getToolFilePath(message);
  const fileName = getToolSummary(message);
  const isCompleted = message.status === "completed";

  const handleClick = async () => {
    if (!isCompleted || loading || !filePath) return;
    setLoading(true);
    try {
      await handleOpenFile(filePath);
    } finally {
      setLoading(false);
    }
  };

  return (
    <CardShell
      status={message.status}
      icon={<FileText size={DESIGN.icons.size} className="shrink-0 text-t-ghost" />}
      name={message.name}
      summary={fileName}
      onClick={handleClick}
      disabled={!isCompleted || !filePath}
      loading={loading}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 写入卡片：write — streaming 时可预览代码
// ═══════════════════════════════════════════════════════════════════════

function WriteCard({ message }: { message: ToolCallMessage }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const isStreaming = message.status === "streaming";
  const isCompleted = message.status === "completed";
  const filePath = getToolFilePath(message);
  const fullName = getToolSummary(message);
  const fileName = filePath ? filePath.split(/[\\/]/).pop() || fullName : fullName;

  // streaming 内容
  const content = typeof message.arguments?.content === "string"
    ? message.arguments.content : "";
  const lineCount = content ? content.split("\n").length : 0;

  // summary: streaming 时显示行数，否则只显示文件名
  const summary = isStreaming && lineCount > 0
    ? `${fileName} (${lineCount} lines...)`
    : fileName;

  // completed 时点击打开文件，streaming/running 时点击展开预览
  const handleClick = async () => {
    if (isCompleted && filePath) {
      setLoading(true);
      try { await handleOpenFile(filePath); }
      finally { setLoading(false); }
    } else {
      setExpanded(!expanded);
    }
  };

  // 代码区域自动滚动到底部
  const preRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (expanded && isStreaming && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  });

  // 从文件扩展名推断语言
  const language = filePath
    ? (filePath.split(".").pop() || "text")
    : "text";

  return (
    <div>
      <CardShell
        status={message.status}
        icon={<FileText size={DESIGN.icons.size} className="shrink-0 text-t-ghost" />}
        name="write"
        summary={summary}
        onClick={handleClick}
        loading={loading}
        expandable={isStreaming || (!!content && !isCompleted)}
        expanded={expanded}
      />
      {expanded && content && (
        <div className="mx-2.5 mb-1.5 rounded-md border border-white/[0.06] overflow-hidden">
          <div className="flex items-center justify-between h-[24px] px-2.5 bg-surface/80 border-b border-border/40">
            <span className="text-[11px] text-t-ghost font-mono">{language}</span>
            {isStreaming && (
              <span className="text-[11px] text-neon/60 font-mono">generating...</span>
            )}
          </div>
          <pre ref={preRef}
            className="px-3 py-2 bg-base/50 text-[12px] leading-[1.6] font-mono text-t-secondary
                       max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 操作按钮（卡片右侧，hover 时显示）
// ═══════════════════════════════════════════════════════════════════════

function CardAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  variant = "default",
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger" | "success";
}) {
  const variantClass =
    variant === "danger"
      ? "text-red-400 hover:text-red-300 hover:bg-red-500/10"
      : variant === "success"
        ? "text-green-400 hover:text-green-300 hover:bg-green-500/10"
        : "text-t-dim hover:text-t-primary hover:bg-white/[0.06]";

  return (
    <button
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-mono transition-colors duration-150 disabled:opacity-30 disabled:pointer-events-none ${variantClass}`}
    >
      <Icon size={13} />
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Diff 卡片：edit
//
// 交互：
//   默认点击 → 展开/折叠编辑信息 (oldString → newString 对比)
//   按钮 1   → 撤销 (将文件恢复为 edit 前)
//   按钮 2   → 跳转文件 (在编辑器中打开)
//   按钮 3   → 完整 Diff (在编辑器中打开 Monaco DiffEditor)
// ═══════════════════════════════════════════════════════════════════════

function DiffNavCard({ message }: { message: ToolCallMessage }) {
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const fileName = getToolSummary(message);
  const filePath = getToolFilePath(message);
  const isCompleted = message.status === "completed";
  // edit tool 完成后默认展开 diff
  const [expanded, setExpanded] = useState(isCompleted);
  // 当 status 从非 completed 变为 completed 时，自动展开
  const prevStatusRef = useRef(message.status);
  useEffect(() => {
    if (prevStatusRef.current !== "completed" && isCompleted) {
      setExpanded(true);
    }
    prevStatusRef.current = message.status;
  }, [isCompleted, message.status]);

  const handleToggle = () => {
    if (isCompleted) setExpanded(!expanded);
  };

  const handleUndo = async () => {
    if (!isCompleted || undoing || undone) return;
    setUndoing(true);
    try {
      const result = await revertDiff(message.toolId);
      if (result?.status === "reverted") {
        setUndone(true);
      } else {
        console.warn("[edit undo] unexpected result:", result);
      }
    } catch (err) {
      console.error("[edit undo] failed:", err);
    } finally {
      setUndoing(false);
    }
  };

  const handleGoToFile = () => {
    if (filePath) handleOpenFile(filePath);
  };

  const handleFullDiff = async () => {
    if (!isCompleted || diffLoading) return;
    setDiffLoading(true);
    try {
      await handleShowDiff(message);
    } finally {
      setDiffLoading(false);
    }
  };

  // 从 oldString/newString 计算 diff（惰性）
  const oldString = typeof message.arguments?.oldString === "string" ? message.arguments.oldString : "";
  const newString = typeof message.arguments?.newString === "string" ? message.arguments.newString : "";
  const diffLines = useMemo(() => {
    if (!oldString && !newString) return null;
    return computeDiffLines(oldString, newString);
  }, [oldString, newString]);

  // 计算统计信息
  const diffStats = useMemo(() => {
    if (!diffLines) return null;
    const segments = groupIntoSegments(diffLines, 3);
    const additions = diffLines.filter(l => l.type === "add").length;
    const deletions = diffLines.filter(l => l.type === "del").length;
    const changeBlocks = segments.filter(s => s.kind === "collapsed").length;
    return { additions, deletions, changeBlocks, totalLines: diffLines.length };
  }, [diffLines]);

  const actionButtons = isCompleted ? (
    <>
      <CardAction
        icon={undone ? Check : undoing ? Loader2 : Undo2}
        label={undone ? "已撤销" : "撤销"}
        onClick={handleUndo}
        disabled={undoing || undone}
        variant={undone ? "success" : "danger"}
      />
      <CardAction
        icon={ExternalLink}
        label="打开"
        onClick={handleGoToFile}
        disabled={!filePath}
      />
      <CardAction
        icon={diffLoading ? Loader2 : Diff}
        label="Diff"
        onClick={handleFullDiff}
        disabled={diffLoading}
      />
    </>
  ) : undefined;

  return (
    <div>
      <CardShell
        status={message.status}
        icon={<Pencil size={DESIGN.icons.size} className="shrink-0 text-t-ghost" />}
        name="edit"
        summary={fileName}
        onClick={handleToggle}
        disabled={!isCompleted}
        expandable
        expanded={expanded}
        actions={actionButtons}
      />
      {expanded && diffLines && diffLines.length > 0 && (
        <div className="mx-2.5 mb-1.5 rounded-md border border-white/[0.06] overflow-hidden">
          <InlineDiffView
            segments={groupIntoSegments(diffLines, 3)}
            diffLines={diffLines}
            regroupFn={groupIntoSegments}
            showControls={true}
          />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 思考卡片：think
// ═══════════════════════════════════════════════════════════════════════

function ThinkCard({ message }: { message: ToolCallMessage }) {
  const isStreaming = message.status === "streaming";
  // streaming 时自动展开
  const [expanded, setExpanded] = useState(false);
  const autoExpanded = isStreaming || expanded;

  const rawContent = (typeof message.arguments?.thought === "string"
    ? message.arguments.thought : message.result) || "";
  // 流式节流：streaming 时每 100ms 更新一次，完成后直接透传
  const content = useThrottledValue(rawContent, 100, isStreaming);

  const contentRef = useRef<HTMLDivElement>(null);

  // streaming 光标
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const old = el.querySelector("[data-streaming-cursor]");
    if (old) old.remove();
    if (!isStreaming) return;

    const cursor = document.createElement("span");
    cursor.setAttribute("data-streaming-cursor", "");
    cursor.className = "inline-block w-[5px] h-[13px] bg-neon/70 ml-0.5 align-middle";
    cursor.style.animation = "blink 1s step-end infinite";
    el.appendChild(cursor);
  }, [isStreaming, content]);

  return (
    <div>
      <CardShell
        status={message.status}
        icon={<Brain size={DESIGN.icons.size} className="shrink-0 text-t-ghost" />}
        name="思考"
        summary={!autoExpanded && content
          ? (content.length > 80 ? content.slice(0, 80) + "…" : content)
          : undefined}
        onClick={() => setExpanded(!autoExpanded)}
        expandable
        expanded={autoExpanded}
      />
      {autoExpanded && content && (
        <ContentBlock>
          <div ref={contentRef}
            className="whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
            {content}
          </div>
        </ContentBlock>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 通用卡片：bash / search / 其他
// ═══════════════════════════════════════════════════════════════════════

function GenericCard({ message }: { message: ToolCallMessage }) {
  const [expanded, setExpanded] = useState(false);
  const category = TOOL_CATEGORY_MAP[message.name];
  const summary = getToolSummary(message);
  const Icon = category === "search" ? Search : Terminal;

  return (
    <div>
      <CardShell
        status={message.status}
        icon={<Icon size={DESIGN.icons.size} className="shrink-0 text-t-ghost" />}
        name={message.name}
        summary={summary}
        onClick={() => setExpanded(!expanded)}
        expandable
        expanded={expanded}
      />
      {expanded && <GenericExpandedContent message={message} />}
    </div>
  );
}

function GenericExpandedContent({ message }: { message: ToolCallMessage }) {
  const category = TOOL_CATEGORY_MAP[message.name];

  if (category === "command") {
    const command = typeof message.arguments?.command === "string" ? message.arguments.command : "";
    return (
      <>
        <ContentBlock title="命令">
          <span className="text-t-ghost">$ </span>
          {command}
        </ContentBlock>
        {message.result && <OutputBlock output={message.result} />}
      </>
    );
  }

  if (category === "search") {
    const pattern = typeof message.arguments?.pattern === "string" ? message.arguments.pattern : "";
    return (
      <>
        <ContentBlock title="模式">{pattern}</ContentBlock>
        {message.result && <OutputBlock output={message.result} title="匹配" />}
      </>
    );
  }

  // fallback
  const entries = Object.entries(message.arguments ?? {});
  return (
    <>
      {entries.length > 0 && (
        <ContentBlock title="参数">
          <div className="space-y-0.5">
            {entries.map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <span className="text-t-ghost shrink-0">{key}:</span>
                <span className="text-t-secondary whitespace-pre-wrap break-all">{typeof value === "string" ? value : JSON.stringify(value)}</span>
              </div>
            ))}
          </div>
        </ContentBlock>
      )}
      {message.result && <OutputBlock output={message.result} />}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 分组合并卡片：连续相同工具调用 → 一个卡片内多个 chip
// ═══════════════════════════════════════════════════════════════════════

/** 为 grep/glob chip 构建 hover tooltip */
function getChipTooltip(message: ToolCallMessage): string | undefined {
  if (message.name === "grep") {
    const pattern = message.arguments?.pattern ?? "";
    const include = message.arguments?.include ?? "";
    const path = message.arguments?.path ?? "";
    const parts = [`grep: ${pattern}`];
    if (include) parts.push(`include: ${include}`);
    if (path) parts.push(`path: ${path}`);
    // 结果摘要
    if (message.status === "completed" && message.result) {
      const lines = message.result.split("\n").filter(Boolean);
      parts.push(`${lines.length} match(es)`);
    }
    return parts.join("\n");
  }
  if (message.name === "glob") {
    const pattern = message.arguments?.pattern ?? "";
    const path = message.arguments?.path ?? "";
    const parts = [`glob: ${pattern}`];
    if (path) parts.push(`path: ${path}`);
    if (message.status === "completed" && message.result) {
      const lines = message.result.split("\n").filter(Boolean);
      parts.push(`${lines.length} file(s)`);
    }
    return parts.join("\n");
  }
  if (message.name === "read") {
    const filePath = getToolFilePath(message);
    return filePath ?? undefined;
  }
  return undefined;
}

/** 分组中单个 item 的 chip — 独立订阅 store，可点击打开文件 */
const GroupChip = memo(function GroupChip({ messageId }: { messageId: string }) {
  const message = useMessageById(messageId);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!message || !isToolCall(message)) return null;

  const label = getGroupItemLabel(message);
  const filePath = getToolFilePath(message);
  const isCompleted = message.status === "completed";
  const isStreaming = message.status === "streaming";
  const isRunning = message.status === "running";
  const isError = message.status === "error";
  const tooltip = getChipTooltip(message);

  // read 工具 → 点击打开文件; grep/glob → 点击展开结果
  const handleClick = async () => {
    if (message.name === "read" && isCompleted && filePath && !loading) {
      setLoading(true);
      try {
        await handleOpenFile(filePath);
      } finally {
        setLoading(false);
      }
    } else if ((message.name === "grep" || message.name === "glob") && isCompleted) {
      setExpanded(!expanded);
    }
  };

  const isClickable = (message.name === "read" && isCompleted && !!filePath)
    || ((message.name === "grep" || message.name === "glob") && isCompleted);

  // 工具类型标签
  const toolTag = message.name === "read" ? null
    : message.name === "grep" ? "grep"
    : message.name === "glob" ? "glob"
    : null;

  // 图标选择
  const chipIcon = isStreaming ? (
    <div className="flex items-center gap-[2px] shrink-0">
      {[0, 1, 2].map((i) => (
        <div key={i} className="w-[2px] h-[2px] rounded-full bg-neon"
          style={{ animation: "thinking 1.2s ease-in-out infinite", animationDelay: `${i * 0.2}s` }} />
      ))}
    </div>
  ) : isRunning ? (
    <Loader2 size={11} className="animate-spin text-neon shrink-0" />
  ) : isError ? (
    <AlertCircle size={11} className="text-danger/80 shrink-0" />
  ) : message.name === "read" ? (
    <FileText size={11} className="text-t-ghost shrink-0 transition-colors group-hover/chip:text-t-dim" />
  ) : (
    <Search size={11} className="text-t-ghost shrink-0 transition-colors group-hover/chip:text-t-dim" />
  );

  // grep/glob 结果摘要
  const resultSummary = useMemo(() => {
    if (!isCompleted || !message.result) return null;
    if (message.name === "grep" || message.name === "glob") {
      const lines = message.result.split("\n").filter(Boolean);
      return `${lines.length}`;
    }
    return null;
  }, [isCompleted, message.result, message.name]);

  return (
    <div className="flex flex-col">
      <div
        className={`
          flex items-center gap-2 h-[30px] px-2.5
          rounded-md bg-elevated/60 border border-transparent
          transition-all duration-150 group/chip
          ${isClickable ? "cursor-pointer hover:bg-elevated hover:border-border-subtle" : "cursor-default"}
          ${isError ? "border-danger/20" : ""}
        `}
        onClick={handleClick}
        title={tooltip}
        role={isClickable ? "button" : undefined}
      >
        {chipIcon}
        {toolTag && (
          <span className="text-[10px] font-mono text-t-ghost bg-white/[0.04] px-1 py-0.5 rounded shrink-0">{toolTag}</span>
        )}
        <span className="text-[13px] font-mono text-t-dim transition-colors duration-150 group-hover/chip:text-t-secondary truncate max-w-[260px]">
          {label}
        </span>
        {resultSummary && (
          <span className="text-[10px] font-mono text-t-ghost shrink-0">{resultSummary}</span>
        )}
        {loading && <Loader2 size={9} className="animate-spin text-t-ghost" />}
        {(message.name === "grep" || message.name === "glob") && isCompleted && (
          <ChevronRight size={10} className={`text-t-ghost transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`} />
        )}
      </div>
      {/* grep/glob 展开结果 */}
      {expanded && message.result && (
        <pre className="mx-2 mt-0.5 mb-1 px-2.5 py-1.5 text-[12px] font-mono text-t-secondary bg-base rounded-md max-h-[150px] overflow-y-auto whitespace-pre-wrap break-all">
          {message.result}
        </pre>
      )}
    </div>
  );
});

/** 分组容器卡片 — 标题 + chip 流式排列 */
export const ToolCallGroup = memo(function ToolCallGroup({
  toolName,
  messageIds,
}: {
  toolName: string;
  messageIds: string[];
}) {
  const title = GROUP_DISPLAY_TITLE[toolName] || toolName;

  return (
    <div className="px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-[13px] font-mono font-medium text-t-muted mr-0.5 self-center">
          {title}
        </span>
        {messageIds.map((id) => (
          <GroupChip key={id} messageId={id} />
        ))}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 主导出
// ═══════════════════════════════════════════════════════════════════════

export const ToolCallCard = memo(
  function ToolCallCard({ message }: { message: ToolCallMessage }) {
    if (message.name === "think") return <ThinkCard message={message} />;
    if (message.name === "write") return <WriteCard message={message} />;
    if (message.name === "read" || message.name === "read_message") return <FileNavCard message={message} />;
    if (message.name === "edit") return <DiffNavCard message={message} />;
    return <GenericCard message={message} />;
  },
  (prev, next) => {
    return prev.message === next.message;
  },
);
