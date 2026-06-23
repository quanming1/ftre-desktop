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
  Clock3,
  Copy,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  fetchTrace,
  fetchTraceRun,
  fetchTraces,
  type TraceRun,
  type TraceSummary,
} from "@/services/api";
import { JsonTree } from "./JsonTree";
import { useLayout } from "@/stores/layout";

const POLL_INTERVAL_MS = 3000;
const MAX_DISPLAY_CHARS = 120_000;
type DetailTab = "input" | "output" | "metadata" | "events";
type TraceModule = "traces" | "tree" | "detail";

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

function shortId(value: string): string {
  return value.length > 12 ? value.slice(0, 8) : value;
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
      <div className="space-y-2 rounded-xl bg-base p-4">
        <Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-4/5" />
      </div>
    );
  }

  return (
    <div className="relative min-h-48 overflow-hidden rounded-xl bg-base">
      <div className="flex h-10 items-center justify-between gap-3 bg-elevated/35 px-3">
        <span className="text-[10px] text-t-ghost">
          {serialized ? `${serialized.length.toLocaleString()} 字符` : "无数据"}
          {truncated && <span className="ml-2 text-amber-600">已截断显示</span>}
        </span>
        <div className="flex items-center gap-1">
          <div className="flex items-center rounded-md bg-base p-0.5">
            <button type="button" onClick={() => setViewMode("tree")} className={`flex items-center gap-1 rounded px-2 py-1 text-[9px] transition-colors ${viewMode === "tree" ? "bg-active text-t-primary shadow-sm" : "text-t-ghost hover:text-t-muted"}`}>
              <ListTree size={11} />Tree
            </button>
            <button type="button" onClick={() => setViewMode("text")} className={`flex items-center gap-1 rounded px-2 py-1 text-[9px] transition-colors ${viewMode === "text" ? "bg-active text-t-primary shadow-sm" : "text-t-ghost hover:text-t-muted"}`}>
              <Braces size={11} />文本
            </button>
          </div>
          <button type="button" disabled={!serialized} onClick={() => void copy()} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-t-muted transition-colors hover:bg-hover hover:text-t-primary disabled:cursor-not-allowed disabled:opacity-40" title="复制完整内容">
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
        className={`group flex w-full items-center gap-2 rounded-lg py-2.5 pr-2 text-left transition-colors ${
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
        <span className="font-mono text-[9px] text-t-ghost">{formatDuration(run.duration_ms)}</span>
      </button>
      {children.map((child) => (
        <RunNode key={child.id} run={child} runs={runs} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}

export function TracePanel() {
  const traceFocusSessionId = useLayout((state) => state.traceFocusSessionId);
  const clearTraceFocus = useLayout((state) => state.clearTraceFocus);
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [runs, setRuns] = useState<TraceRun[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunPayload, setSelectedRunPayload] = useState<TraceRun | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("input");
  const [query, setQuery] = useState("");
  const [tracePath, setTracePath] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [treeLoading, setTreeLoading] = useState(false);
  const [payloadLoading, setPayloadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<TraceModule, boolean>>({
    traces: false,
    tree: false,
    detail: false,
  });
  const selectedTraceRef = useRef<string | null>(null);
  const payloadRequestRef = useRef(0);

  useEffect(() => {
    selectedTraceRef.current = selectedTraceId;
  }, [selectedTraceId]);

  const loadRunPayload = useCallback(async (traceId: string, runId: string) => {
    const requestId = ++payloadRequestRef.current;
    setSelectedRunId(runId);
    setPayloadLoading(true);
    setSelectedRunPayload(null);
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

  const loadTree = useCallback(async (traceId: string) => {
    setTreeLoading(true);
    setRuns([]);
    setSelectedRunPayload(null);
    try {
      const detail = await fetchTrace(traceId);
      setRuns(detail.runs);
      const root = detail.runs.find((run) => run.parent_run_id == null) || detail.runs[0];
      if (root) await loadRunPayload(traceId, root.id);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTreeLoading(false);
    }
  }, [loadRunPayload]);

  const refreshList = useCallback(async (showLoading = false) => {
    if (showLoading) setListLoading(true);
    try {
      const data = await fetchTraces();
      setTraces(data.traces);
      setTracePath(data.path);
      setError(null);
      if (!selectedTraceRef.current && data.traces[0]) {
        const traceId = data.traces[0].trace_id;
        selectedTraceRef.current = traceId;
        setSelectedTraceId(traceId);
        await loadTree(traceId);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setListLoading(false);
    }
  }, [loadTree]);

  useEffect(() => {
    void refreshList(true);
    const timer = window.setInterval(() => void refreshList(false), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshList]);

  const selectTrace = useCallback(async (traceId: string) => {
    selectedTraceRef.current = traceId;
    setSelectedTraceId(traceId);
    setActiveTab("input");
    await loadTree(traceId);
  }, [loadTree]);

  useEffect(() => {
    if (!traceFocusSessionId || traces.length === 0) return;
    const normalize = (value: string) => value.split("::").pop() || value;
    const target = normalize(traceFocusSessionId);
    setQuery(traceFocusSessionId);
    const matched = traces.find((trace) =>
      normalize(String(trace.metadata?.session_id || "")) === target,
    );
    if (!matched) return;
    clearTraceFocus();
    if (matched.trace_id !== selectedTraceRef.current) {
      void selectTrace(matched.trace_id);
    }
  }, [clearTraceFocus, selectTrace, traceFocusSessionId, traces]);

  const manualRefresh = useCallback(async () => {
    await refreshList(true);
    if (selectedTraceRef.current) await loadTree(selectedTraceRef.current);
  }, [loadTree, refreshList]);

  const filteredTraces = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return traces;
    return traces.filter((trace) =>
      [trace.name, trace.trace_id, String(trace.metadata?.session_id || ""), ...trace.response_models]
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [query, traces]);

  const selectedRun = selectedRunPayload || runs.find((run) => run.id === selectedRunId) || null;
  const roots = runs.filter((run) => run.parent_run_id == null);
  const tabValue = activeTab === "input" ? selectedRun?.inputs
    : activeTab === "output" ? selectedRun?.outputs
      : activeTab === "metadata" ? selectedRun?.metadata
        : selectedRun?.events;
  const toggleModule = (module: TraceModule) => {
    setCollapsed((current) => ({ ...current, [module]: !current[module] }));
  };

  return (
    <div className="flex h-full flex-col bg-surface text-t-primary" data-testid="trace-panel">
      <header className="shrink-0 px-5 py-3">
        <div className="flex items-center gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neon/10 text-neon"><Activity size={17} /></span>
            <div className="min-w-0"><h1 className="text-[14px] font-semibold">Agent Traces</h1><p className="truncate font-mono text-[9px] text-t-ghost" title={tracePath}>{tracePath || "等待 Gateway"}</p></div>
          </div>
          <button type="button" onClick={() => void manualRefresh()} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-t-ghost transition-colors hover:bg-hover hover:text-t-primary">
            <RefreshCw size={12} className={listLoading || treeLoading ? "animate-spin" : ""} />刷新
          </button>
        </div>
      </header>

      {error && <div className="mx-4 mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-500">{error}</div>}

      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden px-2 pb-2">
        {collapsed.traces ? (
          <CollapsedRail label="Traces" icon={Activity} onExpand={() => toggleModule("traces")} />
        ) : (
        <section className="flex w-[290px] shrink-0 flex-col overflow-hidden rounded-xl bg-base/55">
          <ModuleHeader label="Traces" count={filteredTraces.length} onCollapse={() => toggleModule("traces")} />
          <div className="p-3">
            <div className="flex items-center gap-2 rounded-lg bg-elevated/65 px-2.5 py-2">
              <Search size={13} className="text-t-ghost" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Session、模型或 Trace ID" className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-t-ghost" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {listLoading && traces.length === 0 ? <PanelLoading /> : filteredTraces.map((trace) => (
              <button key={trace.trace_id} type="button" onClick={() => void selectTrace(trace.trace_id)} className={`mb-1.5 w-full rounded-xl p-3 text-left transition-all ${selectedTraceId === trace.trace_id ? "bg-active shadow-sm" : "hover:bg-hover"}`}>
                <div className="flex items-center gap-2"><StatusIcon status={trace.status} /><span className="min-w-0 flex-1 truncate text-[12px] font-medium">{String(trace.metadata?.session_id || trace.name)}</span><span className="font-mono text-[9px] text-t-ghost">{shortId(trace.trace_id)}</span></div>
                <div className="mt-2 flex items-center gap-2 text-[9px] text-t-ghost"><Clock3 size={10} />{formatTime(trace.start_time)}<span>·</span><span>{formatDuration(trace.duration_ms)}</span></div>
                <div className="mt-2 flex flex-wrap gap-1"><Badge>LLM {trace.llm_run_count}</Badge><Badge>Tool {trace.tool_run_count}</Badge>{trace.stop_without_tools > 0 && <Badge warn>stop/no-tool {trace.stop_without_tools}</Badge>}</div>
              </button>
            ))}
            {!listLoading && filteredTraces.length === 0 && <div className="py-16 text-center text-[11px] text-t-ghost">暂无 Trace。发送消息后会自动出现。</div>}
          </div>
        </section>
        )}

        {collapsed.tree ? (
          <CollapsedRail label="Run Tree" icon={ListTree} onExpand={() => toggleModule("tree")} />
        ) : (
          <section className="w-[270px] shrink-0 overflow-y-auto rounded-xl bg-base/55">
            <ModuleHeader label="Run Tree" count={runs.length} onCollapse={() => toggleModule("tree")} />
            <div className="p-3">
              {treeLoading ? <PanelLoading rows={4} /> : roots.map((run) => (
                <RunNode key={run.id} run={run} runs={runs} depth={0} selectedId={selectedRunId} onSelect={(item) => selectedTraceId && void loadRunPayload(selectedTraceId, item.id)} />
              ))}
            </div>
          </section>
        )}

        {collapsed.detail ? (
          <CollapsedRail label="Run Detail" icon={Braces} onExpand={() => toggleModule("detail")} fill />
        ) : (
        <section className="group min-w-[360px] flex-1 overflow-y-auto rounded-xl bg-base/30 p-5">
          {selectedRun ? (
            <div className="mx-auto max-w-5xl">
              <div className="group/detail flex items-start justify-between gap-3 [&>div:last-child>button]:opacity-0 [&>div:last-child>button]:transition-opacity [&>div:last-child>button:focus]:opacity-100 [&>div:last-child>button:hover]:opacity-100 [&:hover>div:last-child>button]:opacity-100">
                <div><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-elevated"><RunIcon type={selectedRun.run_type} /></span><h2 className="text-[15px] font-semibold">{selectedRun.name}</h2><StatusIcon status={selectedRun.status} /></div><p className="mt-1 pl-10 font-mono text-[9px] text-t-ghost">{selectedRun.id}</p></div>
                <div className="flex items-start gap-3">
                  <div className="text-right text-[9px] text-t-ghost"><div className="font-mono text-[11px] text-t-muted">{formatDuration(selectedRun.duration_ms)}</div><div className="mt-1">{formatTime(selectedRun.start_time)}</div></div>
                  <button type="button" onClick={() => toggleModule("detail")} className="flex h-7 w-7 items-center justify-center rounded-md text-t-ghost hover:bg-hover hover:text-t-primary" title="收起 Run Detail" aria-label="收起 Run Detail"><PanelRightClose size={14} /></button>
                </div>
              </div>

              {selectedRun.run_type === "llm" && <div className="mt-4 grid grid-cols-3 gap-2"><DetailStat label="Finish Reason" value={String(selectedRun.outputs?.finish_reason || "unknown")} /><DetailStat label="Tool Calls" value={String(selectedRun.outputs?.tool_call_count ?? (selectedRun.outputs?.tool_calls as unknown[])?.length ?? 0)} /><DetailStat label="Response Model" value={String((selectedRun.outputs?.response_metadata as Record<string, unknown>)?.model || "-")} /></div>}
              {selectedRun.error && <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[11px] text-red-500">{selectedRun.error}</div>}

              <div className="mt-5 inline-flex items-center gap-1 rounded-lg bg-elevated/45 p-1">
                {(["input", "output", "metadata", "events"] as DetailTab[]).map((tab) => (
                  <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`relative rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${activeTab === tab ? "bg-active text-t-primary shadow-sm" : "text-t-ghost hover:text-t-muted"}`}>
                    {tab === "input" ? "Input" : tab === "output" ? "Output" : tab === "metadata" ? "Metadata" : "Events"}
                  </button>
                ))}
              </div>
              <div className="mt-3"><JsonViewer value={tabValue} loading={payloadLoading} /></div>
            </div>
          ) : payloadLoading ? <PanelLoading rows={4} /> : <div className="flex h-full items-center justify-center text-[11px] text-t-ghost">选择一个 Run 查看详情</div>}
        </section>
        )}
      </div>
    </div>
  );
}

function Badge({ children, warn = false }: { children: React.ReactNode; warn?: boolean }) {
  return <span className={`rounded px-1.5 py-0.5 text-[9px] ${warn ? "bg-amber-500/10 text-amber-600" : "bg-elevated text-t-muted"}`}>{children}</span>;
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-elevated/45 p-3"><div className="text-[9px] text-t-ghost">{label}</div><div className="mt-1 truncate font-mono text-[11px] text-t-primary" title={value}>{value}</div></div>;
}

function ModuleHeader({ label, count, onCollapse }: { label: string; count: number; onCollapse: () => void }) {
  return (
    <div className="group flex h-10 shrink-0 items-center justify-between px-3 [&>button]:opacity-0 [&>button]:transition-opacity [&>button:focus]:opacity-100 [&>button:hover]:opacity-100 [&:hover>button]:opacity-100">
      <div className="flex items-center gap-2"><span className="text-[11px] font-medium text-t-muted">{label}</span><span className="font-mono text-[9px] text-t-ghost">{count}</span></div>
      <button type="button" onClick={onCollapse} className="flex h-7 w-7 items-center justify-center rounded-md text-t-ghost hover:bg-hover hover:text-t-primary" title={`收起 ${label}`} aria-label={`收起 ${label}`}><PanelLeftClose size={14} /></button>
    </div>
  );
}

function CollapsedRail({ label, icon: Icon, onExpand, fill = false }: { label: string; icon: typeof Activity; onExpand: () => void; fill?: boolean }) {
  return (
    <div className={`flex w-10 shrink-0 flex-col items-center rounded-xl bg-base/45 py-2 ${fill ? "mr-auto" : ""}`}>
      <button type="button" onClick={onExpand} className="flex h-7 w-7 items-center justify-center rounded-md text-t-muted hover:bg-hover hover:text-t-primary" title={`展开 ${label}`} aria-label={`展开 ${label}`}>
        {fill ? <PanelRightOpen size={14} /> : <PanelLeftOpen size={14} />}
      </button>
      <Icon size={13} className="mt-3 text-t-ghost" />
      <span className="mt-2 text-[9px] font-medium tracking-wide text-t-ghost [writing-mode:vertical-rl]">{label}</span>
    </div>
  );
}
