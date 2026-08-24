import { memo } from "react";
import type { TurnFileChange } from "./turnFileChangeUtils";

/** 输入框上方的本轮变更摘要；详细文件列表仍在 assistant 消息内展示。 */
export const TurnFileChangesSummary = memo(function TurnFileChangesSummary({
  changes,
  onReview,
}: {
  changes: TurnFileChange[];
  onReview: () => void;
}) {
  if (changes.length === 0) return null;
  const additions = changes.reduce((total, change) => total + change.additions, 0);
  const deletions = changes.reduce((total, change) => total + change.deletions, 0);

  return (
    <div className="mb-2 flex justify-center">
      <button
        type="button"
        data-testid="turn-file-changes-summary"
        title="审查本轮变更"
        aria-label="审查本轮变更"
        onClick={onReview}
        className="inline-flex h-10 items-center gap-3 rounded-full bg-surface/45 px-4 text-[14px] text-t-secondary shadow-[0_4px_16px_rgba(15,23,42,0.08)] backdrop-blur-md backdrop-saturate-150 transition-colors hover:bg-surface/65"
      >
        <span>{changes.length} 个文件已更改</span>
        <span className="font-mono text-[13px]">
          <span className="text-[#21835f]">+{additions}</span>
          <span className="ml-1.5 text-[#d05959]">-{deletions}</span>
        </span>
      </button>
    </div>
  );
});
