import { useState, useMemo } from 'react';
import {
  Loader2, ChevronDown, ChevronRight, ChevronLeft, ChevronsRight,
  RefreshCw, FileArchive, Brain, Timer, Zap, Terminal,
} from 'lucide-react';
import {
  useTaskStore,
  PAGE_SIZE_OPTIONS,
  type TaskStatusFilter, type TaskTypeFilter, type PageSize,
} from '@/stores/task';
import type { TaskItem } from '@/services/api';

// ─── 辅助 ──────────────────────────────────────────────────────────

function fmtTime(ts: number) {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtRelative(ts: number) {
  if (!ts) return '-';
  const diff = Date.now() / 1000 - ts;
  if (diff < 0) return 'just now';
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function fmtDuration(s: number, e: number) {
  if (!s) return '-';
  const d = (e > 0 ? e : Date.now() / 1000) - s;
  if (d < 1) return '<1s';
  if (d < 60) return `${Math.floor(d)}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m${Math.floor(d % 60)}s`;
  return `${Math.floor(d / 3600)}h${Math.floor((d % 3600) / 60)}m`;
}

// ─── 状态 & 类型配置 ────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; dot: string; text: string }> = {
  pending:   { label: 'Pending',   dot: 'bg-white/40',                                                    text: 'text-white/50' },
  running:   { label: 'Running',   dot: 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,.5)] animate-pulse',  text: 'text-sky-400' },
  completed: { label: 'Done',      dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,.4)]',            text: 'text-emerald-400' },
  failed:    { label: 'Failed',    dot: 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,.4)]',               text: 'text-red-400' },
  stopped:   { label: 'Stopped',   dot: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,.4)]',              text: 'text-amber-400' },
};

const TYPE_CFG: Record<string, { label: string; color: string; Icon: typeof FileArchive }> = {
  compaction:       { label: 'Compact',  color: 'text-sky-400/80',    Icon: FileArchive },
  memory_update:    { label: 'Memory',   color: 'text-amber-400/80',  Icon: Brain },
  scheduled:        { label: 'Sched',    color: 'text-emerald-400/80', Icon: Timer },
  scheduled_result: { label: 'Run',      color: 'text-violet-400/80', Icon: Zap },
};

const STATUS_FILTERS: { value: TaskStatusFilter; label: string }[] = [
  { value: '',          label: 'All' },
  { value: 'pending',   label: 'Pending' },
  { value: 'running',   label: 'Running' },
  { value: 'completed', label: 'Done' },
  { value: 'failed',    label: 'Failed' },
  { value: 'stopped',   label: 'Stopped' },
];

const TYPE_FILTERS: { value: TaskTypeFilter; label: string }[] = [
  { value: '',                label: 'All' },
  { value: 'compaction',      label: 'Compact' },
  { value: 'memory_update',   label: 'Memory' },
  { value: 'scheduled',       label: 'Sched' },
  { value: 'scheduled_result', label: 'Run' },
];

// ─── 小组件 ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] || STATUS_CFG.pending;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      <span className={`text-[11px] font-medium ${c.text}`}>{c.label}</span>
    </span>
  );
}

