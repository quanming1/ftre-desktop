/**
 * TurnFileChanges — 本轮修改的所有文件表格
 *
 * 在每轮 assistant 回复结束时，收集本轮所有 edit/write 工具调用，
 * 以表格形式展示文件名、操作类型、增删行数。
 * 点击行打开 Inspector diff 预览。
 */
import { memo, useCallback, useMemo, useState } from "react";
import { ChevronDown, ClipboardCheck } from "lucide-react";
import { useInspector } from "@/stores/inspector";
import { useLayout } from "@/stores/layout";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { FileIconView } from "@/components/FileIconView";
import { basename } from "@/utils/pathUtils";
import type { TurnFileChange } from "./turnFileChangeUtils";

export const TurnFileChanges = memo(function TurnFileChanges({
  changes,
  turnId,
}: {
  changes: TurnFileChange[];
  /** 该消息代表的完整轮次身份，用于审阅 Tab 去重。 */
  turnId?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const sessionId = useChat((state) => state.sessionId);
  const sessions = useSession((state) => state.sessions);
  const allSessions = useSession((state) => state.allSessions);
  const workspace = useMemo(() => {
    if (!sessionId) return "";
    return sessions.find((session) => session.session_id === sessionId)?.workspace
      || allSessions.find((session) => session.session_id === sessionId)?.workspace
      || "";
  }, [allSessions, sessionId, sessions]);

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
  const visibleChanges = showAll ? changes : changes.slice(0, 3);
  const handleReview = useCallback(() => {
    useInspector.getState().openAuditTab(workspace, {
      scope: "turn",
      turnId,
      turnChanges: changes,
    });
    if (!useLayout.getState().panelVisible.inspector) {
      useLayout.getState().togglePanelVisible("inspector");
    }
  }, [changes, turnId, workspace]);

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border-subtle bg-surface">
      <div className="flex min-w-0 items-center gap-2 bg-hover/35 px-2.5 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap">
          <span className="truncate text-[12px] font-medium leading-4 text-t-primary">已编辑 {changes.length} 个文件</span>
          <span className="shrink-0 font-mono text-[10px] leading-4">
            <span className="text-[#21835f]">+{totalAdd}</span>
            <span className="ml-1 text-[#d05959]">-{totalDel}</span>
          </span>
        </div>
        <button
          type="button"
          title="审查本轮变更"
          aria-label="审查本轮变更"
          onClick={handleReview}
          className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-border-subtle px-2 text-[11px] text-t-secondary transition-colors hover:bg-hover hover:text-t-primary"
        >
          <ClipboardCheck size={12} />
          <span>审查</span>
        </button>
      </div>
      <div className="border-t border-border-subtle/80">
        {visibleChanges.map((c) => {
          const normalizedPath = c.filePath.replace(/\\/g, "/");
          const fileName = basename(normalizedPath);
          const directory = normalizedPath.slice(0, Math.max(0, normalizedPath.length - fileName.length));
          return (
            <button
              key={c.toolCallId}
              type="button"
              title={c.filePath}
              onClick={() => handleClick(c)}
              className="flex min-h-8 w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-hover"
            >
              <FileIconView path={c.filePath} size={14} />
              <span className="flex min-w-0 flex-1 items-baseline truncate text-t-primary">
                <span className="shrink-0">{fileName}</span>
                {directory && <span className="ml-1 truncate text-[10px] text-t-faint">{directory}</span>}
              </span>
              <span className="shrink-0 font-mono text-[10px]">
                <span className="text-[#21835f]">+{c.additions}</span>
                <span className="ml-1 text-[#d05959]">-{c.deletions}</span>
              </span>
            </button>
          );
        })}
      </div>
      {changes.length > 3 && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="flex h-7 w-full items-center gap-1 border-t border-border-subtle/80 px-2.5 text-left text-[11px] text-t-secondary transition-colors hover:bg-hover hover:text-t-primary"
        >
          <span>{showAll ? "收起文件" : `再显示 ${changes.length - 3} 个文件`}</span>
          <ChevronDown size={12} className={`text-t-ghost transition-transform ${showAll ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
});
