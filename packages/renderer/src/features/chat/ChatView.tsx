/**
 * ChatView — Chat message list + input.
 *
 * Single component used in both App and Storybook.
 * Internally handles data source fallback:
 * - Tries zustand store first (useChat)
 * - Falls back to streamManager directly if store is empty/unavailable
 */
import { useState, useEffect, useMemo } from "react";
import { Loader2, FileEdit, FilePlus2, ChevronDown, Check, Circle, Target } from "lucide-react";
import { useChat, type RetryState, type PlanData } from "@/stores/chat";
import type { MailboxItemPayload } from "@/services/websocket-client";
import { useSession } from "@/stores/session";
import { wsClient } from "@/services/websocket-client";
import { createManagedPoller } from "@/services/visibility-manager";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";
import { QueuedMessagesBanner } from "./QueuedMessagesBanner";
import { WelcomeView } from "./WelcomeView";
import { FileIconView } from "@/components/FileIconView";
import { useInspector } from "@/stores/inspector";
import { useLayout } from "@/stores/layout";
import type { TurnFileChange } from "./TurnFileChanges";
import { basename } from "@/utils/pathUtils";
import { resolveRunningBannerModel } from "./runningBannerModel";

function formatRunningDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// ─── Component ──────────────────────────────────────────────────────

