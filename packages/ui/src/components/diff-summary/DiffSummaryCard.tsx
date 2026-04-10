/**
 * Diff 渲染核心 — 纯展示组件库
 *
 * 提供 unified diff 解析、分段折叠、单行渲染、增删比例条等能力，
 * 供 DiffSummaryCard 和 edit tool 的 DiffNavCard 复用。
 */
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useState,
  type MouseEvent,
} from "react";
import {
  ChevronRight,
  ExternalLink,
  FileCode,
  GitCommitVertical,
  GitMerge,
  Loader2,
  Minus,
  Plus,
  UnfoldVertical,
  Minimize2,
  Maximize2,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "../../utils/cn";

// ═══════════════════════════════════════════════════════════════════════
// 数据结构
// ═══════════════════════════════════════════════════════════════════════

export type DiffLineType = "ctx" | "del" | "add" | "hunk";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  lineNo: number | null;
}

export type DiffSegment =
  | { kind: "visible"; lines: DiffLine[] }
  | { kind: "collapsed"; lines: DiffLine[] };

// ═══════════════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════════════

/** 解析 unified diff 文本为 flat DiffLine 数组 */
export function parseUnifiedDiffLines(diffText: string): DiffLine[] {
  if (!diffText) return [];
  const result: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;

  for (const line of diffText.split("\n")) {
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("\\")
    ) {
      continue;
    }

    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldNo = parseInt(hunk[1], 10);
      newNo = parseInt(hunk[2], 10);
      continue;
    }

    if (line.startsWith("-")) {
      result.push({ type: "del", text: line.slice(1), lineNo: oldNo++ });
      continue;
    }
    if (line.startsWith("+")) {
      result.push({ type: "add", text: line.slice(1), lineNo: newNo++ });
      continue;
    }
    result.push({
      type: "ctx",
      text: line.startsWith(" ") ? line.slice(1) : line,
      lineNo: newNo,
    });
    oldNo++;
    newNo++;
  }

  return result;
}

/**
 * 从 oldString / newString 计算 DiffLine[]（LCS 算法）。
 */
export function computeDiffLines(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const raw: { type: DiffLineType; text: string; newNo: number }[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      raw.push({ type: "ctx", text: oldLines[i - 1], newNo: j });
      i--; j--;
    } else if (i > 0 && (j === 0 || dp[i - 1][j] >= dp[i][j - 1])) {
      raw.push({ type: "del", text: oldLines[i - 1], newNo: 0 });
      i--;
    } else {
      raw.push({ type: "add", text: newLines[j - 1], newNo: j });
      j--;
    }
  }
  raw.reverse();

  return raw.map((r) => ({
    type: r.type,
    text: r.text,
    lineNo: r.type === "del" ? null : r.newNo,
  }));
}

/** 按 contextLines 将 flat DiffLine[] 分为可见段和折叠段 */
export function groupIntoSegments(allLines: DiffLine[], contextLines = 3): DiffSegment[] {
  if (allLines.length === 0) return [];

  const showMask = new Uint8Array(allLines.length);
  for (let k = 0; k < allLines.length; k++) {
    if (allLines[k].type !== "ctx") {
      for (
        let c = Math.max(0, k - contextLines);
        c <= Math.min(allLines.length - 1, k + contextLines);
        c++
      ) {
        showMask[c] = 1;
      }
    }
  }

  const segments: DiffSegment[] = [];
  let k = 0;
  while (k < allLines.length) {
    const currentVisible = showMask[k] === 1;
    const block: DiffLine[] = [];
    while (k < allLines.length && (showMask[k] === 1) === currentVisible) {
      block.push(allLines[k++]);
    }
    segments.push({
      kind: currentVisible ? "visible" : "collapsed",
      lines: block,
    });
  }
  return segments;
}

/** 计算 diff 统计信息 */
export function computeDiffStats(segments: DiffSegment[]): {
  additions: number;
  deletions: number;
  changeBlocks: number;
  totalLines: number;
} {
  let additions = 0;
  let deletions = 0;
  let changeBlocks = 0;
  let totalLines = 0;

  for (const seg of segments) {
    let hasChange = false;
    for (const line of seg.lines) {
      totalLines++;
      if (line.type === "add") {
        additions++;
        hasChange = true;
      } else if (line.type === "del") {
        deletions++;
        hasChange = true;
      }
    }
    // 折叠的块算作一个变更块
    if (seg.kind === "collapsed" && hasChange) {
      changeBlocks++;
    }
  }

  return { additions, deletions, changeBlocks, totalLines };
}

