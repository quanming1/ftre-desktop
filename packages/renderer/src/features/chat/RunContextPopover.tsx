/** Header 右上角的会话运行详情弹窗。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  CircleDot,
  FileDiff,
  FileEdit,
  FilePlus2,
  GitBranch,
  ListFilter,
  ListTodo,
  Loader2,
} from "lucide-react";
import { Tooltip } from "@ftre/ui";
import { useChat, type ChatMessage, type RetryState } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { useInspector } from "@/stores/inspector";
import { useLayout } from "@/stores/layout";
import { useEditor } from "@/stores/editor";
import { useNotification } from "@/stores/notification";
import { createManagedPoller } from "@/services/visibility-manager";
import { gitService, useGitService } from "@/services/git-service";
import { FileIconView } from "@/components/FileIconView";
import type { TurnFileChange } from "./TurnFileChanges";
import { basename } from "@/utils/pathUtils";
import { resolveRunningBannerModel } from "./runningBannerModel";

interface GitFile {
  path: string;
  oldPath?: string;
  absolutePath: string;
  status: string;
  staged: boolean;
  isDir: boolean;
}

const GIT_STATUS_LABELS: Record<string, string> = {
  modified: "M", untracked: "U", deleted: "D", added: "A", renamed: "R", conflict: "C",
};

const GIT_STATUS_COLORS: Record<string, string> = {
  modified: "#b9894b", untracked: "#398565", deleted: "#c75a52",
  added: "#398565", renamed: "#398565", conflict: "#c75a52",
};

function formatRunningDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getRunLabel({
  sessionStatus,
  sessionActivity,
  queueDepth,
  blockedReason,
  retryState,
  commandName,
  turnStartTs,
}: {
  sessionStatus: "idle" | "running" | "compacting";
  sessionActivity: string;
  queueDepth: number;
  blockedReason: string | null;
  retryState: RetryState | null;
  commandName: string | null;
  turnStartTs: number | null;
}): string {
  if (sessionStatus === "compacting") return "Compacting context";
  if (sessionActivity === "cancelling") return "Cancelling current execution";
  if (sessionActivity === "paused") return "Waiting for confirmation";
  if (sessionActivity === "blocked") return blockedReason || "Session blocked";
  if (sessionActivity === "dispatching" && queueDepth > 0) return `Preparing · ${queueDepth} queued`;
  if (sessionActivity === "executing") return "Running";
  if (retryState) return `Retrying ${retryState.attempt}/${retryState.maxAttempts}`;
  if (commandName) return `执行 ${commandName}`;
  return turnStartTs ? "Running" : "Preparing";
}

function collectActiveTurnFileChanges(
  messages: ChatMessage[],
  isBusy: boolean,
): TurnFileChange[] {
  if (!isBusy) return [];
  let turnStart = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") {
      turnStart = index + 1;
      break;
    }
  }

  const fileMap = new Map<string, TurnFileChange>();
  for (let index = turnStart; index < messages.length; index++) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    for (const block of message.blocks ?? []) {
      if (block.type !== "toolCall" || (block.name !== "edit" && block.name !== "write")) continue;
      const result = message.toolResults?.[block.id];
      const metadata = result?.metadata;
      if (result?.status !== "completed" || !metadata?.file || metadata.before === undefined || metadata.after === undefined) continue;

      const key = metadata.file.replace(/\\/g, "/").toLowerCase();
      const existing = fileMap.get(key);
      if (existing) {
        existing.after = metadata.after ?? "";
        existing.additions += metadata.additions ?? 0;
        existing.deletions += metadata.deletions ?? 0;
      } else {
        fileMap.set(key, {
          toolCallId: block.id,
          filePath: metadata.file,
          operation: block.name as "edit" | "write",
          additions: metadata.additions ?? 0,
          deletions: metadata.deletions ?? 0,
          before: metadata.before ?? "",
          after: metadata.after ?? "",
        });
      }
    }
  }
  return Array.from(fileMap.values());
}

export function RunContextPopover() {
  const messages = useChat((state) => state.messages);
  const sessionId = useChat((state) => state.sessionId);
  const isBusy = useChat((state) => state.isBusy);
  const sessionStatus = useChat((state) => state.sessionStatus);
  const sessionActivity = useChat((state) => state.sessionActivity);
  const queueDepth = useChat((state) => state.queueDepth);
  const blockedReason = useChat((state) => state.blockedReason);
  const turnStartTs = useChat((state) => state.turnStartTs);
  const plan = useChat((state) => state.plan);
  const storeModel = useChat((state) => state.model);
  const retryState = useChat((state) => state.retryState);
  const commandName = useChat((state) => state.commandName);
  const sessions = useSession((state) => state.sessions);
  const allSessions = useSession((state) => state.allSessions);
  const gitFiles = useGitService((service) => service.getFiles()) as GitFile[];
  const gitInfo = useGitService((service) => service.getInfo());
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [planExpanded, setPlanExpanded] = useState(false);
  const [changesExpanded, setChangesExpanded] = useState(false);
  const [gitExpanded, setGitExpanded] = useState(false);
  const [workspaceGitInfo, setWorkspaceGitInfo] = useState<{
    branch: string | null;
    isGitRepo: boolean;
  } | null>(null);

  const hasRunContext = isBusy || sessionStatus !== "idle" || turnStartTs != null;
  const runningDuration = turnStartTs ? formatRunningDuration(now - turnStartTs) : null;
  const model = useMemo(
    () => resolveRunningBannerModel({ isBusy, sessionStatus, messages, storeModel }),
    [isBusy, sessionStatus, messages, storeModel],
  );
  const label = getRunLabel({
    sessionStatus,
    sessionActivity,
    queueDepth,
    blockedReason,
    retryState,
    commandName,
    turnStartTs,
  });
  const fileChanges = useMemo(
    () => collectActiveTurnFileChanges(messages, isBusy),
    [messages, isBusy],
  );
  const planSteps = plan?.steps ?? [];
  const completedCount = planSteps.filter((step) => step.status === "completed").length;
  const progress = planSteps.length > 0 ? (completedCount / planSteps.length) * 100 : 0;
  const totalAdditions = fileChanges.reduce((total, change) => total + change.additions, 0);
  const totalDeletions = fileChanges.reduce((total, change) => total + change.deletions, 0);
  const stagedGitFiles = gitFiles.filter((file) => file.staged);
  const unstagedGitFiles = gitFiles.filter((file) => !file.staged);
  const sessionWorkspace = useMemo(() => {
    if (!sessionId) return "";
    const findWorkspace = (items: typeof sessions) =>
      items.find((item) => item.session_id === sessionId)?.workspace || "";
    return findWorkspace(sessions) || findWorkspace(allSessions);
  }, [sessionId, sessions, allSessions]);
  const currentGitInfo = workspaceGitInfo ?? gitInfo;

  useEffect(() => {
    if (!hasRunContext) return;
    setNow(Date.now());
    return createManagedPoller(() => setNow(Date.now()), 1000);
  }, [hasRunContext, turnStartTs]);

  useEffect(() => {
    if (!hasRunContext) setOpen(false);
  }, [hasRunContext]);

  // 分支沿用输入框原来的 session workspace 查询，避免 Explorer 根目录与会话工作区不同时显示错分支。
  useEffect(() => {
    if (!sessionWorkspace) {
      setWorkspaceGitInfo(null);
      return;
    }
    let cancelled = false;
    const request = window.desktop?.git?.info?.(sessionWorkspace);
    if (!request) {
      setWorkspaceGitInfo(null);
      return;
    }
    request
      .then((info) => {
        if (!cancelled) setWorkspaceGitInfo({ branch: info.branch, isGitRepo: info.isGitRepo });
      })
      .catch(() => {
        if (!cancelled) setWorkspaceGitInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionWorkspace]);

  const openDiff = useCallback((change: TurnFileChange) => {
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

  const openGitDiff = useCallback(async (file: GitFile) => {
    if (file.isDir) return;
    const result = await gitService.diffFile(file);
    if (result.error) {
      useNotification.getState().addNotification({
        level: "error",
        message: `加载 Git Diff 失败：${file.path}`,
      });
      return;
    }
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

  if (!hasRunContext) return null;

  const isWorking = sessionStatus === "running" || sessionStatus === "compacting";
  return (
    <div className="relative">
      <Tooltip content="运行详情" side="bottom">
        <button
          type="button"
          aria-label={`${label}，${open ? "关闭" : "打开"}运行详情`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150 ${
            open ? "bg-black/[0.06] text-t-primary" : "text-t-muted hover:bg-black/[0.04] hover:text-t-primary"
          }`}
        >
          <ListFilter size={15} strokeWidth={1.6} />
          {isWorking && <span aria-hidden="true" className="absolute right-1 top-1 h-1 w-1 rounded-full bg-[#36a177] motion-safe:animate-pulse" />}
        </button>
      </Tooltip>

      {open && (
        <section
          aria-label="运行详情"
          className="animate-in fade-in slide-in-from-top-1 duration-150 absolute right-0 top-full z-40 mt-2 w-[320px] origin-top-right overflow-hidden rounded-[18px] border border-border-subtle bg-surface py-1.5 shadow-[0_5px_18px_rgba(15,23,42,0.10)]"
        >
          <div className="flex h-9 items-center px-3.5">
            <span className="text-[13px] font-medium text-t-muted">运行详情</span>
          </div>

          <div className="flex h-9 min-w-0 items-center gap-2 px-3.5">
            {isWorking ? <Loader2 size={13} strokeWidth={1.7} className="shrink-0 animate-spin text-[#36a177]" /> : <CircleDot size={13} strokeWidth={1.7} className="shrink-0 text-t-muted" />}
            <span className="shrink-0 text-[12px] text-t-secondary">状态</span>
            <span className="shrink-0 text-[12px] text-t-primary">{label}</span>
            {runningDuration && <span className="shrink-0 font-mono text-[10px] tabular-nums text-t-faint">{runningDuration}</span>}
            {model && <>
              <span aria-hidden="true" className="h-3 w-px shrink-0 bg-black/[0.07]" />
              <span className="shrink-0 text-[12px] text-t-secondary">模型</span>
              <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-t-primary">{model}</span>
            </>}
          </div>

          {planSteps.length > 0 && (
            <div className="border-t border-black/[0.045] px-3.5 py-1">
              <button type="button" aria-expanded={planExpanded} onClick={() => setPlanExpanded((value) => !value)} className="flex h-8 w-full items-center gap-2 text-left transition-colors hover:text-t-primary">
                <ListTodo size={14} strokeWidth={1.6} className="shrink-0 text-t-muted" />
                <span className="shrink-0 text-[12px] text-t-secondary">任务</span>
                <span className="min-w-0 flex-1 truncate text-right text-[11px] text-t-primary">{plan?.goal}</span>
                <span className="shrink-0 font-mono text-[10px] text-t-faint">{completedCount}/{planSteps.length}</span>
                <ChevronDown size={13} strokeWidth={1.7} className={`shrink-0 text-t-faint transition-transform duration-150 ${planExpanded ? "rotate-180" : ""}`} />
              </button>
              <div className="ml-[22px] mb-1 h-px overflow-hidden bg-black/[0.08]"><div className="h-full bg-[#36a177] transition-all duration-300" style={{ width: `${progress}%` }} /></div>
              {planExpanded && <div className="animate-in fade-in slide-in-from-top-1 duration-150 max-h-[156px] overflow-y-auto py-1">
                {planSteps.map((step) => <div key={step.id} className="flex items-start gap-2 px-1 py-1 text-[11px]">
                  {step.status === "completed" ? <Check size={13} strokeWidth={1.8} className="mt-0.5 shrink-0 text-[#36a177]" /> : step.status === "in_progress" ? <Loader2 size={13} strokeWidth={1.8} className="mt-0.5 shrink-0 animate-spin text-[#36a177]" /> : <Circle size={13} strokeWidth={1.5} className="mt-0.5 shrink-0 text-t-faint/40" />}
                  <span className={step.status === "completed" ? "text-t-faint line-through" : "text-t-secondary"}>{step.content}</span>
                </div>)}
              </div>}
            </div>
          )}

          {fileChanges.length > 0 && (
            <div className="border-t border-black/[0.045] px-3.5 py-1">
              <button type="button" aria-expanded={changesExpanded} onClick={() => setChangesExpanded((value) => !value)} className="flex h-8 w-full items-center gap-2 text-left transition-colors hover:text-t-primary">
                <FileDiff size={14} strokeWidth={1.6} className="shrink-0 text-t-muted" />
                <span className="shrink-0 text-[12px] text-t-secondary">文件变更</span>
                <span className="rounded-full bg-black/[0.05] px-1.5 py-px font-mono text-[10px] text-t-faint">{fileChanges.length}</span>
                <span className="min-w-0 flex-1" />
                <span className="shrink-0 font-mono text-[10px]"><span className="text-[#21835f]">+{totalAdditions}</span><span className="ml-1 text-[#d05959]">-{totalDeletions}</span></span>
                <ChevronDown size={13} strokeWidth={1.7} className={`shrink-0 text-t-faint transition-transform duration-150 ${changesExpanded ? "rotate-180" : ""}`} />
              </button>
              {changesExpanded && <div className="animate-in fade-in slide-in-from-top-1 duration-150 max-h-[156px] overflow-y-auto py-1">
                {fileChanges.map((change) => <button key={change.toolCallId} type="button" onClick={() => openDiff(change)} className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-black/[0.04]">
                  <FileIconView path={change.filePath} size={14} />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-t-primary">{basename(change.filePath)}</span>
                  <span className="shrink-0 text-[10px] text-t-faint">{change.operation === "write" ? <FilePlus2 size={12} strokeWidth={1.6} /> : <FileEdit size={12} strokeWidth={1.6} />}</span>
                  <span className="shrink-0 font-mono text-[10px]"><span className="text-[#21835f]">+{change.additions}</span><span className="ml-1 text-[#d05959]">-{change.deletions}</span></span>
                </button>)}
              </div>}
            </div>
          )}

          {currentGitInfo.isGitRepo && (
            <div className="border-t border-black/[0.045] px-3.5 py-1">
              <div className="flex h-8 min-w-0 items-center gap-2">
                <GitBranch size={14} strokeWidth={1.6} className="shrink-0 text-t-muted" />
                <span className="shrink-0 text-[12px] text-t-secondary">Git 分支</span>
                <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-t-primary">{currentGitInfo.branch || "detached HEAD"}</span>
              </div>
            </div>
          )}

          {gitInfo.isGitRepo && (
            <div className="border-t border-black/[0.045] px-3.5 py-1">
              <button type="button" aria-expanded={gitExpanded} onClick={() => setGitExpanded((value) => !value)} className="flex h-8 w-full items-center gap-2 text-left transition-colors hover:text-t-primary">
                <FileDiff size={14} strokeWidth={1.6} className="shrink-0 text-t-muted" />
                <span className="shrink-0 text-[12px] text-t-secondary">Git 变更</span>
                <span className="rounded-full bg-black/[0.05] px-1.5 py-px font-mono text-[10px] text-t-faint">{gitFiles.length}</span>
                <span className="min-w-0 flex-1" />
                {stagedGitFiles.length > 0 && <span className="shrink-0 text-[10px] text-t-faint">暂存 {stagedGitFiles.length}</span>}
                {unstagedGitFiles.length > 0 && <span className="shrink-0 text-[10px] text-t-faint">更改 {unstagedGitFiles.length}</span>}
                <ChevronDown size={13} strokeWidth={1.7} className={`shrink-0 text-t-faint transition-transform duration-150 ${gitExpanded ? "rotate-180" : ""}`} />
              </button>
              {gitExpanded && <div className="animate-in fade-in slide-in-from-top-1 duration-150 max-h-[156px] overflow-y-auto py-1">
                {gitFiles.length === 0 ? (
                  <span className="block px-1 py-1 text-[11px] text-t-faint">没有变更</span>
                ) : gitFiles.map((file) => (
                  <button key={`${file.path}:${file.staged}`} type="button" disabled={file.isDir} onClick={() => void openGitDiff(file)} className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-black/[0.04] disabled:cursor-default disabled:hover:bg-transparent">
                    <span className="w-3 shrink-0 text-center font-mono text-[10px] font-medium" style={{ color: GIT_STATUS_COLORS[file.status] ?? "#89919a" }}>{GIT_STATUS_LABELS[file.status] ?? "?"}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-t-primary">{file.path}{file.isDir ? "/" : ""}</span>
                    {file.staged && <span className="shrink-0 text-[10px] text-t-faint">暂存</span>}
                  </button>
                ))}
              </div>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export { collectActiveTurnFileChanges, getRunLabel };
