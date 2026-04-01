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
      className="flex items-center gap-3.5 px-4 py-2 bg-neon-ghost border-b border-border text-[12px] text-t-secondary shrink-0 font-mono"
    >
      {/* Approximate warning */}
      {diff.isApproximate && (
        <span
          data-testid="diff-approximate-warning"
          className="flex items-center gap-1 text-yellow-400"
          title="此 Diff 基于推断构造，可能不完全准确"
        >
          <AlertTriangle size={12} />
          <span className="text-[11px]">近似</span>
        </span>
      )}

      {/* Diff stats */}
      <span data-testid="diff-additions" className="text-green-400">
        +{additions}
      </span>
      <span data-testid="diff-deletions" className="text-red-400">
        -{deletions}
      </span>

      {/* Tool name */}
      <span className="flex-1">
        由 <span className="text-neon">{diff.toolName}</span> 修改
      </span>

      {/* Mode toggle */}
      <button
        data-testid="diff-toggle-mode"
        onClick={onToggleMode}
        className="flex items-center gap-1 text-t-secondary hover:text-t-primary hover:bg-white/5 px-2 py-0.5 rounded transition-colors"
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
        className="flex items-center gap-1 text-t-secondary hover:text-t-primary hover:bg-white/5 px-2 py-0.5 rounded transition-colors"
        title="打开源文件"
      >
        <FileText size={14} />
      </button>
    </div>
  );
}