export function ChatView() {
  const messages = useChat((s) => s.messages);
  const isBusy = useChat((s) => s.isBusy);
  const sessionStatus = useChat((s) => s.sessionStatus);
  const sessionActivity = useChat((s) => s.sessionActivity);
  const queueDepth = useChat((s) => s.queueDepth);
  const blockedReason = useChat((s) => s.blockedReason);
  const turnStartTs = useChat((s) => s.turnStartTs);
  const plan = useChat((s) => s.plan);
  const storeModel = useChat((s) => s.model);
  const retryState = useChat((s) => s.retryState);
  const commandName = useChat((s) => s.commandName);
  // 所有待执行消息都先显示在横幅；后端真正写入 UserMsg 的实时回显到达后，
  // 才进入 messages 聊天历史。因此这里不需要把同一条消息在两种 UI 间搬运。
  const pendingMessages = useChat((s) => s.pendingMessages);
  const conversationMessages = messages;
  useEffect(() => {
    if (!wsClient.connected) wsClient.connect();
  }, []);

  // 只有 WebSocket 会话允许在当前聊天界面继续发送消息。
  const sessionId = useChat((s) => s.sessionId);
  const allSessions = useSession((s) => s.allSessions);
  const currentSessionChannel = useMemo(() => {
    if (!sessionId) return "ws";
    const found = allSessions.find(
      (s) => s.session_id === sessionId || s.key?.includes(sessionId),
    );
    return found?.channel || "ws";
  }, [sessionId, allSessions]);
  const canSend = currentSessionChannel === "ws";

  // 切换 Session 时的历史消息加载状态。
  const loadingSessionId = useSession((s) => s.loadingSessionId);
  const isSessionLoading = loadingSessionId != null;
  const [now, setNow] = useState(() => Date.now());
  const [runningBannerVisible, setRunningBannerVisible] = useState(false);
  const [runningBannerExiting, setRunningBannerExiting] = useState(false);
  const runningDuration = turnStartTs
    ? formatRunningDuration(now - turnStartTs)
    : null;
  const shouldShowRunningBanner = (
    sessionStatus === "running"
    || sessionStatus === "compacting"
    || pendingMessages.length > 0
  ) && canSend;

  const runningModel = useMemo(
    () => resolveRunningBannerModel({
      isBusy,
      sessionStatus,
      messages: conversationMessages,
      storeModel,
    }),
    [isBusy, sessionStatus, conversationMessages, storeModel],
  );

  const bannerLabel = sessionStatus === "compacting"
    ? "Compacting context"
    : sessionActivity === "cancelling"
      ? "Cancelling current execution"
      : sessionActivity === "paused"
        ? "Waiting for confirmation"
        : sessionActivity === "blocked"
          ? blockedReason || "Session blocked"
          : sessionActivity === "dispatching" && queueDepth > 0
            ? `Preparing · ${queueDepth} queued`
            : sessionActivity === "executing"
              ? "Running"
    : retryState
      ? `Retrying ${retryState.attempt}/${retryState.maxAttempts}`
      : commandName
        ? `执行 ${commandName}`
        : turnStartTs
          ? "Running"
          : "Preparing";

  // 会话进行中：收集当前轮次的文件变更，传给输入框横幅展示
  const activeTurnFileChanges = useMemo<TurnFileChange[]>(() => {
    if (!isBusy || !canSend) return [];
    // 找本轮起始：最后一个 user 消息
    let turnStart = 0;
    for (let j = conversationMessages.length - 1; j >= 0; j--) {
      if (conversationMessages[j].role === "user") {
        turnStart = j + 1;
        break;
      }
    }
    const fileMap = new Map<string, TurnFileChange>();
    for (let j = turnStart; j < conversationMessages.length; j++) {
      const m = conversationMessages[j];
      if (m.role !== "assistant") continue;
      if (m.blocks) {
        for (const block of m.blocks) {
          if (block.type !== "toolCall") continue;
          if (block.name !== "edit" && block.name !== "write") continue;
          const result = m.toolResults?.[block.id];
          if (!result || result.status !== "completed") continue;
          const meta = result.metadata;
          if (!meta?.file || meta.before === undefined || meta.after === undefined) continue;
          const key = meta.file.replace(/\\/g, "/").toLowerCase();
          const existing = fileMap.get(key);
          if (existing) {
            existing.after = meta.after ?? "";
            existing.additions += meta.additions ?? 0;
            existing.deletions += meta.deletions ?? 0;
          } else {
            fileMap.set(key, {
              toolCallId: block.id,
              filePath: meta.file,
              operation: block.name as "edit" | "write",
              additions: meta.additions ?? 0,
              deletions: meta.deletions ?? 0,
              before: meta.before ?? "",
              after: meta.after ?? "",
            });
          }
        }
      }
    }
    return Array.from(fileMap.values());
  }, [isBusy, canSend, conversationMessages]);

  useEffect(() => {
    if (!shouldShowRunningBanner) return;
    setNow(Date.now());
    const cancel = createManagedPoller(() => setNow(Date.now()), 1000);
    return () => cancel();
  }, [shouldShowRunningBanner, turnStartTs]);

  useEffect(() => {
    if (shouldShowRunningBanner) {
      setRunningBannerVisible(true);
      setRunningBannerExiting(false);
      return;
    }

    if (!runningBannerVisible) return;

    setRunningBannerExiting(true);
    const timer = window.setTimeout(() => {
      setRunningBannerVisible(false);
      setRunningBannerExiting(false);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [shouldShowRunningBanner, runningBannerVisible]);

  // Storybook 中拦截 WebSocket 帧，便于查看协议数据。
  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Storybook 专用调试工具栏 */}
      {/* 主内容：
          - 仅在没有 sessionId（纯新会话还没创建）+ 可发送 → 居中欢迎页
          - 正在切换 session（loadingSessionId 存在） → 居中 loading
          - 已有 sessionId → 消息列表 */}
      {!sessionId && !isBusy && canSend ? (
        <WelcomeView />
      ) : isSessionLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={22} className="text-t-ghost animate-spin" />
        </div>
      ) : (
        <>
          <ChatMessageList
            messages={conversationMessages}
            isBusy={isBusy}
            className={`flex-1 min-h-0 ${
              runningBannerVisible && canSend
                ? pendingMessages.length > 0
                  ? "pb-[312px]"
                  : "pb-[202px]"
                : "pb-[180px]"
            }`}
          />
          {canSend ? (
            <div className="absolute bottom-0 left-0 right-0">
              {runningBannerVisible && (
                <div className="px-6">
                  {/* 横幅的裙边由输入框覆盖，让它和输入区域连成最初的整体样式。 */}
                  <div className="mx-auto mb-[-34px] w-full max-w-[800px]">
                    <div
                      className={`overflow-hidden rounded-t-xl rounded-b-none border border-b-0 border-black/10 bg-[#f6f7f9]/65 pb-8 shadow-[0_4px_14px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-md backdrop-saturate-150 ${
                        runningBannerExiting ? "running-banner-exit" : "running-banner-enter"
                      }`}
                    >
                      <RunningBannerContent
                        bannerLabel={bannerLabel}
                        model={runningModel}
                        runningDuration={runningDuration}
                        retryState={retryState}
                        fileChanges={activeTurnFileChanges}
                        plan={plan}
                        queuedItems={pendingMessages}
                      />
                    </div>
                  </div>
                </div>
              )}
              <ChatInput />
            </div>
          ) : (
            <div className="absolute bottom-0 left-0 right-0">
              <div className="px-6 pb-4 pt-3">
                <div className="mx-auto w-full max-w-[960px] flex items-center justify-center gap-1.5 py-2 text-[12px] text-t-ghost">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-hover font-mono text-[11px] text-t-muted">
                    {currentSessionChannel}
                  </span>
                  <span>渠道的会话仅供查看</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Storybook 专用 WebSocket 日志浮层 */}
    </div>
  );
}

// ─── Running Banner 内容 ──────────────────────────────────────────

function RunningBannerContent({
  bannerLabel,
  model,
  runningDuration,
  retryState,
  fileChanges,
  plan,
  queuedItems,
}: {
  bannerLabel: string;
  model: string | null;
  runningDuration: string | null;
  retryState: RetryState | null;
  fileChanges: TurnFileChange[];
  plan: PlanData | null;
  queuedItems: MailboxItemPayload[];
}) {
  const [changesExpanded, setChangesExpanded] = useState(false);
  const [planExpanded, setPlanExpanded] = useState(false);
  const hasChanges = fileChanges.length > 0;
  const totalAdd = fileChanges.reduce((s, c) => s + c.additions, 0);
  const totalDel = fileChanges.reduce((s, c) => s + c.deletions, 0);

  const planSteps = plan?.steps ?? [];
  const completedCount = planSteps.filter((s) => s.status === "completed").length;
  const allDone = planSteps.length > 0 && completedCount === planSteps.length;
  const pct = planSteps.length > 0 ? (completedCount / planSteps.length) * 100 : 0;

  const handleClick = (c: TurnFileChange) => {
    useInspector.getState().openDiffPreview(
      c.toolCallId, c.filePath, c.before, c.after, c.additions, c.deletions,
    );
    if (!useLayout.getState().panelVisible.inspector) {
      useLayout.getState().togglePanelVisible("inspector");
    }
  };

  return (
    <>
      {/* 第一行：执行状态、模型 */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium text-t-secondary">
        {retryState ? (
          <>
            <span className="running-ellipsis shrink-0 text-[#b7791f]">{bannerLabel}</span>
            <span className="min-w-0 flex-1 truncate text-right text-[#b7791f]/80" title={retryState.message}>{retryState.message}</span>
          </>
        ) : (
          <>
            <span className={`shrink-0 ${bannerLabel === "Running" ? "running-shimmer" : ""}`}>{bannerLabel}</span>
            {runningDuration && <span className="shrink-0 tabular-nums text-[11px] text-t-muted">{runningDuration}</span>}
            {model && <span className="shrink-0 inline-flex items-center rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-mono text-t-faint leading-none">{model}</span>}
            <span className="flex-1" />
          </>
        )}
      </div>

      {/* 运行横幅的活动摘要：任务、文件和队列采用同一轻量行样式，详情按需展开。 */}
      {plan && planSteps.length > 0 && (
        <div className="plan-row-enter mx-3 overflow-hidden">
          <button onClick={() => setPlanExpanded((v) => !v)} className="flex w-full items-center gap-1.5 py-1 text-left transition-colors hover:text-t-primary">
            <Target size={13} className={`shrink-0 ${allDone ? "text-green-500" : "text-neon"}`} strokeWidth={2} />
            <span className="shrink-0 text-[11px] font-medium text-t-muted">任务</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-t-faint" title={plan.goal}>{plan.goal}</span>
            <div className="h-0.5 w-12 shrink-0 overflow-hidden rounded-full bg-black/8"><div className={`h-full rounded-full transition-all duration-500 ${allDone ? "bg-green-500" : "bg-neon"}`} style={{ width: `${pct}%` }} /></div>
            <span className="shrink-0 text-[10px] font-mono tabular-nums text-t-faint">{completedCount}/{planSteps.length}</span>
            <ChevronDown size={12} className={`shrink-0 text-t-faint transition-transform duration-200 ${planExpanded ? "rotate-180" : ""}`} />
          </button>
          <div className={`grid transition-all duration-200 ease-out ${planExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
            <div className="overflow-hidden"><div className="py-1"><div className="max-h-[140px] overflow-y-auto">
              {planSteps.map((s) => (
                <div key={s.id} data-activity-row="task" className="flex items-start gap-2 rounded-md px-1 py-1 text-[11px] transition-colors hover:bg-black/[0.03]">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                    {s.status === "completed" ? <Check size={13} className="text-green-500" strokeWidth={2.5} /> : s.status === "in_progress" ? <Loader2 size={13} className="text-neon animate-spin" /> : <Circle size={13} className="text-t-faint/40" strokeWidth={2} />}
                  </span>
                  <span className="min-w-0 flex-1 leading-relaxed"><span className="text-t-faint font-mono mr-1.5">{s.id}.</span><span className={s.status === "completed" ? "text-t-faint line-through" : s.status === "in_progress" ? "text-t-primary font-medium" : "text-t-muted"}>{s.content}</span></span>
                </div>
              ))}
            </div></div></div>
          </div>
        </div>
      )}

      {/* 文件变更也只先展示摘要；展开后仍可点击任一文件打开 Diff。 */}
      {hasChanges && (
        <div className="mx-3 overflow-hidden">
          <button type="button" aria-expanded={changesExpanded} onClick={() => setChangesExpanded((value) => !value)} className="flex w-full items-center gap-1.5 py-1 text-left transition-colors hover:text-t-primary">
            <FileEdit size={13} className="shrink-0 text-t-muted" />
            <span className="shrink-0 text-[11px] font-medium text-t-muted">文件变更</span>
            <span className="rounded-full bg-black/[0.05] px-1.5 py-px font-mono text-[10px] tabular-nums text-t-faint">{fileChanges.length}</span>
            <span className="flex-1" />
            <span className="shrink-0 font-mono text-[10px]"><span className="text-green-600">+{totalAdd}</span><span className="mx-1 text-t-faint">·</span><span className="text-red-500">-{totalDel}</span></span>
            <ChevronDown size={13} className={`shrink-0 text-t-faint transition-transform duration-200 ${changesExpanded ? "rotate-180" : ""}`} />
          </button>
          <div className={`grid transition-[grid-template-rows,opacity] duration-200 ${changesExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
            <div className="overflow-hidden"><div className="max-h-[104px] overflow-y-auto py-1">
              {fileChanges.map((c) => (
                <button key={c.toolCallId} onClick={() => handleClick(c)} data-activity-row="file-change" className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[11px] transition-colors hover:bg-black/[0.035]">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center"><FileIconView path={c.filePath} size={14} /></span>
                  <span className="min-w-0 flex-1 truncate text-t-primary" title={c.filePath}>{basename(c.filePath)}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-black/[0.035] px-1.5 py-0.5 text-t-faint">{c.operation === "write" ? <FilePlus2 size={11} /> : <FileEdit size={11} />}<span className="text-[10px] uppercase">{c.operation === "write" ? "new" : "edit"}</span></span>
                  <span className="flex min-w-[50px] shrink-0 items-center justify-end gap-1 font-mono text-[10px]">{c.additions > 0 && <span className="text-green-600">+{c.additions}</span>}{c.deletions > 0 && <span className="text-red-500">-{c.deletions}</span>}</span>
                </button>
              ))}
            </div></div>
          </div>
        </div>
      )}

      <QueuedMessagesBanner items={queuedItems} />
    </>
  );
}
