import { memo, useState, useCallback } from "react";
import { GitCommitVertical, ChevronRight, FileCode, Loader2, ExternalLink } from "lucide-react";
import type { DiffMeta, DiffFileSummary } from "@/types/chat";
import { fetchSnapshotFileDiff, fetchSnapshotFileContent } from "@/services/api";
import { useEditor } from "@/stores/editor";
import { parseUnifiedDiffLines, groupIntoSegments, DiffBar, DiffStats, InlineDiffView, type DiffSegment } from "./diff";

/**
 * 对话变更统计卡片。
 *
 * 挂在 UserMessage 下方，从 diffMeta 读取基本信息。
 * 点击文件行展开时，按需调 /diff/snapshot?format=unified 接口，
 * 后端通过 git diff 直接返回 unified diff 文本，前端只做解析渲染。
 */

// ── 单文件行（可展开） ──────────────────────────────────────────────

const FileRow = memo(function FileRow({
  file,
  diffMeta,
}: {
  file: DiffFileSummary;
  diffMeta: DiffMeta;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [diffSegments, setDiffSegments] = useState<DiffSegment[] | null>(null);

  const fileName = file.file.split(/[\\/]/).pop() || file.file;
  const dirPath = file.file.includes("/") ? file.file.slice(0, file.file.lastIndexOf("/")) : "";

  const handleToggle = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (!diffSegments && !loading) {
      setLoading(true);
      try {
        const result = await fetchSnapshotFileDiff(
          diffMeta.workspace, diffMeta.base_hash, diffMeta.final_hash, file.file,
        );
        if (result) {
          const allLines = parseUnifiedDiffLines(result.diff);
          setDiffSegments(groupIntoSegments(allLines, 3));
        }
      } catch (e) {
        console.warn("[DiffSummaryCard] 加载文件 diff 失败:", e);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(true);
  }, [expanded, diffSegments, loading, diffMeta, file.file]);

  const handleOpenInDiffTab = useCallback(async () => {
    try {
      const result = await fetchSnapshotFileContent(
        diffMeta.workspace, diffMeta.base_hash, diffMeta.final_hash, file.file,
      );
      if (result) {
        useEditor.getState().addDiff({
          id: `snapshot-${diffMeta.base_hash.slice(0, 8)}-${file.file}`,
          filePath: file.file,
          tabPath: `diff:${file.file}`,
          originalContent: result.before_content,
          newContent: result.after_content,
          toolName: "snapshot",
          isApproximate: false,
        });
      }
    } catch (e) {
      console.warn("[DiffSummaryCard] 打开 Diff Tab 失败:", e);
    }
  }, [diffMeta, file.file]);

  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 py-[7px] cursor-pointer hover:bg-white/[0.04] transition-colors group"
        onClick={handleToggle}
      >
        <ChevronRight
          size={11}
          className={`shrink-0 text-t-ghost transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <FileCode size={13} className="shrink-0 text-t-ghost group-hover:text-t-muted transition-colors" />
        <span className="text-[13px] text-t-primary truncate font-sans">{fileName}</span>
        {dirPath && (
          <span className="text-[12px] text-t-ghost truncate font-sans">{dirPath}</span>
        )}
        <div className="flex-1" />
        {loading && <Loader2 size={12} className="animate-spin text-t-ghost shrink-0" />}
        {/* 跳转 Diff Tab 按钮 */}
        <button
          onClick={(e) => { e.stopPropagation(); handleOpenInDiffTab(); }}
          className="shrink-0 p-1 rounded text-t-ghost hover:text-t-secondary hover:bg-white/[0.06] transition-colors opacity-0 group-hover:opacity-100"
          title="在 Diff 编辑器中查看完整文件"
        >
          <ExternalLink size={12} />
        </button>
        <DiffStats additions={file.additions} deletions={file.deletions} />
        <DiffBar additions={file.additions} deletions={file.deletions} />
      </div>

      {expanded && diffSegments && (
        <div className="ml-6 mr-2 mb-1 rounded-md border border-white/[0.06] overflow-hidden">
          <InlineDiffView segments={diffSegments} />
        </div>
      )}
    </div>
  );
});

// ── 主组件 ──────────────────────────────────────────────────────────

export const DiffSummaryCard = memo(function DiffSummaryCard({
  diffMeta,
}: {
  diffMeta: DiffMeta;
}) {
  const { files, total_additions = 0, total_deletions = 0, total_files = 0 } = diffMeta;
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  // diff_meta 可能只有 base_hash（对话进行中或 final 计算失败）
  if (!files || files.length === 0) return null;

  return (
    <div className="text-[13px] font-sans">
      {/* 折叠态标题行 */}
      <div
        className="group flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-white/[0.03] transition-colors"
        onClick={toggle}
      >
        <ChevronRight
          size={12}
          className={`text-t-ghost transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <GitCommitVertical size={14} className="shrink-0 text-t-ghost" />
        <span className="text-t-muted font-mono">changes</span>
        <span className="text-t-dim font-mono truncate">
          {total_files} 个文件
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-[12px] font-mono">
          <span className="text-green-400">+{total_additions}</span>
          <span className="text-red-400">-{total_deletions}</span>
          <DiffBar additions={total_additions} deletions={total_deletions} />
        </div>
      </div>

      {/* 展开态文件列表 */}
      {expanded && (
        <div className="ml-3 border-l border-border-subtle">
          <div className="max-h-[500px] overflow-y-auto">
            {files.map((f) => (
              <FileRow key={f.file} file={f} diffMeta={diffMeta} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
