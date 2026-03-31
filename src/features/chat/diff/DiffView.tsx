/**
 * 公共 Diff 渲染组件。
 *
 * 提供 unified diff 解析、分段折叠、单行渲染、增删比例条等能力，
 * 供 DiffSummaryCard 等上层组件复用。
 */
import { memo, useState, useCallback, Fragment } from "react";
import { Plus, Minus, UnfoldVertical } from "lucide-react";

// ── Diff 数据结构 ──────────────────────────────────────────────────

export type DiffLineType = "ctx" | "del" | "add" | "hunk";

/** 单行 diff 数据 */
export interface DiffLine {
  type: DiffLineType;
  text: string;
  lineNo: number | null;
}

/** diff 分段：可见段或折叠段 */
export type DiffSegment =
  | { kind: "visible"; lines: DiffLine[] }
  | { kind: "collapsed"; lines: DiffLine[] };

// ── 解析 git unified diff 文本 ─────────────────────────────────────

/** 解析 unified diff 文本为 flat DiffLine 数组（所有行） */
export function parseUnifiedDiffLines(diffText: string): DiffLine[] {
  if (!diffText) return [];
  const result: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff ") || line.startsWith("index ") ||
        line.startsWith("--- ") || line.startsWith("+++ ") ||
        line.startsWith("\\")) continue;

    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldNo = parseInt(hunkMatch[1], 10);
      newNo = parseInt(hunkMatch[2], 10);
      continue;
    }

    if (line.startsWith("-")) {
      result.push({ type: "del", text: line.slice(1), lineNo: oldNo++ });
    } else if (line.startsWith("+")) {
      result.push({ type: "add", text: line.slice(1), lineNo: newNo++ });
    } else {
      result.push({ type: "ctx", text: line.startsWith(" ") ? line.slice(1) : line, lineNo: newNo });
      oldNo++; newNo++;
    }
  }
  return result;
}

/**
 * 从 oldString / newString 计算 DiffLine[]（LCS 算法）。
 * 用于 edit 工具等已有原始文本但没有 unified diff 文本的场景。
 */
export function computeDiffLines(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const m = oldLines.length;
  const n = newLines.length;

  // O(NM) LCS（edit 的 oldString 通常很短）
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // 回溯：优先 del 再 add，符合 unified diff 习惯
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

  // 标记变更行 ± contextLines 为可见
  const show = new Uint8Array(allLines.length);
  for (let k = 0; k < allLines.length; k++) {
    if (allLines[k].type !== "ctx") {
      for (let c = Math.max(0, k - contextLines); c <= Math.min(allLines.length - 1, k + contextLines); c++) {
        show[c] = 1;
      }
    }
  }

  const segments: DiffSegment[] = [];
  let k = 0;
  while (k < allLines.length) {
    if (show[k]) {
      const lines: DiffLine[] = [];
      while (k < allLines.length && show[k]) lines.push(allLines[k++]);
      segments.push({ kind: "visible", lines });
    } else {
      const lines: DiffLine[] = [];
      while (k < allLines.length && !show[k]) lines.push(allLines[k++]);
      segments.push({ kind: "collapsed", lines });
    }
  }
  return segments;
}

// ── 增删比例条 ──────────────────────────────────────────────────────

export function DiffBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  if (total === 0) return null;
  const blocks = 5;
  const addBlocks = Math.round((additions / total) * blocks);
  const delBlocks = blocks - addBlocks;
  return (
    <div className="flex gap-[2px]">
      {Array.from({ length: addBlocks }, (_, i) => (
        <div key={`a${i}`} className="w-[7px] h-[7px] rounded-[1px] bg-green-400" />
      ))}
      {Array.from({ length: delBlocks }, (_, i) => (
        <div key={`d${i}`} className="w-[7px] h-[7px] rounded-[1px] bg-red-400" />
      ))}
    </div>
  );
}

// ── 增删数字标签 ─────────────────────────────────────────────────────

export function DiffStats({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <div className="flex items-center gap-2 shrink-0 text-[12px] font-mono">
      {additions > 0 && (
        <span className="flex items-center gap-0.5 text-green-400">
          <Plus size={10} strokeWidth={2} />{additions}
        </span>
      )}
      {deletions > 0 && (
        <span className="flex items-center gap-0.5 text-red-400">
          <Minus size={10} strokeWidth={2} />{deletions}
        </span>
      )}
    </div>
  );
}

// ── 单行渲染 ─────────────────────────────────────────────────────────

export const DiffLineRow = memo(function DiffLineRow({ line }: { line: DiffLine }) {
  const bgClass =
    line.type === "del" ? "bg-red-500/[0.10] hover:bg-red-500/[0.16]"
    : line.type === "add" ? "bg-green-500/[0.10] hover:bg-green-500/[0.16]"
    : "hover:bg-white/[0.03]";
  const textClass =
    line.type === "del" ? "text-red-300/90"
    : line.type === "add" ? "text-green-300/90"
    : "text-t-dim";
  const signChar = line.type === "del" ? "-" : line.type === "add" ? "+" : " ";
  const signClass =
    line.type === "del" ? "text-red-400/60"
    : line.type === "add" ? "text-green-400/60"
    : "text-transparent";

  return (
    <div className={`flex ${bgClass}`}>
      <span className="shrink-0 w-[42px] text-right pr-1 text-t-ghost/40 select-none border-r border-white/[0.04]">
        {line.lineNo}
      </span>
      <span className={`shrink-0 w-[18px] text-center select-none ${signClass}`}>
        {signChar}
      </span>
      <span className={`whitespace-pre pr-4 ${textClass}`}>{line.text}</span>
    </div>
  );
});

// ── 折叠区域按钮 ─────────────────────────────────────────────────────

function CollapsedBlock({ lineCount, onExpand }: { lineCount: number; onExpand: () => void }) {
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-[3px] bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer select-none transition-colors border-y border-white/[0.04]"
      onClick={onExpand}
    >
      <UnfoldVertical size={11} className="text-t-ghost" />
      <span className="text-[11px] text-t-ghost">展开 {lineCount} 行</span>
    </div>
  );
}

// ── 完整 Diff 视图（带折叠段） ───────────────────────────────────────

export function InlineDiffView({ segments: initialSegments }: { segments: DiffSegment[] }) {
  const [segments, setSegments] = useState(initialSegments);

  const handleExpand = useCallback((segIdx: number) => {
    setSegments(prev => {
      const next = [...prev];
      const seg = next[segIdx];
      if (seg.kind === "collapsed") {
        next[segIdx] = { kind: "visible", lines: seg.lines };
      }
      return next;
    });
  }, []);

  return (
    <div className="text-[12px] font-mono leading-[22px] overflow-x-auto max-h-[400px] overflow-y-auto bg-[#0d1117]" style={{ contain: "content", willChange: "transform" }}>
      {segments.map((seg, segIdx) => {
        if (seg.kind === "collapsed") {
          return <CollapsedBlock key={`c${segIdx}`} lineCount={seg.lines.length} onExpand={() => handleExpand(segIdx)} />;
        }
        return (
          <Fragment key={`v${segIdx}`}>
            {seg.lines.map((line, lineIdx) => (
              <DiffLineRow key={lineIdx} line={line} />
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}
