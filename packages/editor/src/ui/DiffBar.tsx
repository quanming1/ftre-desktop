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
      className="flex items-center gap-2.5 px-3 py-1.5 bg-elevated/90 border-b border-border text-[12px] text-t-secondary shrink-0 font-mono"
    >
      {/* Approximate warning */}
      {diff.isApproximate && (
        <span
          data-testid="diff-approximate-warning"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-warning/15 text-warning border border-warning/30"
          title="此 Diff 基于推断构造，可能不完全准确"
        >
          <AlertTriangle size={12} />
          <span className="text-[11px] leading-none">近似</span>
        </span>
      )}

      {/* Diff stats */}
      <span
        data-testid="diff-additions"
        className="text-green-400 bg-green-500/10 border border-green-500/25 rounded px-1.5 py-0.5 leading-none"
      >
        +{additions}
      </span>
      <span
        data-testid="diff-deletions"
        className="text-red-400 bg-red-500/10 border border-red-500/25 rounded px-1.5 py-0.5 leading-none"
      >
        -{deletions}
      </span>

      {/* Tool name */}
      <span className="flex-1 text-t-muted">
        来源 <span className="text-t-primary">{diff.toolName}</span> · {diff.filePath.split(/[\\/]/).pop()}
      </span>

      {/* Mode toggle */}
      <button
        data-testid="diff-toggle-mode"
        onClick={onToggleMode}
        className="flex items-center justify-center h-7 w-7 text-t-secondary hover:text-t-primary hover:bg-white/6 rounded transition-colors"
        title={
          renderSideBySide ? "切换到 inline 模式" : "切换到 side-by-side 模式"
        }
      >
        {renderSideBySide ? <Columns2 size={14} /> : <Rows2 size={14} />}
      </button>

      {/* Open source file */}
      <button
        data-testid="diff-open-file"
        onClick={() => onOpenSourceFile?.(diff.filePath)}
        className="flex items-center justify-center h-7 w-7 text-t-secondary hover:text-t-primary hover:bg-white/6 rounded transition-colors"
        title="打开源文件"
      >
        <FileText size={14} />
      </button>
    </div>
  );
}
