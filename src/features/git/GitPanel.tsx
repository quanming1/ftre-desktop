import { useState, useCallback } from "react";
import { RefreshCw, Check, Plus, Minus } from "lucide-react";
import { useEditor } from "@/stores/editor";
import { gitService, useGitService } from "@/services/git-service";


interface GitFile {
  path: string;
  oldPath?: string;
  absolutePath: string;
  status: "modified" | "untracked" | "deleted" | "added" | "renamed" | "conflict";
  staged: boolean;
  isDir: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  modified: "M",
  untracked: "U",
  deleted: "D",
  added: "A",
  renamed: "R",
  conflict: "C",
};

const STATUS_COLORS: Record<string, string> = {
  modified: "text-yellow-400",
  untracked: "text-green-400",
  deleted: "text-red-400",
  added: "text-green-400",
  renamed: "text-green-400",
  conflict: "text-red-500",
};

export function GitPanel() {
  const files = useGitService((s) => s.getFiles()) as GitFile[];
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);

  const handleStage = useCallback(async (filePath: string) => {
    await gitService.stage(filePath);
  }, []);

  const handleUnstage = useCallback(async (filePath: string) => {
    await gitService.unstage(filePath);
  }, []);

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    try {
      const result = await gitService.commit(commitMsg.trim());
      if (result.success) setCommitMsg("");
    } finally {
      setCommitting(false);
    }
  }, [commitMsg]);

  const handleFileClick = useCallback(async (file: GitFile) => {
    if (file.isDir) return;
    const result = await gitService.diffFile(file);
    if (result.error) return;

    useEditor.getState().addDiff({
      id: `git-diff:${file.absolutePath}`,
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

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-[11px] text-t-secondary font-mono uppercase tracking-wider">源代码管理</span>
        <button onClick={() => gitService.refreshAll()} className="text-t-muted hover:text-t-primary" aria-label="刷新 Git 状态">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Commit input */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          placeholder="提交信息"
          className="w-full bg-base border border-border rounded px-2 py-1.5 text-[11px] text-t-primary font-mono resize-none focus:outline-none focus:border-accent"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleCommit();
            }
          }}
        />
        <button
          onClick={handleCommit}
          disabled={!commitMsg.trim() || committing || stagedFiles.length === 0}
          className="mt-1.5 w-full flex items-center justify-center gap-1.5 bg-accent hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-mono py-1.5 rounded transition-colors"
        >
          <Check size={12} />
          <span>提交{stagedFiles.length > 0 ? ` (${stagedFiles.length})` : ""}</span>
        </button>
      </div>

      {/* File lists */}
      <div className="flex-1 overflow-y-auto">
        {/* Staged changes */}
        {stagedFiles.length > 0 && (
          <FileSection
            title={`已暂存的更改 (${stagedFiles.length})`}
            files={stagedFiles}
            onFileClick={handleFileClick}
            actionIcon="unstage"
            onAction={handleUnstage}
          />
        )}

        {/* Unstaged changes */}
        {unstagedFiles.length > 0 && (
          <FileSection
            title={`更改 (${unstagedFiles.length})`}
            files={unstagedFiles}
            onFileClick={handleFileClick}
            actionIcon="stage"
            onAction={handleStage}
          />
        )}

        {files.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <span className="text-[11px] text-t-muted font-mono">未检测到更改</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface FileSectionProps {
  title: string;
  files: GitFile[];
  onFileClick: (file: GitFile) => void;
  actionIcon: "stage" | "unstage";
  onAction: (filePath: string) => void;
}

function FileSection({ title, files, onFileClick, actionIcon, onAction }: FileSectionProps) {
  return (
    <div>
      <div className="px-3 py-1.5 text-[10px] text-t-muted font-mono uppercase tracking-wider bg-base/50">{title}</div>
      {files.map((file) => (
        <div
          key={file.path}
          className="group flex items-center gap-1.5 px-3 py-1 hover:bg-white/[0.04] cursor-pointer"
          onClick={() => onFileClick(file)}
        >
          <span className={`text-[10px] font-mono w-3 shrink-0 ${STATUS_COLORS[file.status]}`}>{STATUS_LABELS[file.status]}</span>
          <span className="text-[11px] text-t-secondary font-mono truncate flex-1" title={file.path}>
            {file.path.split("/").pop()}
          </span>
          <span className="text-[9px] text-t-dim font-mono truncate max-w-[120px]" title={file.path}>
            {file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAction(file.path);
            }}
            className="opacity-0 group-hover:opacity-100 text-t-muted hover:text-t-primary transition-all shrink-0"
            aria-label={actionIcon === "stage" ? "暂存文件" : "取消暂存"}
          >
            {actionIcon === "stage" ? <Plus size={14} /> : <Minus size={14} />}
          </button>
        </div>
      ))}
    </div>
  );
}
