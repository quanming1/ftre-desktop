import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useState,
  type MouseEvent,
} from "react";
import { ChevronRight, ExternalLink, FileCode, GitCommitVertical, Loader2, Minus, Plus, UnfoldVertical } from "lucide-react";
import { cn } from "../../utils/cn";

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
  className?: string;
}

type DiffLineType = "ctx" | "del" | "add";

interface DiffLine {
  type: DiffLineType;
  text: string;
  lineNo: number | null;
}

type DiffSegment =
  | { kind: "visible"; lines: DiffLine[] }
  | { kind: "collapsed"; lines: DiffLine[] };

function parseUnifiedDiffLines(diffText: string): DiffLine[] {
  if (!diffText) return [];
  const lines: DiffLine[] = [];
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
      lines.push({ type: "del", text: line.slice(1), lineNo: oldNo++ });
      continue;
    }
    if (line.startsWith("+")) {
      lines.push({ type: "add", text: line.slice(1), lineNo: newNo++ });
      continue;
    }
    lines.push({
      type: "ctx",
      text: line.startsWith(" ") ? line.slice(1) : line,
      lineNo: newNo,
    });
    oldNo++;
    newNo++;
  }

  return lines;
}

function groupIntoSegments(lines: DiffLine[], contextLines = 3): DiffSegment[] {
  if (lines.length === 0) return [];

  const showMask = new Uint8Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === "ctx") continue;
    for (
      let c = Math.max(0, i - contextLines);
      c <= Math.min(lines.length - 1, i + contextLines);
      c++
    ) {
      showMask[c] = 1;
    }
  }

  const segments: DiffSegment[] = [];
  let i = 0;
  while (i < lines.length) {
    const currentVisible = showMask[i] === 1;
    const block: DiffLine[] = [];
    while (i < lines.length && (showMask[i] === 1) === currentVisible) {
      block.push(lines[i]);
      i++;
    }
    segments.push({
      kind: currentVisible ? "visible" : "collapsed",
      lines: block,
    });
  }
  return segments;
}