function TypeIcon({ type }: { type: string }) {
  const c = TYPE_CFG[type] || { label: type, color: 'text-t-ghost', Icon: Terminal };
  const { Icon, color, label } = c;
  return (
    <span className={`inline-flex items-center gap-1 ${color}`} title={label}>
      <Icon size={12} />
      <span className="text-[11px]">{label}</span>
    </span>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-white/40">{label}</span>
      <span className={`text-[11px] text-white/70 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

// ─── 展开详情 ───────────────────────────────────────────────────────

function DetailPanel({ task }: { task: TaskItem }) {
  const d = task.data;
  const [showResult, setShowResult] = useState(false);
  const result = String(d.result || '');
  const hasResult = result && result !== '(无回复)';

  return (
    <div className="px-5 py-3 space-y-3 bg-white/[0.015]">
      <div className="grid grid-cols-3 gap-x-6 gap-y-2">
        <Field label="Task ID" value={task.id.slice(0, 12)} mono />
        <Field label="Session" value={task.session_id ? task.session_id.slice(0, 12) : '-'} mono />
        <Field label="Duration" value={fmtDuration(task.started_at, task.completed_at)} />
        <Field label="Created" value={fmtTime(task.created_at)} />
        <Field label="Started" value={fmtTime(task.started_at)} />
        <Field label="Completed" value={fmtTime(task.completed_at)} />
      </div>

      {/* 类型专属字段 */}
      {task.type === 'compaction' && (
        <div className="grid grid-cols-3 gap-x-6 gap-y-2 pt-2 border-t border-white/[0.04]">
          <Field label="Parent ID" value={String(d.parent_id || '-')} mono />
          {d.elapsed !== undefined && <Field label="Agent Time" value={`${d.elapsed}s`} />}
          {d.submitted !== undefined && <Field label="Submitted" value={d.submitted ? 'Yes' : 'No'} />}
        </div>
      )}

      {task.type === 'memory_update' && (
        <div className="space-y-2 pt-2 border-t border-white/[0.04]">
          <div className="grid grid-cols-3 gap-x-6 gap-y-2">
            {d.workspace != null && <Field label="Workspace" value={String(d.workspace)} />}
            {d.elapsed !== undefined && <Field label="Agent Time" value={`${d.elapsed}s`} />}
          </div>
          {hasResult && (
            <div>
              <button onClick={() => setShowResult(!showResult)} className="text-[10px] uppercase tracking-wider text-amber-400/60 hover:text-amber-400 transition-colors">
                {showResult ? '▾ Result' : '▸ Result'}
              </button>
              {showResult && (
                <pre className="mt-1.5 p-2.5 rounded-md bg-black/30 border border-white/[0.06] text-[11px] text-white/60 font-mono leading-relaxed whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
                  {result}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {task.type === 'scheduled' && (
        <div className="grid grid-cols-3 gap-x-6 gap-y-2 pt-2 border-t border-white/[0.04]">
          <Field label="Name" value={String(d.name || '-')} />
          <Field label="Strategy" value={String(d.strategy || '-')} />
          <Field label="Cron" value={String(d.cron || '-')} mono />
          <Field label="Next Run" value={d.next_run_at ? fmtTime(d.next_run_at as number) : '-'} />
          <Field label="Workspace" value={String(d.workspace || '-')} />
          <Field label="Runs" value={String(d.run_count ?? 0)} />
        </div>
      )}

      {task.type === 'scheduled_result' && (
        <div className="space-y-2 pt-2 border-t border-white/[0.04]">
          <div className="grid grid-cols-3 gap-x-6 gap-y-2">
            <Field label="Strategy" value={String(d.strategy || '-')} />
            <Field label="Workspace" value={String(d.workspace || '-')} />
            {d.session_id ? <Field label="Session" value={String(d.session_id).slice(0, 12)} mono /> : null}
          </div>
          {hasResult && (
            <pre className="p-2.5 rounded-md bg-black/30 border border-white/[0.06] text-[11px] text-white/60 font-mono leading-relaxed whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
              {result}
            </pre>
          )}
        </div>
      )}

      {/* 未知类型 fallback */}
      {!['compaction', 'memory_update', 'scheduled', 'scheduled_result'].includes(task.type) && Object.keys(d).length > 0 && (
        <pre className="p-2.5 rounded-md bg-black/30 border border-white/[0.06] text-[11px] text-white/60 font-mono whitespace-pre-wrap break-all">
          {JSON.stringify(d, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── 任务行 ─────────────────────────────────────────────────────────

function TaskRow({ task }: { task: TaskItem }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`border-b border-white/[0.03] ${open ? 'bg-white/[0.02]' : ''}`}>
      <div
        onClick={() => setOpen(!open)}
        className="h-9 px-4 flex items-center gap-4 cursor-pointer hover:bg-white/[0.03] transition-colors"
      >
        <ChevronRight size={11} className={`text-white/20 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <div className="w-[72px] shrink-0"><StatusBadge status={task.status} /></div>
        <div className="w-[68px] shrink-0"><TypeIcon type={task.type} /></div>
        <div className="flex-1 text-[11px] text-white/50 font-mono truncate">{task.id.slice(0, 16)}</div>
        <div className="w-12 text-[11px] text-white/45 font-mono text-right shrink-0" title={fmtTime(task.created_at)}>
          {fmtRelative(task.created_at)}
        </div>
        <div className="w-14 text-[11px] text-white/45 font-mono text-right shrink-0">
          {fmtDuration(task.started_at, task.completed_at)}
        </div>
      </div>
      {open && <DetailPanel task={task} />}
    </div>
  );
}

// ─── 工具栏 ─────────────────────────────────────────────────────────

function PillFilter<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-md p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
            value === o.value
              ? 'bg-white/[0.08] text-white/80'
              : 'text-white/45 hover:text-white/60'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── 分页 ────────────────────────────────────────────────────────────

function Pagination() {
  const page = useTaskStore((s) => s.page);
  const pageSize = useTaskStore((s) => s.pageSize);
  const total = useTaskStore((s) => s.total);
  const totalPages = useTaskStore((s) => s.totalPages());
  const setPage = useTaskStore((s) => s.setPage);
  const setPageSize = useTaskStore((s) => s.setPageSize);

  const pages = useMemo(() => {
    const arr: number[] = [];
    const max = 5;
    let s = Math.max(1, page - Math.floor(max / 2));
    const e = Math.min(totalPages, s + max - 1);
    s = Math.max(1, e - max + 1);
    for (let i = s; i <= e; i++) arr.push(i);
    return arr;
  }, [page, totalPages]);

  if (total === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="shrink-0 h-8 px-4 flex items-center border-t border-white/[0.04] text-[11px] font-mono text-white/50">
      <span>{start}–{end} of {total}</span>
      <select
        value={pageSize}
        onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
        className="ml-3 bg-transparent text-[11px] text-white/50 font-mono outline-none cursor-pointer"
      >
        {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n} className="bg-[#111]">{n}/page</option>)}
      </select>

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        <PgBtn onClick={() => setPage(page - 1)} disabled={page <= 1}><ChevronLeft size={12} /></PgBtn>
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => setPage(p)}
            className={`w-5 h-5 flex items-center justify-center rounded text-[11px] transition-colors ${
              p === page ? 'bg-white/[0.08] text-white/80' : 'text-white/45 hover:text-white/60'
            }`}
          >
            {p}
          </button>
        ))}
        <PgBtn onClick={() => setPage(page + 1)} disabled={page >= totalPages}><ChevronsRight size={12} /></PgBtn>
      </div>
    </div>
  );
}