// ═══════════════════════════════════════════════════════════════════════
// 展示组件
// ═══════════════════════════════════════════════════════════════════════

/** 增删比例条 */
export function DiffBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  if (total === 0) return null;
  const blocks = 5;
  const addBlocks = Math.round((additions / total) * blocks);
  const delBlocks = blocks - addBlocks;

  return (
    <div className="flex gap-[2px]">
      {Array.from({ length: addBlocks }).map((_, i) => (
        <div
          key={`a-${i}`}
          className="w-[7px] h-[7px] rounded-[1px] bg-[var(--ftre-success,#00ff88)]"
        />
      ))}
      {Array.from({ length: delBlocks }).map((_, i) => (
        <div
          key={`d-${i}`}
          className="w-[7px] h-[7px] rounded-[1px] bg-[var(--ftre-error,#f85149)]"
        />
      ))}
    </div>
  );
}

/** 增删数字标签 */
export function DiffStats({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <div className="flex items-center gap-2 shrink-0 text-[12px]">
      {additions > 0 && (
        <span className="flex items-center gap-0.5 text-[var(--ftre-success,#00ff88)]">
          <Plus size={10} strokeWidth={2} />
          {additions}
        </span>
      )}
      {deletions > 0 && (
        <span className="flex items-center gap-0.5 text-[var(--ftre-error,#f85149)]">
          <Minus size={10} strokeWidth={2} />
          {deletions}
        </span>
      )}
    </div>
  );
}

/** 单行 Diff 渲染 */
export const DiffLineRow = memo(function DiffLineRow({
  line,
  onLineClick,
}: {
  line: DiffLine;
  onLineClick?: (lineNo: number | null, type: DiffLineType) => void;
}) {
  const handleClick = useCallback(() => {
    onLineClick?.(line.lineNo, line.type);
  }, [onLineClick, line.lineNo, line.type]);

  const rowClass =
    line.type === "del"
      ? "bg-[var(--ftre-error,#f85149)]/10 hover:bg-[var(--ftre-error,#f85149)]/15 cursor-pointer"
      : line.type === "add"
        ? "bg-[var(--ftre-success,#00ff88)]/10 hover:bg-[var(--ftre-success,#00ff88)]/15 cursor-pointer"
        : "hover:bg-white/[0.03]";
  const textClass =
    line.type === "del"
      ? "text-[var(--ftre-error,#f85149)]/90"
      : line.type === "add"
        ? "text-[var(--ftre-success,#00ff88)]/90"
        : "text-[var(--ftre-text-dim,#969ca6)]";
  const signClass =
    line.type === "del"
      ? "text-[var(--ftre-error,#f85149)]/70"
      : line.type === "add"
        ? "text-[var(--ftre-success,#00ff88)]/70"
        : "text-transparent";
  const sign = line.type === "del" ? "-" : line.type === "add" ? "+" : " ";

  return (
    <div
      className={cn("flex w-max min-w-full transition-colors", rowClass)}
      onClick={handleClick}
    >
      <span className="shrink-0 w-[42px] text-right pr-1 text-[var(--ftre-text-ghost,#888e98)]/45 select-none border-r border-white/[0.04]">
        {line.lineNo}
      </span>
      <span className={cn("shrink-0 w-[18px] text-center select-none", signClass)}>
        {sign}
      </span>
      <span className={cn("whitespace-pre pr-4", textClass)}>{line.text}</span>
      <span className="flex-1" />
    </div>
  );
});

