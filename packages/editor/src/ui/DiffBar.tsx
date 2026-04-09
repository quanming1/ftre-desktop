import { AlertTriangle, Columns2, Rows2, FileText } from "lucide-react";
import type { DiffEntry } from "../store/types";

interface DiffBarProps {
  diff: DiffEntry;
  renderSideBySide?: boolean;
  onToggleMode?: () => void;
  onOpenSourceFile?: (filePath: string) => void;
}

/**
 * Compute line-level diff statistics between original and modified content.
 * Returns the count of added and deleted lines using a simple line-by-line comparison.
 */
export function computeDiffStats(
  original: string,
  modified: string,
): { additions: number; deletions: number } {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  let additions = 0;
  let deletions = 0;
  const maxLen = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (i >= origLines.length) {
      additions++;
      continue;
    }
    if (i >= modLines.length) {
      deletions++;
      continue;
    }
    if (origLines[i] !== modLines[i]) {
      additions++;
      deletions++;
    }
  }
  return { additions, deletions };
}

export function DiffBar({
  diff,
  renderSideBySide = true,
  onToggleMode,
  onOpenSourceFile,
}: DiffBarProps) {
  const { additions, deletions } = computeDiffStats(
    diff.originalContent,
    diff.newContent,
  );

  return (
    <div
      data-testid="diff-bar"
      className="flex items-center gap-3 px-3.5 py-2 bg-elevated border-b border-border/80 text-[12px] text-t-secondary shrink-0 font-mono shadow-sm"
    >
      {/* Approximate warning */}
      {diff.isApproximate && (
        <span
          data-testid="diff-approximate-warning"
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-warning/10 text-warning/90 border border-warning/20"
          title="此 Diff 基于推断构造，可能不完全准确"
        >
          <AlertTriangle size={12} />
          <span className="text-[11px] leading-none font-medium">近似</span>
        </span>
      )}

      {/* Diff stats */}
      <span
        data-testid="diff-additions"
        className="text-emerald-400 bg-emerald-500/15 rounded-md px-2 py-1 leading-none font-medium tabular-nums"
      >
        +{additions}
      </span>
      <span
        data-testid="diff-deletions"
        className="text-rose-400 bg-rose-500/15 rounded-md px-2 py-1 leading-none font-medium tabular-nums"
      >
        -{deletions}
      </span>

      {/* Tool name and file */}
      <span className="flex-1 text-t-muted truncate">
        <span className="text-t-tertiary">来自</span>{" "}
        <span className="text-t-secondary">{diff.toolName}</span>
        <span className="text-t-tertiary mx-1.5">·</span>
        <span className="text-t-primary font-medium">{diff.filePath.split(/[\\/]/).pop()}</span>
      </span>

      {/* Mode toggle */}
      <button
        data-testid="diff-toggle-mode"
        onClick={onToggleMode}
        className="flex items-center justify-center h-7 w-7 text-t-muted hover:text-t-primary hover:bg-white/10 active:bg-white/15 rounded-md transition-all duration-150"
        title={
          renderSideBySide ? "切换到 inline 模式" : "切换到 side-by-side 模式"
        }
      >
        {renderSideBySide ? <Columns2 size={15} /> : <Rows2 size={15} />}
      </button>

      {/* Open source file */}
      <button
        data-testid="diff-open-file"
        onClick={() => onOpenSourceFile?.(diff.filePath)}
        className="flex items-center justify-center h-7 w-7 text-t-muted hover:text-t-primary hover:bg-white/10 active:bg-white/15 rounded-md transition-all duration-150"
        title="打开源文件"
      >
        <FileText size={15} />
      </button>
    </div>
  );
}
