import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  Braces,
  ChevronRight,
  Copy,
  ListTree,
  RefreshCw,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  fetchTrace,
  fetchTraceRun,
  fetchTraces,
  type TraceRun,
} from "@/services/api";
import { JsonTree } from "./JsonTree";

import { useLayout } from "@/stores/layout";
import { useChat } from "@/stores/chat";
import { createManagedPoller } from "@/services/visibility-manager";
const POLL_INTERVAL_MS = 3000;
const MAX_DISPLAY_CHARS = 120_000;
type DetailTab = "input" | "output" | "metadata" | "events";

function formatDuration(value: number | null | undefined): string {
  if (value == null) return "-";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function StatusIcon({ status }: { status: string }) {
  if (status === "error") return <XCircle size={14} className="text-red-500" />;
  if (status === "cancelled") return <AlertTriangle size={14} className="text-amber-500" />;
  return <CheckCircle2 size={14} className="text-emerald-500" />;
}

function RunIcon({ type }: { type: TraceRun["run_type"] }) {
  if (type === "llm") return <BrainCircuit size={14} />;
  if (type === "tool") return <Wrench size={14} />;
  return <Bot size={14} />;
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-elevated ${className}`} />;
}

function PanelLoading({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="rounded-lg bg-elevated/45 p-3">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="mt-3 h-2 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function JsonViewer({ value, loading }: { value: unknown; loading: boolean }) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"tree" | "text">("tree");
  const serialized = useMemo(() => {
    if (value == null) return "";
    if (typeof value === "object" && Object.keys(value as object).length === 0) return "";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);
  const truncated = serialized.length > MAX_DISPLAY_CHARS;
  const displayed = truncated
    ? `${serialized.slice(0, MAX_DISPLAY_CHARS)}\n\n... 内容过大，界面仅展示前 ${MAX_DISPLAY_CHARS.toLocaleString()} 个字符。复制仍会包含完整内容。`
    : serialized;

  const copy = useCallback(async () => {
    if (!serialized) return;
    await navigator.clipboard.writeText(serialized);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [serialized]);

  if (loading) {
    return (
      <div className="space-y-2 rounded-md bg-base p-4">
        <Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-4/5" />
      </div>
    );
  }

  return (
    <div className="relative min-h-48 overflow-hidden rounded-md border border-border bg-base">
      <div className="flex h-10 items-center justify-between gap-3 bg-elevated/35 px-3">
        <span className="text-[10px] text-t-ghost">
          {serialized ? `${serialized.length.toLocaleString()} 字符` : "无数据"}
          {truncated && <span className="ml-2 text-amber-600">已截断显示</span>}
        </span>
        <div className="flex items-center gap-1">
          <div className="flex items-center rounded-md bg-base p-0.5">
            <button type="button" onClick={() => setViewMode("tree")} className={`flex items-center gap-1 rounded px-2 py-1 text-[9px] transition-colors active:scale-[0.96] ${viewMode === "tree" ? "bg-active text-t-primary shadow-sm" : "text-t-ghost hover:text-t-muted"}`}>
              <ListTree size={11} />Tree
            </button>
            <button type="button" onClick={() => setViewMode("text")} className={`flex items-center gap-1 rounded px-2 py-1 text-[9px] transition-colors active:scale-[0.96] ${viewMode === "text" ? "bg-active text-t-primary shadow-sm" : "text-t-ghost hover:text-t-muted"}`}>
              <Braces size={11} />文本
            </button>
          </div>
          <button type="button" disabled={!serialized} onClick={() => void copy()} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-t-muted transition-colors hover:bg-hover hover:text-t-primary active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40" title="复制完整内容">
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            {copied ? "已复制" : "复制全部"}
          </button>
        </div>
      </div>
      {viewMode === "tree" ? <JsonTree value={value} /> : (
        <pre className="max-h-[calc(100vh-330px)] min-h-44 overflow-auto p-4 font-mono text-[11px] leading-[1.65] text-t-muted whitespace-pre-wrap break-all">{displayed || "无"}</pre>
      )}
    </div>
  );
}

interface RunNodeProps {
  run: TraceRun;
  runs: TraceRun[];
  depth: number;
  selectedId: string | null;
  onSelect: (run: TraceRun) => void;
}

function RunNode({ run, runs, depth, selectedId, onSelect }: RunNodeProps) {
  const children = runs.filter((item) => item.parent_run_id === run.id);
  const finishReason = String(run.outputs?.finish_reason || "");
  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(run)}
        className={`group flex w-full items-center gap-2 rounded-lg py-2.5 pr-2 text-left transition-colors active:scale-[0.96] ${
          selectedId === run.id ? "bg-active text-t-primary shadow-sm" : "text-t-muted hover:bg-hover hover:text-t-primary"
        }`}
        style={{ paddingLeft: 10 + depth * 18 }}
      >
        {children.length > 0 ? <ChevronRight size={12} className="text-t-ghost" /> : <span className="w-3" />}
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${selectedId === run.id ? "bg-neon/10 text-neon" : "bg-elevated"}`}>
          <RunIcon type={run.run_type} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{run.name}</span>
        {finishReason && <span className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[9px]">{finishReason}</span>}
        <span className="font-mono text-[9px] text-t-ghost tabular-nums">{formatDuration(run.duration_ms)}</span>
      </button>
      {children.map((child) => (
        <RunNode key={child.id} run={child} runs={runs} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}

export function TracePanel({ active = true }: { active?: boolean }) {
  const sessionId = useChat((state) => state.sessionId);
  const traceFocusSessionId = useLayout((state) => state.traceFocusSessionId);
  const clearTraceFocus = useLayout((state) => state.clearTraceFocus);
  const [runs, setRuns] = useState<TraceRun[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunPayload, setSelectedRunPayload] = useState<TraceRun | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("input");
  const [listLoading, setListLoading] = useState(true);
  const [treeLoading, setTreeLoading] = useState(false);
  const [payloadLoading, setPayloadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedTraceRef = useRef<string | null>(null);
  const selectedRunRef = useRef<string | null>(null);
  const listRequestRef = useRef(0);
  const treeRequestRef = useRef(0);
  const payloadRequestRef = useRef(0);

  useEffect(() => {
    listRequestRef.current += 1;
    treeRequestRef.current += 1;
    payloadRequestRef.current += 1;
    selectedTraceRef.current = null;
    selectedRunRef.current = null;
    setSelectedTraceId(null);
    setSelectedRunId(null);
    setSelectedRunPayload(null);
    setRuns([]);
    setError(null);
  }, [sessionId]);
  useEffect(() => {
    selectedTraceRef.current = selectedTraceId;
  }, [selectedTraceId]);

  useEffect(() => {
    selectedRunRef.current = selectedRunId;
  }, [selectedRunId]);

  const loadRunPayload = useCallback(async (traceId: string, runId: string, showLoading = true) => {
    const requestId = ++payloadRequestRef.current;
    selectedRunRef.current = runId;
    setSelectedRunId(runId);
    if (showLoading) {
      setPayloadLoading(true);
      setSelectedRunPayload(null);
    }
    try {
      const run = await fetchTraceRun(traceId, runId);
      if (requestId === payloadRequestRef.current) {
        setSelectedRunPayload(run);
        setError(null);
      }
    } catch (cause) {
      if (requestId === payloadRequestRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (requestId === payloadRequestRef.current) setPayloadLoading(false);
    }
  }, []);

  const loadTree = useCallback(async (traceId: string, showLoading = true) => {
    const requestId = ++treeRequestRef.current;
    if (showLoading) {
      setTreeLoading(true);
      setRuns([]);
      setSelectedRunPayload(null);
    }
    try {
      const detail = await fetchTrace(traceId);
      if (requestId !== treeRequestRef.current) return;
      setRuns(detail.runs);
      const root = detail.runs.find((run) => run.parent_run_id == null) || detail.runs[0];
      const selected = detail.runs.find((run) => run.id === selectedRunRef.current) || root;
      if (selected) await loadRunPayload(traceId, selected.id, showLoading);
      if (requestId !== treeRequestRef.current) return;
      setError(null);
    } catch (cause) {
      if (requestId === treeRequestRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (requestId === treeRequestRef.current) setTreeLoading(false);
    }
  }, [loadRunPayload]);

  const refreshList = useCallback(async (showLoading = false) => {
    if (!sessionId) {
      setListLoading(false);
      return;
    }
    const requestId = ++listRequestRef.current;
    if (showLoading) setListLoading(true);
    try {
      // Trace 面板只跟随当前聊天 Session，并自动展示最新一条 Trace。
      const data = await fetchTraces(1, 0, sessionId);
      if (requestId !== listRequestRef.current) return;
      setError(null);
      const latest = data.traces[0];
      if (latest) {
        const changed = latest.trace_id !== selectedTraceRef.current;
        selectedTraceRef.current = latest.trace_id;
        setSelectedTraceId(latest.trace_id);
        await loadTree(latest.trace_id, changed);
      } else {
        selectedTraceRef.current = null;
        setSelectedTraceId(null);
        setSelectedRunId(null);
        setSelectedRunPayload(null);
        setRuns([]);
      }
    } catch (cause) {
      if (requestId === listRequestRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (requestId === listRequestRef.current) setListLoading(false);
    }
  }, [loadTree, sessionId]);
  useEffect(() => {
    if (!active) return;
    void refreshList(true);
    const cancel = createManagedPoller(() => void refreshList(false), POLL_INTERVAL_MS);
    return () => cancel();
  }, [active, refreshList]);
  useEffect(() => {
    if (!traceFocusSessionId || !sessionId) return;
    const normalize = (value: string) => value.split("_sess_").pop() || value;
    if (normalize(traceFocusSessionId) === normalize(sessionId)) clearTraceFocus();
  }, [clearTraceFocus, sessionId, traceFocusSessionId]);
  const manualRefresh = useCallback(async () => {
    await refreshList(true);
  }, [refreshList]);

  const selectedRun = selectedRunPayload || runs.find((run) => run.id === selectedRunId) || null;
  const roots = runs.filter((run) => run.parent_run_id == null);
  const tabValue = activeTab === "input" ? selectedRun?.inputs
    : activeTab === "output" ? selectedRun?.outputs
      : activeTab === "metadata" ? selectedRun?.metadata
        : selectedRun?.events;
  return (
    <div className="flex h-full flex-col bg-surface text-t-primary" data-testid="trace-panel">
      <header className="shrink-0 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Activity size={16} className="shrink-0 text-t-muted" />
            <div className="min-w-0">
              <h1 className="text-[13px] font-semibold">Agent Traces</h1>
              <p className="truncate font-mono text-[10px] text-t-ghost" title={sessionId || ""}>
                {sessionId || "未选择 Session"}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => void manualRefresh()} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-t-ghost transition-colors hover:bg-hover hover:text-t-primary active:scale-[0.96]">
            <RefreshCw size={12} className={listLoading || treeLoading ? "animate-spin" : ""} />刷新
          </button>
        </div>
      </header>

      {error && <div className="mx-4 mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-500">{error}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-[clamp(190px,30%,280px)_minmax(0,1fr)] overflow-hidden">
        <section className="min-h-0 overflow-y-auto border-r border-border">
          <ModuleHeader label="Run Tree" count={runs.length} />
          <div className="px-2 pb-3">
            {listLoading || treeLoading ? <PanelLoading rows={4} /> : roots.length > 0 ? roots.map((run) => (
              <RunNode key={run.id} run={run} runs={runs} depth={0} selectedId={selectedRunId} onSelect={(item) => selectedTraceId && void loadRunPayload(selectedTraceId, item.id)} />
            )) : (
              <div className="py-16 text-center text-[11px] text-t-ghost">
                {sessionId ? "当前 Session 暂无 Trace" : "请选择一个 Session"}
              </div>
            )}
          </div>
        </section>

        <section className="min-w-0 overflow-y-auto bg-surface p-4">
          {selectedRun ? (
            <div className="mx-auto max-w-5xl">
              <div className="flex items-start justify-between gap-3">
                <div><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-elevated"><RunIcon type={selectedRun.run_type} /></span><h2 className="text-[15px] font-semibold">{selectedRun.name}</h2><StatusIcon status={selectedRun.status} /></div><p className="mt-1 pl-10 font-mono text-[9px] text-t-ghost">{selectedRun.id}</p></div>
                <div className="text-right text-[10px] text-t-ghost"><div className="font-mono text-[12px] text-t-muted tabular-nums">{formatDuration(selectedRun.duration_ms)}</div><div className="mt-1">{formatTime(selectedRun.start_time)}</div></div>
              </div>

              {selectedRun.run_type === "llm" && (() => {
                const ttftEvent = selectedRun.events?.find((e) => e.name === "ttft");
                const ttftMs = ttftEvent ? Number(ttftEvent.data?.ms) : null;
                return (
                  <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
                    <DetailStat label="TTFT" value={ttftMs != null ? formatDuration(ttftMs) : "-"} />
                    <DetailStat label="Finish Reason" value={String(selectedRun.outputs?.finish_reason || "unknown")} />
                    <DetailStat label="Tool Calls" value={String(selectedRun.outputs?.tool_call_count ?? (selectedRun.outputs?.tool_calls as unknown[])?.length ?? 0)} />
                    <DetailStat label="Response Model" value={String((selectedRun.outputs?.response_metadata as Record<string, unknown>)?.model || "-")} />
                  </div>
                );
              })()}
              {selectedRun.error && <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[11px] text-red-500">{selectedRun.error}</div>}

              <div className="mt-5 inline-flex items-center gap-1 rounded-lg bg-elevated/45 p-1">
                {(["input", "output", "metadata", "events"] as DetailTab[]).map((tab) => (
                  <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`relative rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors active:scale-[0.96] ${activeTab === tab ? "bg-active text-t-primary shadow-sm" : "text-t-ghost hover:text-t-muted"}`}>
                    {tab === "input" ? "Input" : tab === "output" ? "Output" : tab === "metadata" ? "Metadata" : "Events"}
                  </button>
                ))}
              </div>
              <div className="mt-3"><JsonViewer value={tabValue} loading={payloadLoading} /></div>
            </div>
          ) : payloadLoading ? <PanelLoading rows={4} /> : <div className="flex h-full items-center justify-center text-[11px] text-t-ghost">{sessionId ? "选择一个 Run 查看详情" : "请选择一个 Session"}</div>}
        </section>
      </div>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border bg-elevated/25 p-3"><div className="text-[10px] text-t-ghost">{label}</div><div className="mt-1 truncate font-mono text-[12px] text-t-primary" title={value}>{value}</div></div>;
}

function ModuleHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between px-3">
      <div className="flex items-center gap-2"><span className="text-[11px] font-medium text-t-muted">{label}</span><span className="font-mono text-[9px] text-t-ghost tabular-nums">{count}</span></div>
    </div>
  );
}