/** 折叠区域按钮 */
function CollapsedBlock({
  lineCount,
  onExpand,
  changeLines,
}: {
  lineCount: number;
  onExpand: () => void;
  changeLines?: { additions: number; deletions: number };
}) {
  return (
    <div
      className="w-full flex items-center justify-between px-2 py-[3px] bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer select-none transition-colors border-y border-white/[0.04] group"
      onClick={onExpand}
    >
      <div className="flex items-center gap-1.5">
        <UnfoldVertical size={11} className="text-[var(--ftre-text-ghost,#888e98)]" />
        <span className="text-[11px] text-[var(--ftre-text-ghost,#888e98)]">
          展开 {lineCount} 行
        </span>
      </div>
      {changeLines && (
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {changeLines.additions > 0 && (
            <span className="text-[10px] text-[var(--ftre-success,#00ff88)]">
              +{changeLines.additions}
            </span>
          )}
          {changeLines.deletions > 0 && (
            <span className="text-[10px] text-[var(--ftre-error,#f85149)]">
              -{changeLines.deletions}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

type ContextLevel = 3 | 10 | 99;

export interface InlineDiffViewProps {
  segments: DiffSegment[];
  /** 上下文行数 */
  contextLines?: ContextLevel;
  /** 点击行号时的回调 */
  onLineClick?: (lineNo: number | null, type: DiffLineType) => void;
  /** 是否显示控制栏 */
  showControls?: boolean;
  /** 重新计算分段用的回调（用于外部传入 groupIntoSegments） */
  regroupFn?: (lines: DiffLine[], context: number) => DiffSegment[];
  /** 原始 diffLines（用于重新计算分段） */
  diffLines?: DiffLine[];
  className?: string;
}

/** 完整 Diff 视图（带折叠段和控制栏） */
export function InlineDiffView({
  segments: initialSegments,
  contextLines = 3,
  onLineClick,
  showControls = true,
  regroupFn,
  diffLines,
  className,
}: InlineDiffViewProps) {
  const [segments, setSegments] = useState(initialSegments);
  const [context, setContext] = useState<ContextLevel>(contextLines);

  // 当 context 变化时，重新分组
  useEffect(() => {
    if (regroupFn && diffLines) {
      setSegments(regroupFn(diffLines, context));
    } else {
      setSegments(initialSegments);
    }
  }, [context, regroupFn, diffLines, initialSegments]);

  const handleExpand = useCallback((segIdx: number) => {
    setSegments((prev) =>
      prev.map((seg, i) =>
        i === segIdx && seg.kind === "collapsed"
          ? { kind: "visible" as const, lines: seg.lines }
          : seg
      )
    );
  }, []);

  const expandAll = useCallback(() => {
    setSegments((prev) =>
      prev.map((seg) => (seg.kind === "collapsed" ? { kind: "visible" as const, lines: seg.lines } : seg)),
    );
  }, []);

  const collapseAll = useCallback(() => {
    if (!regroupFn || !diffLines) return;
    setSegments(regroupFn(diffLines, context));
  }, [regroupFn, diffLines, context]);

  const stats = computeDiffStats(segments);
  const hasCollapsed = segments.some((s) => s.kind === "collapsed");

  return (
    <div className={cn("flex flex-col", className)}>
      {/* 控制栏 */}
      {showControls && (
        <div className="flex items-center justify-between px-2 py-1.5 bg-[var(--ftre-surface,#252526)] border-b border-white/[0.04]">
          <div className="flex items-center gap-3 text-[11px] text-[var(--ftre-text-ghost,#888e98)]">
            <span className="flex items-center gap-1">
              <GitMerge size={10} />
              {stats.changeBlocks} 个变更块
            </span>
            {stats.additions > 0 && (
              <span className="text-[var(--ftre-success,#00ff88)]">+{stats.additions}</span>
            )}
            {stats.deletions > 0 && (
              <span className="text-[var(--ftre-error,#f85149)]">-{stats.deletions}</span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* 上下文切换 */}
            <div className="flex items-center gap-0.5 mr-2">
              <ChevronsUpDown size={10} className="text-[var(--ftre-text-ghost,#888e98)]" />
              <select
                value={context}
                onChange={(e) => setContext(Number(e.target.value) as ContextLevel)}
                className="bg-transparent text-[10px] text-[var(--ftre-text-ghost,#888e98)] border-none outline-none cursor-pointer"
              >
                <option value={3}>±3 行</option>
                <option value={10}>±10 行</option>
                <option value={99}>全部</option>
              </select>
            </div>

            {/* 展开/折叠 */}
            {hasCollapsed && (
              <>
                <button
                  onClick={expandAll}
                  className="p-1 hover:bg-white/[0.06] rounded transition-colors"
                  title="展开全部"
                >
                  <Maximize2 size={10} className="text-[var(--ftre-text-ghost,#888e98)]" />
                </button>
                <button
                  onClick={collapseAll}
                  className="p-1 hover:bg-white/[0.06] rounded transition-colors"
                  title="折叠全部"
                >
                  <Minimize2 size={10} className="text-[var(--ftre-text-ghost,#888e98)]" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Diff 内容 */}
      <div className="text-[12px] font-mono leading-[22px] overflow-x-auto max-h-[400px] overflow-y-auto bg-[var(--ftre-base,#1e1e1e)]">
        {segments.map((seg, segIdx) => {
          if (seg.kind === "collapsed") {
            const changeLines = seg.lines.reduce(
              (acc, l) => {
                if (l.type === "add") acc.additions++;
                else if (l.type === "del") acc.deletions++;
                return acc;
              },
              { additions: 0, deletions: 0 },
            );
            return (
              <CollapsedBlock
                key={`c-${segIdx}`}
                lineCount={seg.lines.length}
                onExpand={() => handleExpand(segIdx)}
                changeLines={changeLines}
              />
            );
          }

          return (
            <Fragment key={`v-${segIdx}`}>
              {seg.lines.map((line, lineIdx) => (
                <DiffLineRow
                  key={`${segIdx}-${lineIdx}-${line.type}-${line.lineNo ?? "n"}`}
                  line={line}
                  onLineClick={onLineClick}
                />
              ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DiffSummaryCard — 文件列表 + 按需加载 Diff
// ═══════════════════════════════════════════════════════════════════════

export interface DiffSummaryFile {
  file: string;
  additions: number;
  deletions: number;
}

export interface DiffSummaryMeta {
  files: DiffSummaryFile[];
  total_additions?: number;
  total_deletions?: number;
  total_files?: number;
}

export interface DiffSummaryCardProps {
  diffMeta: DiffSummaryMeta;
  onLoadFileDiff?: (filePath: string) => Promise<string | null | undefined>;
  onOpenFileDiff?: (filePath: string) => Promise<void> | void;
  onLineClick?: (filePath: string, lineNo: number | null) => void;
  className?: string;
}

const DiffSummaryFileRow = memo(function DiffSummaryFileRow({
  file,
  expanded,
  onExpandedChange,
  onLoadFileDiff,
  onOpenFileDiff,
  onLineClick,
}: {
  file: DiffSummaryFile;
  expanded: boolean;
  onExpandedChange: (next: boolean) => void;
  onLoadFileDiff?: (filePath: string) => Promise<string | null | undefined>;
  onOpenFileDiff?: (filePath: string) => Promise<void> | void;
  onLineClick?: (filePath: string, lineNo: number | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempted, setLoadAttempted] = useState(false);

  const fileName = file.file.split(/[\\/]/).pop() ?? file.file;
  const lastSlashIndex = Math.max(file.file.lastIndexOf("/"), file.file.lastIndexOf("\\"));
  const dirPath = lastSlashIndex > 0 ? file.file.slice(0, lastSlashIndex) : "";

  const loadDiff = useCallback(async () => {
    if (!onLoadFileDiff || loading) return;
    setLoading(true);
    setLoadFailed(false);
    setLoadAttempted(false);
    try {
      const diffText = await onLoadFileDiff(file.file);
      setLoadAttempted(true);
      if (diffText) {
        setDiffLines(parseUnifiedDiffLines(diffText));
        return;
      }
      setDiffLines(null);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [onLoadFileDiff, loading, file.file]);

  const handleToggle = useCallback(async () => {
    if (expanded) {
      onExpandedChange(false);
      return;
    }
    if (!diffLines && onLoadFileDiff && !loading) {
      await loadDiff();
    }
    onExpandedChange(true);
  }, [expanded, onExpandedChange, diffLines, onLoadFileDiff, loading, loadDiff]);

  useEffect(() => {
    if (!expanded || diffLines || loading || !onLoadFileDiff) return;
    void loadDiff();
  }, [expanded, diffLines, loading, onLoadFileDiff, loadDiff]);

  const handleOpenDiff = useCallback(
    async (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      await onOpenFileDiff?.(file.file);
    },
    [onOpenFileDiff, file.file],
  );

  const handleLineClick = useCallback(
    (lineNo: number | null) => {
      onLineClick?.(file.file, lineNo);
    },
    [onLineClick, file.file],
  );

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={handleToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void handleToggle();
          }
        }}
        className="w-full text-left flex items-center gap-2 px-3 py-[7px] hover:bg-white/[0.04] focus-visible:bg-white/[0.04] transition-colors group cursor-pointer rounded-sm"
      >
        <ChevronRight
          size={11}
          className={cn(
            "shrink-0 text-[var(--ftre-text-ghost,#888e98)] transition-transform",
            expanded && "rotate-90",
          )}
        />
        <FileCode
          size={13}
          className="shrink-0 text-[var(--ftre-text-ghost,#888e98)] group-hover:text-[var(--ftre-text-muted,#aab0b8)] transition-colors"
        />
        <span className="text-[13px] text-[var(--ftre-text-muted,#aab0b8)] font-mono truncate max-w-[180px]">
          {fileName}
        </span>
        {dirPath && (
          <span className="text-[11px] text-[var(--ftre-text-ghost,#888e98)] truncate">
            {dirPath}
          </span>
        )}
        <div className="flex-1" />
        <DiffStats additions={file.additions} deletions={file.deletions} />
        <button
          onClick={handleOpenDiff}
          onKeyDown={(e) => e.stopPropagation()}
          className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] transition-all"
          title="在编辑器中打开"
        >
          <ExternalLink size={11} className="text-[var(--ftre-text-ghost,#888e98)]" />
        </button>
      </div>
      {/* Diff 内容 */}
      {expanded && (
        <div className="mx-3 mb-2 rounded-md border border-white/[0.06] overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center h-[40px] bg-[var(--ftre-base,#1e1e1e)]">
              <Loader2 size={14} className="animate-spin text-[var(--ftre-text-ghost,#888e98)]" />
            </div>
          )}
          {loadFailed && !loading && (
            <div className="flex items-center justify-center h-[40px] bg-[var(--ftre-base,#1e1e1e)] text-[var(--ftre-text-ghost,#888e98)] text-[12px]">
              加载失败
            </div>
          )}
          {!loading && loadAttempted && !diffLines && !loadFailed && (
            <div className="flex items-center justify-center h-[40px] bg-[var(--ftre-base,#1e1e1e)] text-[var(--ftre-text-ghost,#888e98)] text-[12px]">
              无变更
            </div>
          )}
          {diffLines && (
            <InlineDiffView
              segments={groupIntoSegments(diffLines, 3)}
              diffLines={diffLines}
              regroupFn={groupIntoSegments}
              onLineClick={handleLineClick}
            />
          )}
        </div>
      )}
    </div>
  );
});

export const DiffSummaryCard = memo(function DiffSummaryCard({
  diffMeta,
  onLoadFileDiff,
  onOpenFileDiff,
  onLineClick,
  className,
}: DiffSummaryCardProps) {
  const { files = [], total_additions = 0, total_deletions = 0 } = diffMeta;

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-white/[0.06] overflow-hidden bg-[var(--ftre-surface,#252526)]",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-white/[0.04] bg-[var(--ftre-title,#2d2d2d)]">
        <GitCommitVertical size={13} className="text-[var(--ftre-text-ghost,#888e98)]" />
        <span className="text-[12px] font-mono text-[var(--ftre-text-dim,#969ca6)]">
          {files.length} 个文件变更
        </span>
        <div className="flex-1" />
        <DiffStats additions={total_additions} deletions={total_deletions} />
      </div>
      {/* File list */}
      <div className="flex flex-col divide-y divide-white/[0.03]">
        {files.map((file) => (
          <DiffSummaryFileRowWithState
            key={file.file}
            file={file}
            onLoadFileDiff={onLoadFileDiff}
            onOpenFileDiff={onOpenFileDiff}
            onLineClick={onLineClick}
          />
        ))}
      </div>
    </div>
  );
});

// 内部状态包装器
const DiffSummaryFileRowWithState = memo(function DiffSummaryFileRowWithState({
  file,
  onLoadFileDiff,
  onOpenFileDiff,
  onLineClick,
}: {
  file: DiffSummaryFile;
  onLoadFileDiff?: (filePath: string) => Promise<string | null | undefined>;
  onOpenFileDiff?: (filePath: string) => Promise<void> | void;
  onLineClick?: (filePath: string, lineNo: number | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <DiffSummaryFileRow
      file={file}
      expanded={expanded}
      onExpandedChange={setExpanded}
      onLoadFileDiff={onLoadFileDiff}
      onOpenFileDiff={onOpenFileDiff}
      onLineClick={onLineClick}
    />
  );
});