function PgBtn({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`p-0.5 transition-colors ${disabled ? 'text-white/15' : 'text-white/45 hover:text-white/70'}`}>
      {children}
    </button>
  );
}

// ─── 主面板 ─────────────────────────────────────────────────────────

export function TaskPanel() {
  const tasks = useTaskStore((s) => s.tasks);
  const total = useTaskStore((s) => s.total);
  const loading = useTaskStore((s) => s.loading);
  const filters = useTaskStore((s) => s.filters);
  const setFilter = useTaskStore((s) => s.setFilter);
  const loadTasks = useTaskStore((s) => s.loadTasks);

  const stats = useMemo(() => {
    const c = { running: 0, failed: 0 };
    for (const t of tasks) {
      if (t.status === 'running') c.running++;
      if (t.status === 'failed') c.failed++;
    }
    return c;
  }, [tasks]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0c0c0c]">
      {/* 工具栏 */}
      <div className="shrink-0 px-3 py-2 flex items-center gap-3 border-b border-white/[0.04]">
        <PillFilter options={STATUS_FILTERS} value={filters.status} onChange={(v) => setFilter({ status: v })} />
        <PillFilter options={TYPE_FILTERS} value={filters.type} onChange={(v) => setFilter({ type: v })} />

        <button onClick={() => loadTasks(true)} className="p-1 rounded hover:bg-white/[0.06] transition-colors" title="Refresh">
          <RefreshCw size={12} className={`text-white/40 hover:text-white/70 ${loading ? 'animate-spin' : ''}`} />
        </button>

        <div className="flex-1" />

        <div className="flex items-center gap-3 text-[11px] font-mono">
          {stats.running > 0 && <span className="text-sky-400">{stats.running} running</span>}
          {stats.failed > 0 && <span className="text-red-400">{stats.failed} failed</span>}
          <span className="text-white/40">{total} total</span>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            {loading
              ? <Loader2 size={16} className="text-white/30 animate-spin" />
              : <>
                  <Terminal size={20} className="text-white/20" />
                  <span className="text-[12px] text-white/35 font-mono">No tasks</span>
                </>
            }
          </div>
        ) : (
          tasks.map((task) => <TaskRow key={task.id} task={task} />)
        )}
      </div>

      <Pagination />
    </div>
  );
}