function DiffBar({ additions, deletions }: { additions: number; deletions: number }) {
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

function DiffStats({ additions, deletions }: { additions: number; deletions: number }) {
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

const DiffLineRow = memo(function DiffLineRow({ line }: { line: DiffLine }) {
  const rowClass =
    line.type === "del"
      ? "bg-[var(--ftre-error,#f85149)]/10 hover:bg-[var(--ftre-error,#f85149)]/15"
      : line.type === "add"
        ? "bg-[var(--ftre-success,#00ff88)]/10 hover:bg-[var(--ftre-success,#00ff88)]/15"
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
    <div className={cn("flex w-max min-w-full transition-colors", rowClass)}>
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

function InlineDiffView({ segments: initialSegments }: { segments: DiffSegment[] }) {
  const [segments, setSegments] = useState(initialSegments);

  useEffect(() => {
    setSegments(initialSegments);
  }, [initialSegments]);

  const handleExpand = useCallback((segmentIndex: number) => {
    setSegments((prev) => {
      const next = [...prev];
      const target = next[segmentIndex];
      if (target.kind === "collapsed") {
        next[segmentIndex] = { kind: "visible", lines: target.lines };
      }
      return next;
    });
  }, []);

  return (
    <div className="text-[12px] font-mono leading-[22px] overflow-x-auto max-h-[400px] overflow-y-auto bg-[var(--ftre-base,#1e1e1e)]">
      {segments.map((segment, segmentIndex) => {
        if (segment.kind === "collapsed") {
          return (
            <button
              key={`c-${segmentIndex}`}
              type="button"
              onClick={() => handleExpand(segmentIndex)}
              className="w-full flex items-center gap-1.5 px-2 py-[3px] bg-white/[0.02] hover:bg-white/[0.05] transition-colors border-y border-white/[0.04]"
            >
              <UnfoldVertical size={11} className="text-[var(--ftre-text-ghost,#888e98)]" />
              <span className="text-[11px] text-[var(--ftre-text-ghost,#888e98)]">
                展开 {segment.lines.length} 行
              </span>
            </button>
          );
        }

        return (
          <Fragment key={`v-${segmentIndex}`}>
            {segment.lines.map((line, lineIndex) => (
              <DiffLineRow
                key={`${segmentIndex}-${lineIndex}-${line.type}-${line.lineNo ?? "n"}`}
                line={line}
              />
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}

const DiffSummaryFileRow = memo(function DiffSummaryFileRow({
  file,
  expanded,
  onExpandedChange,
  onLoadFileDiff,
  onOpenFileDiff,
}: {
  file: DiffSummaryFile;
  expanded: boolean;
  onExpandedChange: (next: boolean) => void;
  onLoadFileDiff?: (filePath: string) => Promise<string | null | undefined>;
  onOpenFileDiff?: (filePath: string) => Promise<void> | void;
}) {
  const [loading, setLoading] = useState(false);
  const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempted, setLoadAttempted] = useState(false);

  const fileName = file.file.split(/[\\/]/).pop() ?? file.file;
  const lastSlashIndex = Math.max(file.file.lastIndexOf("/"), file.file.lastIndexOf("\\"));
  const dirPath = lastSlashIndex > 0 ? file.file.slice(0, lastSlashIndex) : "";
  const diffSegments = diffLines ? groupIntoSegments(diffLines, 3) : null;

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
        <span className="text-[13px] text-[var(--ftre-text-primary,#e8e8e8)] truncate">
          {fileName}
        </span>
        {dirPath && (
          <span className="text-[12px] text-[var(--ftre-text-ghost,#888e98)] truncate">
            {dirPath}
          </span>
        )}
        <span className="flex-1" />
        {loading && (
          <Loader2
            size={12}
            className="animate-spin text-[var(--ftre-text-ghost,#888e98)] shrink-0"
          />
        )}
        {onOpenFileDiff && (
          <button
            type="button"
            onClick={handleOpenDiff}
            className="shrink-0 p-1 rounded-[4px] text-[var(--ftre-text-ghost,#888e98)] hover:text-[var(--ftre-text-secondary,#cccccc)] hover:bg-white/[0.06] focus-visible:bg-white/[0.06] transition-colors opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            title="在 Diff 编辑器中查看完整文件"
            aria-label="在 Diff 编辑器中查看完整文件"
          >
            <ExternalLink size={12} />
          </button>
        )}
        <DiffStats additions={file.additions} deletions={file.deletions} />
        <DiffBar additions={file.additions} deletions={file.deletions} />
      </div>

      {expanded && diffSegments && (
        <div className="ml-6 mr-2 mb-1 rounded-md border border-white/[0.06] overflow-hidden">
          <InlineDiffView segments={diffSegments} />
        </div>
      )}
      {expanded && !loading && loadFailed && (
        <div className="ml-6 mr-2 mb-1 px-3 py-2 text-[12px] text-[var(--ftre-error,#f85149)] bg-[var(--ftre-error,#f85149)]/8 rounded-md border border-[var(--ftre-error,#f85149)]/30 flex items-center justify-between gap-3">
          <span>Diff 加载失败，请稍后重试</span>
          <button
            type="button"
            onClick={() => void loadDiff()}
            className="px-2 py-1 rounded-sm border border-[var(--ftre-error,#f85149)]/40 hover:bg-[var(--ftre-error,#f85149)]/15 transition-colors"
          >
            重试
          </button>
        </div>
      )}
      {expanded && !loading && !loadFailed && loadAttempted && !diffSegments && (
        <div className="ml-6 mr-2 mb-1 px-3 py-2 text-[12px] text-[var(--ftre-text-dim,#969ca6)] bg-white/[0.02] rounded-md border border-white/[0.06]">
          无可展示的 Diff 内容
        </div>
      )}
    </div>
  );
});

export const DiffSummaryCard = memo(function DiffSummaryCard({
  diffMeta,
  onLoadFileDiff,
  onOpenFileDiff,
  className,
}: DiffSummaryCardProps) {
  const {
    files,
    total_additions = 0,
    total_deletions = 0,
    total_files = 0,
  } = diffMeta;
  const displayTotalFiles = total_files || files.length;
  const [expanded, setExpanded] = useState(false);
  const [expandedFileMap, setExpandedFileMap] = useState<Record<string, boolean>>({});
  const handleToggle = useCallback(() => setExpanded((prev) => !prev), []);
  const setFileExpanded = useCallback((filePath: string, next: boolean) => {
    setExpandedFileMap((prev) => {
      if (prev[filePath] === next) return prev;
      return { ...prev, [filePath]: next };
    });
  }, []);

  if (!files || files.length === 0) return null;

  return (
    <div className={cn("text-[13px]", className)}>
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        className="w-full text-left group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer hover:bg-white/[0.03] transition-colors"
      >
        <ChevronRight
          size={12}
          className={cn(
            "text-[var(--ftre-text-ghost,#888e98)] transition-transform",
            expanded && "rotate-90",
          )}
        />
        <GitCommitVertical
          size={14}
          className="shrink-0 text-[var(--ftre-text-ghost,#888e98)]"
        />
        <span className="text-[var(--ftre-text-muted,#aab0b8)]">本轮变更</span>
        <span className="text-[var(--ftre-text-dim,#969ca6)] truncate">
          {displayTotalFiles} 个文件
        </span>
        <span className="flex-1" />
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-[var(--ftre-success,#00ff88)]">+{total_additions}</span>
          <span className="text-[var(--ftre-error,#f85149)]">-{total_deletions}</span>
          <DiffBar additions={total_additions} deletions={total_deletions} />
        </div>
      </button>

      {expanded && (
        <div className="ml-3 border-l border-[var(--ftre-border-subtle,#454545)]">
          <div className="max-h-[500px] overflow-y-auto">
            {files.map((file) => (
              <DiffSummaryFileRow
                key={file.file}
                file={file}
                expanded={!!expandedFileMap[file.file]}
                onExpandedChange={(next) => setFileExpanded(file.file, next)}
                onLoadFileDiff={onLoadFileDiff}
                onOpenFileDiff={onOpenFileDiff}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
