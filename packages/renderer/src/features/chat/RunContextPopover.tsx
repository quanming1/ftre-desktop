/** Header 右上角的会话运行详情弹窗。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  FileDiff,
  GitBranch,
  ArrowUpRight,
  ListChecks,
  ListTodo,
  Loader2,
} from "lucide-react";
import { Icon } from "@iconify/react";
import { Tooltip } from "@ftre/ui";
import { useChat, type ChatMessage, type RetryState } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { useInspector } from "@/stores/inspector";
import { useLayout } from "@/stores/layout";
import { createManagedPoller } from "@/services/visibility-manager";
import type { TurnFileChange } from "./TurnFileChanges";
import { resolveRunningBannerModel } from "./runningBannerModel";

interface GitFile {
  path: string;
  oldPath?: string;
  absolutePath: string;
  status: string;
  staged: boolean;
  isDir: boolean;
  additions?: number;
  deletions?: number;
}

const RUN_CONTEXT_POPOVER_OPEN_KEY = "ftre:run-context-popover-open";

function getPersistedPopoverOpen(): boolean {
  try {
    return localStorage.getItem(RUN_CONTEXT_POPOVER_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

function persistPopoverOpen(open: boolean): void {
  try {
    localStorage.setItem(RUN_CONTEXT_POPOVER_OPEN_KEY, String(open));
  } catch {
    // 存储不可用时保留本次运行的内存状态。
  }
}

export function useRunContextPanelState() {
  const [open, setOpen] = useState(getPersistedPopoverOpen);
  const toggleOpen = useCallback(() => {
    setOpen((value) => {
      const next = !value;
      persistPopoverOpen(next);
      return next;
    });
  }, []);
  return { open, toggleOpen };
}

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
  sessionStatus: "idle" | "running" | "compacting" | "blocked";
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
  return turnStartTs ? "Running" : "空闲";
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

function getActiveTurnId(messages: ChatMessage[], sessionId: string | null): string {
  const userMessage = [...messages].reverse().find((message) => message.role === "user");
  return `${sessionId ?? "pending"}:${userMessage?.id ?? "active"}`;
}

interface RunContextButtonProps {
  open: boolean;
  onToggle: () => void;
}

export function RunContextButton({ open, onToggle }: RunContextButtonProps) {
  const sessionStatus = useChat((state) => state.sessionStatus);
  const sessionActivity = useChat((state) => state.sessionActivity);
  const queueDepth = useChat((state) => state.queueDepth);
  const blockedReason = useChat((state) => state.blockedReason);
  const retryState = useChat((state) => state.retryState);
  const commandName = useChat((state) => state.commandName);
  const turnStartTs = useChat((state) => state.turnStartTs);
  const label = getRunLabel({
    sessionStatus,
    sessionActivity,
    queueDepth,
    blockedReason,
    retryState,
    commandName,
    turnStartTs,
  });
  const isWorking = sessionStatus === "running" || sessionStatus === "compacting";

  return (
    <Tooltip content="运行详情" side="bottom">
      <button
        type="button"
        aria-label={`${label}，${open ? "关闭" : "打开"}运行详情`}
        aria-expanded={open}
        onClick={onToggle}
        className={`relative flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ${
          open ? "bg-black/[0.06] text-t-primary" : "text-t-muted hover:bg-black/[0.04] hover:text-t-primary"
        }`}
      >
        <ListChecks size={15} strokeWidth={1.6} />
        {isWorking && <span aria-hidden="true" className="absolute right-1 top-1 h-1 w-1 rounded-full bg-[#36a177] motion-safe:animate-pulse" />}
      </button>
    </Tooltip>
  );
}

export function RunContextPanel() {
  const messages = useChat((state) => Array.isArray(state.messages) ? state.messages : []);
  const sessionId = useChat((state) => state.sessionId);
  const pendingWorkspace = useChat((state) => state.pendingWorkspace);
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
  const [now, setNow] = useState(() => Date.now());
  const [planExpanded, setPlanExpanded] = useState(false);
  const [workspaceGitInfo, setWorkspaceGitInfo] = useState<{
    branch: string | null;
    isGitRepo: boolean;
  }>({ branch: null, isGitRepo: false });
  const [workspaceGitFiles, setWorkspaceGitFiles] = useState<GitFile[]>([]);

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
  const totalAdditions = fileChanges.reduce((total, change) => total + change.additions, 0);
  const totalDeletions = fileChanges.reduce((total, change) => total + change.deletions, 0);
  const totalGitAdditions = workspaceGitFiles.reduce((total, file) => total + (file.additions ?? 0), 0);
  const totalGitDeletions = workspaceGitFiles.reduce((total, file) => total + (file.deletions ?? 0), 0);
  const sessionWorkspace = useMemo(() => {
    if (!sessionId) return "";
    const findWorkspace = (items: typeof sessions) =>
      items.find((item) => item.session_id === sessionId)?.workspace || "";
    return findWorkspace(sessions) || findWorkspace(allSessions);
  }, [sessionId, sessions, allSessions]);
  const currentGitInfo = workspaceGitInfo;

  useEffect(() => {
    if (!hasRunContext) return;
    setNow(Date.now());
    return createManagedPoller(() => setNow(Date.now()), 1000);
  }, [hasRunContext, turnStartTs]);

  // Git 状态必须跟随会话工作区。Explorer 的 gitService 只缓存侧栏根目录，二者不同时
  // 会导致分支可见、Changes 却丢失；这里复用侧栏的协商轮询策略。
  useEffect(() => {
    if (!sessionWorkspace) {
      setWorkspaceGitInfo({ branch: null, isGitRepo: false });
      setWorkspaceGitFiles([]);
      return;
    }
    let cancelled = false;
    let etag = "";
    let pollCount = 0;

    const refresh = async (force: boolean) => {
      try {
        const [info, result] = await Promise.all([
          window.desktop.git.info(sessionWorkspace),
          window.desktop.git.poll(sessionWorkspace, etag, force),
        ]);
        if (cancelled) return;
        etag = result.etag;
        setWorkspaceGitInfo({ branch: info.branch, isGitRepo: info.isGitRepo });
        if (result.changed) {
          const stats = result.stats ?? {};
          setWorkspaceGitFiles((result.files ?? [])
            .filter((file) => !file.isDir)
            .map((file) => {
              const stat = stats[file.absolutePath.replace(/\\/g, "/").toLowerCase()];
              return {
                ...file,
                additions: stat?.additions ?? 0,
                deletions: stat?.deletions ?? 0,
              };
            }) as GitFile[]);
        }
      } catch {
        if (cancelled) return;
        setWorkspaceGitInfo({ branch: null, isGitRepo: false });
        setWorkspaceGitFiles([]);
      }
    };

    void refresh(true);
    const cancelPoller = createManagedPoller(() => {
      pollCount += 1;
      void refresh(pollCount % 5 === 0);
    }, 1000);
    return () => {
      cancelled = true;
      cancelPoller();
    };
  }, [sessionWorkspace]);

  const openAudit = useCallback((changes?: TurnFileChange[]) => {
    const workspace = sessionWorkspace || pendingWorkspace || "";
    const turnChanges = changes?.map((change) => ({
      toolCallId: change.toolCallId,
      filePath: change.filePath,
      operation: change.operation,
      additions: change.additions,
      deletions: change.deletions,
      before: change.before,
      after: change.after,
    }));
    if (turnChanges?.length) {
      const turnId = getActiveTurnId(messages, sessionId);
      useInspector.getState().openAuditTab(workspace, {
        scope: "turn",
        turnId,
        turnChanges,
      });
    } else {
      useInspector.getState().openAuditTab(workspace, { scope: "workspace" });
    }
    if (!useLayout.getState().panelVisible.inspector) {
      useLayout.getState().togglePanelVisible("inspector");
    }
  }, [messages, pendingWorkspace, sessionId, sessionWorkspace]);

  return (
    <section
      aria-label="运行详情"
      className="animate-in fade-in slide-in-from-top-1 w-full origin-top-right overflow-hidden rounded-2xl bg-surface py-2 shadow-[0_10px_28px_rgba(15,23,42,0.12)] duration-150"
    >
          <div className="flex h-8 items-center px-4">
            <span className="text-[13px] font-medium tracking-[0.01em] text-t-secondary">运行详情</span>
          </div>

          <div className="flex h-9 min-w-0 items-center gap-2 px-4">
            <span className="shrink-0 text-[13px] font-medium text-t-primary">{label}</span>
            {runningDuration && <span className="shrink-0 font-mono text-[11px] tabular-nums text-t-faint">{runningDuration}</span>}
            <span className="min-w-0 flex-1" />
            {model && <span className="max-w-[160px] shrink truncate rounded-[3px] bg-black/[0.045] px-1.5 py-0.5 font-mono text-[11px] leading-none text-t-secondary">{model}</span>}
          </div>

          {planSteps.length > 0 && (
            <div className="px-2.5 pt-1">
              <button type="button" aria-expanded={planExpanded} onClick={() => setPlanExpanded((value) => !value)} className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-black/[0.035] hover:text-t-primary">
                <ListTodo size={14} strokeWidth={1.6} className="shrink-0 text-t-muted" />
                <span className="shrink-0 text-[13px] text-t-secondary">任务</span>
                <span className="min-w-0 flex-1 truncate text-right text-[12px] text-t-primary">{plan?.goal}</span>
                <span className="shrink-0 font-mono text-[11px] text-t-faint">{completedCount}/{planSteps.length}</span>
                <ChevronDown size={13} strokeWidth={1.7} className={`shrink-0 text-t-faint transition-transform duration-150 ${planExpanded ? "rotate-180" : ""}`} />
              </button>
              {planExpanded && <div className="animate-in fade-in slide-in-from-top-1 duration-150 ml-5 max-h-[156px] overflow-y-auto pb-1 pt-0.5">
                {planSteps.map((step) => <div key={step.id} className="flex items-start gap-2 rounded-md px-1.5 py-1 text-[12px]">
                  {step.status === "completed" ? <Check size={13} strokeWidth={1.8} className="mt-0.5 shrink-0 text-[#36a177]" /> : step.status === "in_progress" ? <Loader2 size={13} strokeWidth={1.8} className="mt-0.5 shrink-0 animate-spin text-[#36a177]" /> : <Circle size={13} strokeWidth={1.5} className="mt-0.5 shrink-0 text-t-faint/40" />}
                  <span className={step.status === "completed" ? "text-t-faint line-through" : "text-t-secondary"}>{step.content}</span>
                </div>)}
              </div>}
            </div>
          )}

          {fileChanges.length > 0 && (
            <div className="px-2.5 pt-1">
              <button type="button" aria-label="打开本轮修改审阅" title="打开审阅" onClick={() => openAudit(fileChanges)} className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-black/[0.035] hover:text-t-primary">
                <FileDiff size={14} strokeWidth={1.6} className="shrink-0 text-t-muted" />
                <span className="shrink-0 text-[13px] text-t-secondary">本轮修改</span>
                <span className="rounded-full bg-black/[0.05] px-1.5 py-px font-mono text-[11px] text-t-faint">{fileChanges.length}</span>
                <span className="min-w-0 flex-1" />
                <span className="shrink-0 font-mono text-[11px]"><span className="text-[#21835f]">+{totalAdditions}</span><span className="ml-1 text-[#d05959]">-{totalDeletions}</span></span>
                <ArrowUpRight size={13} strokeWidth={1.7} className="shrink-0 text-t-faint" />
              </button>
            </div>
          )}

          {currentGitInfo.isGitRepo && (
            <div className="px-2.5 pt-1">
              <div className="flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5">
                <GitBranch size={14} strokeWidth={1.6} className="shrink-0 text-t-muted" />
                <span className="shrink-0 text-[13px] text-t-secondary">Git 分支</span>
                <span className="min-w-0 flex-1 truncate text-right font-mono text-[12px] text-t-secondary">{currentGitInfo.branch || "detached HEAD"}</span>
              </div>
            </div>
          )}

          {currentGitInfo.isGitRepo && (
            <div className="px-2.5 pb-1 pt-1">
              <button type="button" aria-label="打开 Changes 审阅" title="打开审阅" onClick={() => openAudit()} className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-black/[0.035] hover:text-t-primary">
                <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
                  <Icon icon="vscode-icons:file-type-git" width={14} height={14} style={{ color: "#f05032" }} />
                </span>
                <span className="shrink-0 text-[13px] text-t-secondary">Changes</span>
                <span className="rounded-full bg-black/[0.05] px-1.5 py-px font-mono text-[11px] text-t-faint">{workspaceGitFiles.length}</span>
                <span className="min-w-0 flex-1" />
                <span className="shrink-0 font-mono text-[11px]">
                  <span className="text-[#21835f]">+{totalGitAdditions}</span>
                  <span className="ml-1 text-[#d05959]">-{totalGitDeletions}</span>
                </span>
                <ArrowUpRight size={13} strokeWidth={1.7} className="shrink-0 text-t-faint" />
              </button>
            </div>
          )}
    </section>
  );
}

/** 兼容独立渲染与组件测试；产品布局会把按钮和面板拆到 Header / 右侧栏。 */
export function RunContextPopover() {
  const { open, toggleOpen } = useRunContextPanelState();
  return (
    <div>
      <RunContextButton open={open} onToggle={toggleOpen} />
      {open && <RunContextPanel />}
    </div>
  );
}

export { collectActiveTurnFileChanges, getActiveTurnId, getRunLabel };
