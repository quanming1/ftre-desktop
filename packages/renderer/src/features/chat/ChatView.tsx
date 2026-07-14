/**
 * ChatView — Chat message list + input.
 *
 * Single component used in both App and Storybook.
 * Internally handles data source fallback:
 * - Tries zustand store first (useChat)
 * - Falls back to streamManager directly if store is empty/unavailable
 */
import { useState, useEffect, useMemo } from "react";
import { Loader2, FileEdit, FilePlus2, ChevronDown, ChevronUp, Check, Circle, Target } from "lucide-react";
import { useChat, type RetryState, type PlanData } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { wsClient } from "@/services/websocket-client";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";
import { WelcomeView } from "./WelcomeView";
import { WsLogPanel, type LogEntry } from "./WsLogPanel";
import { FileIconView } from "@/components/FileIconView";
import { useInspector } from "@/stores/inspector";
import { useLayout } from "@/stores/layout";
import type { TurnFileChange } from "./TurnFileChanges";
import { basename } from "@/utils/pathUtils";

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
  const turnStartTs = useChat((s) => s.turnStartTs);
  const plan = useChat((s) => s.plan);
  const storeModel = useChat((s) => s.model);
  const retryState = useChat((s) => s.retryState);
  const connected = useChat((s) => s.connected);

  // Auto-connect on mount
  useEffect(() => {
    if (!wsClient.connected) wsClient.connect();
  }, []);

  // WS Log state (only active in Storybook / dev mode)
  const isStorybook = typeof window !== "undefined" && window.location.port === "6006";
  const [showLog, setShowLog] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);

  const chatId = useChat((s) => s.sessionId);

  // Determine if current session is a websocket session (can send messages)
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

  // Session loading state
  const loadingSessionId = useSession((s) => s.loadingSessionId);
  const isSessionLoading = loadingSessionId != null;
  const [now, setNow] = useState(() => Date.now());
  const [runningBannerVisible, setRunningBannerVisible] = useState(false);
  const [runningBannerExiting, setRunningBannerExiting] = useState(false);
  const runningDuration = turnStartTs
    ? formatRunningDuration(now - turnStartTs)
    : null;
  const shouldShowRunningBanner = sessionStatus === "running" && canSend;

  // 本轮使用的模型：优先取本轮最后一条 assistant 消息的 model，兜底 store 选中的 model
  const turnModel = useMemo(() => {
    if (!isBusy) return null;
    for (let j = messages.length - 1; j >= 0; j--) {
      if (messages[j].role === "assistant" && messages[j].model) return messages[j].model!;
    }
    return storeModel ?? null;
  }, [isBusy, messages, storeModel]);

  const bannerLabel = retryState
    ? `Retrying ${retryState.attempt}/${retryState.maxAttempts}`
    : turnStartTs
      ? "Running"
      : "Preparing";

  // 会话进行中：收集当前轮次的文件变更，传给输入框横幅展示
  const activeTurnFileChanges = useMemo<TurnFileChange[]>(() => {
    if (!isBusy || !canSend) return [];
    // 找本轮起始：最后一个 user 消息
    let turnStart = 0;
    for (let j = messages.length - 1; j >= 0; j--) {
      if (messages[j].role === "user") {
        turnStart = j + 1;
        break;
      }
    }
    const fileMap = new Map<string, TurnFileChange>();
    for (let j = turnStart; j < messages.length; j++) {
      const m = messages[j];
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
  }, [isBusy, canSend, messages]);

  useEffect(() => {
    if (!shouldShowRunningBanner) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
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

  // Log interceptor (only in storybook)
  useEffect(() => {
    if (!isStorybook) return;
    const unsub = wsClient.onMessage((msg) => {
      const time = new Date().toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 });
      setLogEntries((prev) => [...prev, {
        time,
        direction: "recv" as const,
        raw: JSON.stringify(msg),
        parsed: msg,
        role: (msg as any).role,
      }]);
    });
    return unsub;
  }, [isStorybook]);

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Debug toolbar (Storybook only) */}
      {isStorybook && logEntries.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-white/10 bg-black/20">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-[10px] text-t-ghost font-mono flex-1">
            {chatId || "—"} | {messages.length} msgs
          </span>
          <button
            onClick={() => setShowLog((v) => !v)}
            className={`px-2 py-0.5 text-[10px] rounded border ${showLog ? "border-neon/50 text-neon bg-neon/10" : "border-white/20 text-t-ghost"}`}
          >
            WS Log ({logEntries.length})
          </button>
        </div>
      )}

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
            messages={messages}
            isBusy={isBusy}
            className={`flex-1 min-h-0 ${runningBannerVisible && canSend ? "pb-[225px]" : "pb-[180px]"}`}
          />
          {canSend ? (
            <div className="absolute bottom-0 left-0 right-0">
              {runningBannerVisible && (
                <div className="px-6">
                  <div className="mx-auto mb-[-12px] w-full max-w-[800px]">
                    <div
                      className={`mx-6 overflow-hidden rounded-t-xl rounded-b-none border border-b-0 border-black/10 bg-[#f6f7f9]/65 shadow-[0_4px_14px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-md backdrop-saturate-150 ${
                        runningBannerExiting ? "running-banner-exit" : "running-banner-enter"
                      }`}
                    >
                      <RunningBannerContent
                        bannerLabel={bannerLabel}
                        turnModel={turnModel}
                        runningDuration={runningDuration}
                        retryState={retryState}
                        fileChanges={activeTurnFileChanges}
                        plan={plan}
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

      {/* WS Log overlay (Storybook only) */}
      {isStorybook && showLog && (
        <div className="absolute top-0 right-0 w-[50%] h-full bg-[#0d0d1a] border-l border-white/10 z-50 flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10">
            <span className="text-xs text-t-secondary">WebSocket Log</span>
            <button onClick={() => setShowLog(false)} className="text-xs text-t-ghost hover:text-white">Close</button>
          </div>
          <WsLogPanel entries={logEntries} onClear={() => setLogEntries([])} className="flex-1 min-h-0" />
        </div>
      )}
    </div>
  );
}

// ─── Running Banner 内容 ──────────────────────────────────────────

function RunningBannerContent({
  bannerLabel,
  turnModel,
  runningDuration,
  retryState,
  fileChanges,
  plan,
}: {
  bannerLabel: string;
  turnModel: string | null;
  runningDuration: string | null;
  retryState: RetryState | null;
  fileChanges: TurnFileChange[];
  plan: PlanData | null;
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
      {/* Row 1: status + model + file changes */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium text-t-secondary">
        {retryState ? (
          <>
            <span className="running-ellipsis shrink-0 text-[#b7791f]">
              {bannerLabel}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-right text-[#b7791f]/80"
              title={retryState.message}
            >
              {retryState.message}
            </span>
          </>
        ) : (
          <>
            <span className={`shrink-0 ${bannerLabel === "Running" ? "running-shimmer" : ""}`}>
              {bannerLabel}
            </span>
            {runningDuration && (
              <span className="shrink-0 tabular-nums text-[12px] text-t-muted">{runningDuration}</span>
            )}
            {turnModel && (
              <span className="shrink-0 inline-flex items-center rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] font-mono text-t-faint leading-none">
                {turnModel}
              </span>
            )}
            <span className="flex-1" />
            {hasChanges && (
              <button
                onClick={() => setChangesExpanded((v) => !v)}
                className="shrink-0 inline-flex items-center gap-1 text-[11px] font-mono text-t-ghost hover:text-t-secondary rounded-md hover:bg-black/[0.04] px-1.5 py-1 transition-colors"
              >
                <span className="text-green-600">+{totalAdd}</span>
                <span className="text-red-500">-{totalDel}</span>
                {changesExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            )}
          </>
        )}
      </div>

      {/* Row 2: plan goal + progress (only when plan exists) */}
      {plan && planSteps.length > 0 && (
        <div className="plan-row-enter border-t border-black/5">
          <button
            onClick={() => setPlanExpanded((v) => !v)}
            className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-black/[0.02]"
          >
            <Target size={13} className={`shrink-0 ${allDone ? "text-green-500" : "text-neon"}`} strokeWidth={2} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-t-muted" title={plan.goal}>
              {plan.goal}
            </span>
            {/* Progress bar */}
            <div className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-black/8">
              <div
                className={`h-full rounded-full transition-all duration-500 ${allDone ? "bg-green-500" : "bg-neon"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="shrink-0 text-[10px] font-mono tabular-nums text-t-faint">
              {completedCount}/{planSteps.length}
            </span>
            <ChevronDown
              size={12}
              className={`shrink-0 text-t-faint transition-transform duration-200 ${planExpanded ? "rotate-180" : ""}`}
            />
          </button>

          {/* Steps list — grid 高度动画 */}
          <div
            className={`grid transition-all duration-200 ease-out ${planExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
          >
            <div className="overflow-hidden">
              <div className="border-t border-black/5">
                <div className="max-h-[140px] overflow-y-auto px-4 py-1.5">
                  {planSteps.map((s) => (
                    <div key={s.id} className="flex items-start gap-2.5 py-1">
                      <span className="mt-0.5 flex shrink-0 items-center justify-center" style={{ width: 13, height: 13 }}>
                        {s.status === "completed" ? (
                          <Check size={13} className="text-green-500" strokeWidth={2.5} />
                        ) : s.status === "in_progress" ? (
                          <Loader2 size={13} className="text-neon animate-spin" />
                        ) : (
                          <Circle size={13} className="text-t-faint/40" strokeWidth={2} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 text-[12px] leading-relaxed">
                        <span className="text-t-faint font-mono mr-1.5">{s.id}.</span>
                        <span className={
                          s.status === "completed" ? "text-t-faint line-through"
                          : s.status === "in_progress" ? "text-t-primary font-medium"
                          : "text-t-muted"
                        }>
                          {s.content}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expanded file changes */}
      {hasChanges && changesExpanded && (
        <div className="border-t border-black/5">
          <div className="max-h-[80px] overflow-y-auto px-2.5 pb-2">
            {fileChanges.map((c) => (
              <button
                key={c.toolCallId}
                onClick={() => handleClick(c)}
                className="flex items-center gap-2 w-full px-2 py-1 text-left text-[12px] hover:bg-black/[0.03] rounded transition-colors"
              >
                <FileIconView path={c.filePath} size={14} />
                <span className="truncate text-t-primary">{basename(c.filePath)}</span>
                <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-t-faint">
                  {c.operation === "write" ? <FilePlus2 size={11} /> : <FileEdit size={11} />}
                  <span className="text-[10px] uppercase">{c.operation === "write" ? "new" : "edit"}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] flex items-center gap-1 min-w-[50px] justify-end">
                  {c.additions > 0 && <span className="text-green-600">+{c.additions}</span>}
                  {c.deletions > 0 && <span className="text-red-500">-{c.deletions}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
