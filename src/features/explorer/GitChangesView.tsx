import { useState, useCallback, memo } from "react";
import { Plus, Minus, Check, Folder } from "lucide-react";
import { useEditor } from "@/stores/editor";
import { gitService, useGitService } from "@/services/git-service";

/**
 * Git 变更文件列表 — 嵌入 ExplorerView 的轻量 git 视图。
 *
 * 通过 gitService 单例获取数据和执行操作。
 * 用 useGitService hook 订阅变更，fingerprint 防闪烁在 service 层已处理。
 */

interface GitFile {
  path: string;
  oldPath?: string;
  absolutePath: string;
  status: string;
  staged: boolean;
  isDir: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  modified: "M", untracked: "U", deleted: "D", added: "A", renamed: "R", conflict: "C",
};

const STATUS_COLORS: Record<string, string> = {
  modified: "#e2c08d", untracked: "#73c991", deleted: "#c74e39",
  added: "#73c991", renamed: "#73c991", conflict: "#e4676b",
};

export function GitChangesView({ visible }: { visible: boolean }) {
  const files = useGitService((s) => s.getFiles()) as GitFile[];
  const [stagedCollapsed, setStagedCollapsed] = useState(false);
  const [unstagedCollapsed, setUnstagedCollapsed] = useState(false);

  const handleStage = useCallback(async (filePath: string) => {
    await gitService.stage(filePath);
  }, []);

  const handleUnstage = useCallback(async (filePath: string) => {
    await gitService.unstage(filePath);
  }, []);

  const handleStageAll = useCallback(async () => {
    const unstaged = gitService.getFiles().filter((f) => !f.staged);
    await gitService.stageAll(unstaged);
  }, []);

  const handleUnstageAll = useCallback(async () => {
    const staged = gitService.getFiles().filter((f) => f.staged);
    await gitService.unstageAll(staged);
  }, []);

  const handleFileClick = useCallback(async (file: GitFile) => {
    if (file.isDir) return;
    const result = await gitService.diffFile(file);
    if (result.error) return;

    useEditor.getState().addDiff({
      id: `git-change:${file.absolutePath}`,
      filePath: file.absolutePath,
      tabPath: `diff:${file.absolutePath}`,
      originalContent: result.original,
      newContent: result.modified,
      toolName: "Git",
      isApproximate: false,
    });
  }, []);

  const stagedFiles = files.filter((f) => f.staged);
  const unstagedFiles = files.filter((f) => !f.staged);

  if (!visible) return null;

  return (
    <div className="flex-1 overflow-y-auto" style={{ willChange: "transform", contain: "layout style" }}>
      {files.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Check size={20} className="text-green-400/60" />
          <span className="text-[12px] text-t-ghost font-sans">没有变更</span>
        </div>
      )}

      {stagedFiles.length > 0 && (
        <FileGroup
          title="已暂存的更改"
          count={stagedFiles.length}
          collapsed={stagedCollapsed}
          onToggle={() => setStagedCollapsed((v) => !v)}
          batchAction={{ icon: <Minus size={14} />, label: "全部取消暂存", onClick: handleUnstageAll }}
          files={stagedFiles}
          onFileClick={handleFileClick}
          fileAction={{ type: "unstage", onClick: handleUnstage }}
        />
      )}

      {unstagedFiles.length > 0 && (
        <FileGroup
          title="更改"
          count={unstagedFiles.length}
          collapsed={unstagedCollapsed}
          onToggle={() => setUnstagedCollapsed((v) => !v)}
          batchAction={{ icon: <Plus size={14} />, label: "全部暂存", onClick: handleStageAll }}
          files={unstagedFiles}
          onFileClick={handleFileClick}
          fileAction={{ type: "stage", onClick: handleStage }}
        />
      )}
    </div>
  );
}

// ── FileGroup ──

interface FileGroupProps {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  batchAction: { icon: React.ReactNode; label: string; onClick: () => void };
  files: GitFile[];
  onFileClick: (file: GitFile) => void;
  fileAction: { type: "stage" | "unstage"; onClick: (path: string) => void };
}

function FileGroup({ title, count, collapsed, onToggle, batchAction, files, onFileClick, fileAction }: FileGroupProps) {
  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 h-[30px] cursor-pointer hover:bg-white/[0.03] select-none group"
        onClick={onToggle}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className={`shrink-0 text-t-ghost ${collapsed ? "" : "rotate-90"}`}>
          <path d="M3 1 L7 5 L3 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[13px] text-t-muted font-sans flex-1">{title} ({count})</span>
        <button
          onClick={(e) => { e.stopPropagation(); batchAction.onClick(); }}
          className="p-1 rounded text-t-ghost hover:text-t-secondary hover:bg-white/[0.06] opacity-0 group-hover:opacity-100"
          title={batchAction.label}
        >{batchAction.icon}</button>
      </div>
      {!collapsed && files.map((file) => (
        <FileRow key={`${file.path}:${file.staged}`} file={file} onFileClick={onFileClick} actionType={fileAction.type} onAction={fileAction.onClick} />
      ))}
    </div>
  );
}

// ── FileRow ──

const FileRow = memo(function FileRow({
  file, onFileClick, actionType, onAction,
}: {
  file: GitFile; onFileClick: (file: GitFile) => void;
  actionType: "stage" | "unstage"; onAction: (path: string) => void;
}) {
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
  const statusColor = STATUS_COLORS[file.status] ?? "#ccc";

  return (
    <div
      className={`flex items-center gap-2 px-3 h-[28px] cursor-pointer hover:bg-white/[0.04] group ${file.isDir ? "opacity-80" : ""}`}
      onClick={() => onFileClick(file)}
    >
      <span className="text-[12px] font-mono w-4 shrink-0 text-center font-semibold" style={{ color: statusColor }}>
        {STATUS_LABELS[file.status]}
      </span>
      {file.isDir && <Folder size={14} className="shrink-0 text-t-ghost" />}
      <span className="text-[13px] text-t-primary font-sans truncate">{fileName}{file.isDir ? "/" : ""}</span>
      {file.oldPath && <span className="text-[11px] text-t-ghost font-sans truncate">← {file.oldPath.split("/").pop()}</span>}
      {dirPath && !file.oldPath && <span className="text-[12px] text-t-ghost font-sans truncate flex-1 min-w-0">{dirPath}</span>}
      {!file.isDir && (
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 ml-auto">
          <button
            onClick={(e) => { e.stopPropagation(); onAction(file.path); }}
            className="p-1 rounded text-t-ghost hover:text-t-secondary hover:bg-white/[0.06]"
            title={actionType === "stage" ? "暂存" : "取消暂存"}
          >{actionType === "stage" ? <Plus size={16} /> : <Minus size={16} />}</button>
        </div>
      )}
    </div>
  );
});
