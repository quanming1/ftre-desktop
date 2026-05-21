/**
 * ScheduledTaskPanel — 定时任务面板（只读）
 *
 * 参考截图风格：大标题 + 描述预览 + 底部元信息行
 */
import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw, Clock, Repeat, Calendar, Loader2, Shield, ChevronDown, Send,
} from "lucide-react";
import { wsClient } from "@/services/websocket-client";

// ─── Types ──────────────────────────────────────────────────────────

interface CronSchedule {
  kind: "at" | "every" | "cron";
  at_ms?: number | null;
  every_ms?: number | null;
  expr?: string | null;
  tz?: string | null;
}

interface CronPayload {
  kind: "system_event" | "agent_turn";
  message: string;
  deliver: boolean;
  channel?: string | null;
  to?: string | null;
  session_key?: string | null;
}

interface CronJobState {
  next_run_at_ms?: number | null;
  last_run_at_ms?: number | null;
  last_status?: "ok" | "error" | "skipped" | null;
  last_error?: string | null;
  run_history?: Array<{
    run_at_ms: number;
    status: string;
    duration_ms: number;
    error?: string | null;
  }>;
}

interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  state: CronJobState;
  created_at_ms: number;
  updated_at_ms: number;
  delete_after_run: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────

function fmtTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const today = new Date();
  const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  if (isToday) return `今天 ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtInterval(schedule: CronSchedule): string {
  if (schedule.kind === "cron" && schedule.expr) return schedule.expr;
  if (schedule.kind === "every" && schedule.every_ms) {
    const ms = schedule.every_ms;
    if (ms % 86_400_000 === 0) return `每 ${ms / 86_400_000} 天`;
    if (ms % 3_600_000 === 0) return `每 ${ms / 3_600_000} 小时`;
    if (ms % 60_000 === 0) return `每 ${ms / 60_000} 分钟`;
    return `每 ${ms / 1000} 秒`;
  }
  if (schedule.kind === "at") return "单次执行";
  return "—";
}

function scheduleIcon(kind: string) {
  if (kind === "cron") return Calendar;
  if (kind === "every") return Repeat;
  return Clock;
}

function statusLabel(job: CronJob): { text: string; cls: string } {
  if (!job.enabled) return { text: "已禁用", cls: "text-t-ghost" };
  if (job.state.last_status === "error") return { text: "失败", cls: "text-red-400" };
  if (job.state.last_status === "ok") return { text: "成功", cls: "text-neon" };
  return { text: "待机", cls: "text-t-dim" };
}

// ─── Job Card ───────────────────────────────────────────────────────

function JobCard({ job }: { job: CronJob }) {
  const [expanded, setExpanded] = useState(false);
  const isSystem = job.payload.kind === "system_event";
  const Icon = scheduleIcon(job.schedule.kind);
  const status = statusLabel(job);

  const description = isSystem
    ? (job.name === "dream" ? "长期记忆整合 — 定期将短期对话记忆合并到长期知识库" : "系统内部维护任务")
    : job.payload.message || "";

  return (
    <div className="px-5 py-4 rounded-xl border border-border/30 hover:bg-surface transition-colors">
      {/* Row 1: Title + toggle — clickable */}
      <div
        className="flex items-start gap-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Icon */}
        <div className={`mt-1 shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
          isSystem ? "bg-amber-400/10" : "bg-neon/10"
        }`}>
          {isSystem
            ? <Shield size={14} className="text-amber-400/70" />
            : <Icon size={14} className="text-neon/70" />
          }
        </div>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3 className="text-[18px] text-t-primary font-medium leading-tight truncate">
            {job.name}
          </h3>

          {/* Description preview (1 line) */}
          {description && (
            <p className="text-[12px] text-t-dim mt-1 leading-relaxed line-clamp-1">
              {description}
            </p>
          )}

          {/* Meta row: interval · last run · status */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[11px] text-t-muted">
              <Icon size={10} className="text-t-ghost" />
              {fmtInterval(job.schedule)}
            </span>

            {job.state.last_run_at_ms && (
              <>
                <span className="text-t-ghost text-[11px]">·</span>
                <span className="text-[11px] text-t-dim">
                  上次执行 {fmtTime(job.state.last_run_at_ms)}
                </span>
              </>
            )}

            <span className="text-t-ghost text-[11px]">·</span>
            <span className={`text-[11px] font-medium ${status.cls}`}>
              {status.text}
            </span>

            {job.payload.channel && (
              <>
                <span className="text-t-ghost text-[11px]">·</span>
                <span className="inline-flex items-center gap-1 text-[11px] text-t-dim">
                  <Send size={9} className="text-t-ghost" />
                  {job.payload.channel}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Chevron indicator */}
        <ChevronDown
          size={14}
          className={`shrink-0 mt-2 text-t-ghost transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
        />
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 ml-9 space-y-3">
          {/* Full message */}
          {description && (
            <div className="px-3 py-2.5 rounded-md bg-elevated border border-border/50">
              <p className="text-[12px] text-t-secondary leading-relaxed whitespace-pre-wrap break-words">
                {description}
              </p>
            </div>
          )}

          {/* Delivery */}
          {job.payload.deliver && job.payload.channel && job.payload.to && (
            <div className="flex items-center gap-1.5 text-[11px] text-t-dim">
              <Send size={10} className="text-t-ghost" />
              <span>{job.payload.channel}</span>
              <span className="text-t-ghost">→</span>
              <span className="text-t-muted">{job.payload.to}</span>
            </div>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-2 @[500px]:grid-cols-3 gap-x-6 gap-y-2">
            <MetaField label="下次运行" value={fmtTime(job.state.next_run_at_ms)} />
            <MetaField label="上次运行" value={fmtTime(job.state.last_run_at_ms)} />
            <MetaField label="任务 ID" value={job.id} />
            {job.schedule.tz && <MetaField label="时区" value={job.schedule.tz} />}
          </div>

          {/* Error */}
          {job.state.last_error && (
            <div className="px-3 py-2 rounded-md bg-red-400/[0.04] border border-red-400/[0.08]">
              <p className="text-[11px] text-red-400/70 leading-relaxed">{job.state.last_error}</p>
            </div>
          )}

          {/* Run history */}
          {job.state.run_history && job.state.run_history.length > 0 && (
            <RunHistory runs={job.state.run_history} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Run History ────────────────────────────────────────────────────

interface RunRecord {
  run_at_ms: number;
  status: string;
  duration_ms: number;
  error?: string | null;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remainSec = Math.round(sec % 60);
  return `${min}m${remainSec}s`;
}

function RunHistory({ runs }: { runs: RunRecord[] }) {
  const total = runs.length;
  const okCount = runs.filter((r) => r.status === "ok").length;
  const errorCount = runs.filter((r) => r.status === "error").length;
  const avgDuration = total > 0 ? Math.round(runs.reduce((s, r) => s + r.duration_ms, 0) / total) : 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[11px] text-t-muted">执行记录</span>
        <span className="text-[10px] text-t-ghost">
          {okCount} 成功{errorCount > 0 ? ` · ${errorCount} 失败` : ""} · 平均 {fmtDuration(avgDuration)}
        </span>
      </div>

      {/* Run list */}
      <div className="space-y-1">
        {runs.slice(0, 8).map((run, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-2 rounded-md bg-hover text-[11px]"
          >
            <span className={`font-medium ${
              run.status === "ok" ? "text-neon/70" : run.status === "error" ? "text-red-400/70" : "text-t-ghost"
            }`}>
              {run.status === "ok" ? "成功" : run.status === "error" ? "失败" : "跳过"}
            </span>
            <span className="text-t-dim font-mono">{fmtTime(run.run_at_ms)}</span>
            <span className="text-t-ghost font-mono">{fmtDuration(run.duration_ms)}</span>
            {run.error && (
              <span className="flex-1 text-red-400/50 truncate text-[10px]">{run.error}</span>
            )}
          </div>
        ))}
      </div>

      {total > 8 && (
        <p className="text-[10px] text-t-ghost mt-1.5 pl-3">还有 {total - 8} 条</p>
      )}
    </div>
  );
}

// ─── Meta Field ─────────────────────────────────────────────────────

function MetaField({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="py-1">
      <div className="text-[10px] text-t-ghost">{label}</div>
      <div className={`text-[12px] font-mono mt-0.5 ${valueClass || "text-t-muted"}`}>{value}</div>
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────

export function ScheduledTaskPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const wsUrl = wsClient.url;
      const httpUrl = wsUrl.replace(/^ws(s?):\/\//, "http$1://").replace(/\/$/, "");
      const resp = await fetch(`${httpUrl}/api/cron/jobs`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setJobs(data.jobs || []);
    } catch (e: any) {
      setError(e.message || "加载失败");
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const enabledCount = jobs.filter((j) => j.enabled).length;

  return (
    <div className="h-full flex flex-col bg-surface @container">
      {/* Header */}
      <div className="shrink-0 px-5 py-4 flex items-center justify-between border-b border-border/50">
        <div>
          <h1 className="text-[17px] text-t-primary font-semibold">定时任务</h1>
          <p className="text-[11px] text-t-dim mt-0.5">{enabledCount} 个任务运行中</p>
        </div>
        <button
          onClick={fetchJobs}
          disabled={loading}
          className="p-2 rounded-md text-t-secondary bg-elevated hover:bg-panel hover:text-neon transition-colors disabled:opacity-30"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && jobs.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={16} className="text-t-ghost animate-spin" />
          </div>
        )}

        {error && !loading && (
          <div className="text-center px-4 py-12">
            <p className="text-[12px] text-red-400/60">{error}</p>
            <button
              onClick={fetchJobs}
              className="mt-2 text-[11px] text-t-ghost hover:text-neon transition-colors"
            >
              重试
            </button>
          </div>
        )}

        {!loading && !error && jobs.length === 0 && (
          <div className="text-center px-4 py-16">
            <p className="text-[14px] text-t-dim">暂无定时任务</p>
            <p className="text-[12px] text-t-ghost mt-1">在对话中让 AI 创建定时提醒</p>
          </div>
        )}

        {jobs.map((job) => (
          <div key={job.id} className="px-4 py-1.5">
            <JobCard job={job} />
          </div>
        ))}
      </div>
    </div>
  );
}
