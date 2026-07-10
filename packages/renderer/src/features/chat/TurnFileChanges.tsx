/**
 * TurnFileChanges — 本轮修改的所有文件表格
 *
 * 在每轮 assistant 回复结束时，收集本轮所有 edit/write 工具调用，
 * 以表格形式展示文件名、操作类型、增删行数。
 * 点击行打开 Inspector diff 预览。
 */
import { memo, useCallback } from "react";
import { FileEdit, FilePlus2 } from "lucide-react";
import { FileIconView } from "@/components/FileIconView";
import { useInspector } from "@/stores/inspector";
import { useLayout } from "@/stores/layout";
import { basename } from "@/utils/pathUtils";

export interface TurnFileChange {
  toolCallId: string;
  filePath: string;
  operation: "edit" | "write";
  additions: number;
  deletions: number;
  before: string;
  after: string;
}

export const TurnFileChanges = memo(function TurnFileChanges({
  changes,
}: {
  changes: TurnFileChange[];
}) {
  const handleClick = useCallback((change: TurnFileChange) => {
    useInspector.getState().openDiffPreview(
      change.toolCallId,
      change.filePath,
      change.before,
      change.after,
      change.additions,
      change.deletions,
    );
    if (!useLayout.getState().panelVisible.inspector) {
      useLayout.getState().togglePanelVisible("inspector");
    }
  }, []);

  const totalAdd = changes.reduce((s, c) => s + c.additions, 0);
  const totalDel = changes.reduce((s, c) => s + c.deletions, 0);

  return (
    <div className="mt-3 rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-elevated/50 text-[12px] font-medium text-t-secondary">
        <span>本轮变更</span>
        <span className="text-t-faint">{changes.length}</span>
        <span className="ml-auto flex items-center gap-2 font-mono text-[11px]">
          <span className="text-green-600 dark:text-green-400">+{totalAdd}</span>
          <span className="text-red-500 dark:text-red-400">-{totalDel}</span>
        </span>
      </div>
      <div className="divide-y divide-border/50">
        {changes.map((c) => (
          <button
            key={c.toolCallId}
            onClick={() => handleClick(c)}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[12px] hover:bg-hover transition-colors group"
          >
            <FileIconView path={c.filePath} size={15} />
            <span className="truncate text-t-primary group-hover:text-t-primary">
              {basename(c.filePath)}
            </span>
            <span className="truncate text-t-faint text-[11px] flex-1">
              {c.filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/")}
            </span>
            <span className="shrink-0 inline-flex items-center gap-1 text-t-faint">
              {c.operation === "write" ? (
                <FilePlus2 size={12} />
              ) : (
                <FileEdit size={12} />
              )}
              <span className="text-[10px] uppercase tracking-wide">
                {c.operation === "write" ? "new" : "edit"}
              </span>
            </span>
            <span className="shrink-0 font-mono text-[11px] flex items-center gap-1.5 min-w-[70px] justify-end">
              {c.additions > 0 && (
                <span className="text-green-600 dark:text-green-400">+{c.additions}</span>
              )}
              {c.deletions > 0 && (
                <span className="text-red-500 dark:text-red-400">-{c.deletions}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
});
