import { memo, useCallback } from "react";
import { DiffSummaryCard as UiDiffSummaryCard } from "@ftre/ui";
import type { DiffMeta, DiffFileSummary } from "@/types/chat";
import { fetchSnapshotFileDiff, fetchSnapshotFileContent } from "@/services/api";
import { useEditor } from "@/stores/editor";
function toFileSummary(file: DiffFileSummary): {
  file: string;
  additions: number;
  deletions: number;
} {
  return {
    file: file.file,
    additions: file.additions,
    deletions: file.deletions,
  };
}

export const DiffSummaryCard = memo(function DiffSummaryCard({
  diffMeta,
}: {
  diffMeta: DiffMeta;
}) {
  const handleLoadFileDiff = useCallback(
    async (filePath: string) => {
      try {
        const result = await fetchSnapshotFileDiff(
          diffMeta.workspace,
          diffMeta.base_hash,
          diffMeta.final_hash,
          filePath,
        );
        return result?.diff ?? null;
      } catch (error) {
        console.warn("[DiffSummaryCard] 加载文件 Diff 失败", error);
        return null;
      }
    },
    [diffMeta.workspace, diffMeta.base_hash, diffMeta.final_hash],
  );

  const handleOpenFileDiff = useCallback(
    async (filePath: string) => {
      try {
        const result = await fetchSnapshotFileContent(
          diffMeta.workspace,
          diffMeta.base_hash,
          diffMeta.final_hash,
          filePath,
        );
        if (!result) return;
        useEditor.getState().addDiff({
          id: `snapshot-${diffMeta.base_hash.slice(0, 8)}-${filePath}`,
          filePath,
          tabPath: `diff:${filePath}`,
          originalContent: result.before_content,
          newContent: result.after_content,
          toolName: "snapshot",
          isApproximate: false,
        });
      } catch (error) {
        console.warn("[DiffSummaryCard] 打开 Diff 标签失败", error);
      }
    },
    [diffMeta.workspace, diffMeta.base_hash, diffMeta.final_hash],
  );

  return (
    <UiDiffSummaryCard
      diffMeta={{
        files: (diffMeta.files ?? []).map(toFileSummary),
        total_additions: diffMeta.total_additions ?? 0,
        total_deletions: diffMeta.total_deletions ?? 0,
        total_files: diffMeta.total_files ?? (diffMeta.files?.length ?? 0),
      }}
      onLoadFileDiff={handleLoadFileDiff}
      onOpenFileDiff={handleOpenFileDiff}
    />
  );
});
