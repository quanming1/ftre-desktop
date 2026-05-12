import { useState, useEffect, useRef, useCallback } from 'react';
import {
    Plus, RefreshCw, Trash2, Play, History, Timer, StopCircle,
    ChevronDown, ChevronRight, Loader2, X, FolderOpen,
    Clock, Calendar, CalendarDays, Repeat, Pen, MoreHorizontal,
    Info,
} from 'lucide-react';
import { useScheduledTaskStore } from '@/stores/scheduled-task';
import { useWorkspace } from '@/stores/workspace';
import { useChat } from '@/stores/chat';
import type { TaskItem } from '@/services/api';
import { fetchChatAgents, updateScheduledTask, fetchLLMProviders, type ChatAgent } from '@/services/api';

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
    if (diff < 0) {
        const a = Math.abs(diff);
        if (a < 60) return `in ${Math.floor(a)}s`;
        if (a < 3600) return `in ${Math.floor(a / 60)}m`;
        if (a < 86400) return `in ${Math.floor(a / 3600)}h`;
        return `in ${Math.floor(a / 86400)}d`;
    }
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function fmtDuration(s: number, e: number) {
    if (!s) return '-';
    const d = (e > 0 ? e : Date.now() / 1000) - s;
    if (d < 1) return '<1s';
    if (d < 60) return `${Math.floor(d)}s`;
    return `${Math.floor(d / 60)}m${Math.floor(d % 60)}s`;
}

function folderName(p: string) {
    return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p;
}

// ─── 状态配置 ───────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; dot: string; text: string }> = {
    pending:   { label: 'Idle',     dot: 'bg-white/40',                                                   text: 'text-white/50' },
    running:   { label: 'Running',  dot: 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,.5)] animate-pulse', text: 'text-sky-400' },
    completed: { label: 'Active',   dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,.4)]',           text: 'text-emerald-400' },
    failed:    { label: 'Failed',   dot: 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,.4)]',              text: 'text-red-400' },
    stopped:   { label: 'Stopped',  dot: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,.4)]',             text: 'text-amber-400' },
};

function StatusBadge({ status }: { status: string }) {
    const c = STATUS[status] || STATUS.pending;
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
            <span className={`text-[11px] font-medium ${c.text}`}>{c.label}</span>
        </span>
    );
}

// ─── 通用下拉选择器 ────────────────────────────────────────────────

interface DropdownOption { value: string; label: string; description?: string }

function FieldDropdown({
    value, options, onChange, placeholder, loading, footer,
}: {
    value: string; options: DropdownOption[]; onChange: (v: string) => void;
    placeholder?: string; loading?: boolean; footer?: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, [open]);
    const cur = options.find((o) => o.value === value);
    return (
        <div className="relative" ref={ref}>
            <button type="button" onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between bg-white/[0.04] border border-white/[0.08] text-[12px] font-mono py-1.5 px-2.5 rounded-md text-white/70 hover:border-white/[0.12] transition-colors">
                <span className={cur ? '' : 'text-white/35'}>{cur?.label || placeholder || 'Select...'}</span>
                <ChevronDown size={11} className="text-white/30 shrink-0" />
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-1 w-full max-h-[200px] bg-[#1a1a1a] border border-white/[0.1] rounded-lg overflow-hidden flex flex-col shadow-2xl z-[100]">
                    <div className="flex-1 overflow-y-auto py-1">
                        {loading && <div className="p-3 text-white/40 text-[11px] text-center font-mono"><Loader2 size={11} className="inline animate-spin mr-1" />Loading...</div>}
                        {!loading && options.length === 0 && <div className="p-3 text-white/30 text-[11px] text-center font-mono">No options</div>}
                        {options.map((o) => (
                            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                                className={`w-full text-left px-3 py-1.5 text-[12px] font-mono transition-colors ${
                                    value === o.value ? 'text-emerald-400 bg-emerald-400/[0.06]' : 'text-white/70 hover:bg-white/[0.06]'
                                }`}>
                                <div className="truncate">{o.label}</div>
                                {o.description && <div className="text-[10px] text-white/35 truncate">{o.description}</div>}
                            </button>
                        ))}
                    </div>
                    {footer && <div className="border-t border-white/[0.06] p-1">{footer}</div>}
                </div>
            )}
        </div>
    );
}

// ─── Cron 选择器 ────────────────────────────────────────────────────

const CRON_PRESETS = [
    { label: '30m',   value: '*/30 * * * *', icon: Repeat },
    { label: '1h',    value: '0 * * * *',    icon: Clock },
    { label: 'Daily', value: '0 9 * * *',    icon: Calendar },
    { label: 'Weekly', value: '0 9 * * 1',   icon: CalendarDays },
] as const;

function CronSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const isPreset = CRON_PRESETS.some((p) => p.value === value);
    const [custom, setCustom] = useState(!isPreset);
    return (
        <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1">
                {CRON_PRESETS.map((p) => {
                    const active = !custom && value === p.value;
                    const Icon = p.icon;
                    return (
                        <button key={p.value} type="button"
                            onClick={() => { setCustom(false); onChange(p.value); }}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono border transition-colors ${
                                active ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20' : 'text-white/50 border-white/[0.08] hover:text-white/70'
                            }`}>
                            <Icon size={10} />{p.label}
                        </button>
                    );
                })}
                <button type="button" onClick={() => setCustom(true)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono border transition-colors ${
                        custom ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20' : 'text-white/50 border-white/[0.08] hover:text-white/70'
                    }`}>
                    <Pen size={10} />Custom
                </button>
            </div>
            {custom && (
                <input className="w-full bg-white/[0.04] border border-white/[0.08] text-[12px] font-mono py-1.5 px-2.5 rounded-md text-white/70 placeholder-white/30 focus:border-emerald-400/30 outline-none transition-colors"
                    value={value} onChange={(e) => onChange(e.target.value)} placeholder="0 9 * * *" spellCheck={false} />
            )}
        </div>
    );
}

// ─── 表单共用样式 ────────────────────────────────────────────────────

const LABEL = 'text-[10px] text-white/40 font-mono mb-1 block uppercase tracking-wider';
const INPUT = 'w-full bg-white/[0.04] border border-white/[0.08] text-[12px] font-mono py-1.5 px-2.5 rounded-md text-white/70 placeholder-white/30 focus:border-emerald-400/30 outline-none transition-colors';

// ─── 创建表单 ───────────────────────────────────────────────────────

function CreateForm() {
    const form = useScheduledTaskStore((s) => s.createForm);
    const creating = useScheduledTaskStore((s) => s.creating);
    const setField = useScheduledTaskStore((s) => s.setCreateField);
    const submit = useScheduledTaskStore((s) => s.submitCreate);
    const close = useScheduledTaskStore((s) => s.closeCreateForm);
    const recentFolders = useWorkspace((s) => s.recentFolders);
    const [error, setError] = useState('');
    const [agents, setAgents] = useState<ChatAgent[]>([]);
    const [agentsLoading, setAgentsLoading] = useState(false);
    const [providers, setProviders] = useState<Array<{ vendor: string; models: Array<{ alias: string; key: string }> }>>([]);
    const [providersLoading, setProvidersLoading] = useState(false);

    useEffect(() => {
        if (!form.workspace) { setAgents([]); return; }
        setAgentsLoading(true);
        fetchChatAgents(form.workspace).then((list) => {
            const c = list.filter((a) => !a.is_builtin);
            setAgents(c);
            if (c.length > 0 && !c.some((a) => a.id === form.agentId)) setField('agentId', c[0].id);
        }).finally(() => setAgentsLoading(false));
    }, [form.workspace]);

    useEffect(() => {
        setProvidersLoading(true);
        fetchLLMProviders().then((data) => setProviders(data.map((p: any) => ({ vendor: p.vendor, models: p.models || {} })))).catch(() => {}).finally(() => setProvidersLoading(false));
    }, []);

    const handleSubmit = async () => { setError(''); const r = await submit(); if (r.error) setError(r.error); };
    const handleSelectFolder = useCallback(async () => {
        const r = await window.desktop?.fs?.selectFolder();
        if (r?.path) setField('workspace', r.path);
    }, [setField]);

    const wsOpts: DropdownOption[] = recentFolders.map((p) => ({ value: p, label: folderName(p), description: p }));
    const agentOpts: DropdownOption[] = agents.map((a) => ({ value: a.id, label: a.name, description: a.id }));
    const modelOpts: DropdownOption[] = [{ value: '', label: 'Default' }, ...providers.flatMap((p) => p.models.map((m) => ({ value: m.key, label: m.alias, description: p.vendor })))];

    return (
        <div className="border-b border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-emerald-400 font-bold text-[11px] uppercase tracking-wider font-mono">New Task</span>
                <button onClick={close} className="p-0.5 hover:bg-white/[0.06] rounded transition-colors"><X size={13} className="text-white/40" /></button>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Name</label><input className={INPUT} value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Daily research" /></div>
                <div><label className={LABEL}>Strategy</label><FieldDropdown value={form.strategy} options={[{ value: 'agent_auto', label: 'Agent Auto' }]} onChange={(v) => setField('strategy', v)} /></div>
            </div>

            <div><label className={LABEL}>Schedule</label><CronSelector value={form.cron} onChange={(v) => setField('cron', v)} /></div>

            <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Workspace</label>
                    <FieldDropdown value={form.workspace} options={wsOpts} onChange={(v) => setField('workspace', v)} placeholder="Select..."
                        footer={<button type="button" onClick={handleSelectFolder} className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono text-white/50 hover:text-white/70 hover:bg-white/[0.06] rounded transition-colors"><FolderOpen size={11} />Browse...</button>} />
                </div>
                <div><label className={LABEL}>Agent</label>
                    <FieldDropdown value={form.agentId} options={agentOpts} onChange={(v) => setField('agentId', v)} placeholder={form.workspace ? 'Select...' : 'Pick workspace first'} loading={agentsLoading} />
                </div>
            </div>

            <div><label className={LABEL}>Model</label><FieldDropdown value={form.model} options={modelOpts} onChange={(v) => setField('model', v)} loading={providersLoading} /></div>
            <div><label className={LABEL}>Prompt</label><textarea className={`${INPUT} min-h-[48px] max-h-[120px] resize-y`} value={form.prompt} onChange={(e) => setField('prompt', e.target.value)} placeholder="Leave empty for default" rows={2} /></div>

            {error && <div className="text-red-400 text-[11px] font-mono">{error}</div>}

            <div className="flex justify-end">
                <button onClick={handleSubmit} disabled={creating || !form.name || !form.cron || !form.agentId}
                    className="px-3 py-1.5 rounded-md text-[11px] font-mono bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 hover:bg-emerald-400/20 disabled:opacity-30 transition-colors">
                    {creating ? <Loader2 size={11} className="animate-spin" /> : 'Create'}
                </button>
            </div>
        </div>
    );
}

// ─── 更多操作下拉 ───────────────────────────────────────────────────

function MoreMenu({ onAction }: { onAction: (action: 'history' | 'edit' | 'delete') => void }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, [open]);

    const items = [
        { key: 'history' as const, icon: History, label: 'History', color: 'text-violet-400' },
        { key: 'edit' as const,    icon: Pen,     label: 'Edit',    color: 'text-sky-400' },
        { key: 'delete' as const,  icon: Trash2,  label: 'Delete',  color: 'text-red-400' },
    ];

    return (
        <div className="relative" ref={ref}>
            <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
                className="p-1 rounded hover:bg-white/[0.08] transition-colors" title="More">
                <MoreHorizontal size={14} className="text-white/60" />
            </button>
            {open && (
                <div className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] border border-white/[0.1] rounded-lg overflow-hidden shadow-2xl z-[100] py-1">
                    {items.map((item) => (
                        <button key={item.key}
                            onClick={(e) => { e.stopPropagation(); setOpen(false); onAction(item.key); }}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] font-mono transition-colors hover:bg-white/[0.06] ${item.color}`}>
                            <item.icon size={12} />{item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Info Tab ───────────────────────────────────────────────────────

function InfoTab({ task }: { task: TaskItem }) {
    const d = task.data;
    const config = (d.config || {}) as Record<string, string>;

    return (
        <div className="grid grid-cols-4 gap-x-4 gap-y-3">
            <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-white/40">Workspace</span>
                <span className="text-[11px] text-white/70 font-mono truncate" title={String(d.workspace || '')}>{folderName(String(d.workspace || '-'))}</span>
            </div>
            <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-white/40">Agent</span>
                <span className="text-[11px] text-white/70 font-mono">{config.agent_id || '-'}</span>
            </div>
            <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-white/40">Model</span>
                <span className="text-[11px] text-white/70 font-mono">{config.model || 'default'}</span>
            </div>
            <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-white/40">Next Run</span>
                <span className="text-[11px] text-white/70 font-mono">{d.next_run_at ? fmtTime(d.next_run_at as number) : '-'}</span>
            </div>
            <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-white/40">Task ID</span>
                <span className="text-[11px] text-white/70 font-mono">{task.id.slice(0, 16)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-white/40">Strategy</span>
                <span className="text-[11px] text-white/70 font-mono">{String(d.strategy || '-')}</span>
            </div>
            <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-white/40">Cron</span>
                <span className="text-[11px] text-white/70 font-mono">{String(d.cron || '-')}</span>
            </div>
            <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-white/40">Runs</span>
                <span className="text-[11px] text-white/70 font-mono">{String(d.run_count ?? 0)}</span>
            </div>
        </div>
    );
}

// ─── History Tab ────────────────────────────────────────────────────

function HistoryTab({ taskId }: { taskId: string }) {
    const runs = useScheduledTaskStore((s) => s.runs);
    const runsTotal = useScheduledTaskStore((s) => s.runsTotal);
    const runsLoading = useScheduledTaskStore((s) => s.runsLoading);
    const openRuns = useScheduledTaskStore((s) => s.openRuns);

    useEffect(() => {
        openRuns(taskId);
    }, [taskId]);

    if (runsLoading) {
        return <div className="flex items-center justify-center py-6"><Loader2 size={14} className="text-white/30 animate-spin" /></div>;
    }

    if (runs.length === 0) {
        return <div className="text-center text-white/35 text-[11px] font-mono py-6">No runs yet</div>;
    }

    return (
        <div className="space-y-1">
            <div className="text-[10px] text-white/40 font-mono mb-2">{runsTotal} total runs</div>
            {runs.map((r) => (
                <div key={r.id} className="flex items-center gap-3 py-1.5 px-3 rounded-md bg-white/[0.03] text-[11px] font-mono">
                    <StatusBadge status={r.status} />
                    <span className="text-white/50">{fmtTime(r.created_at)}</span>
                    <span className="text-white/40">{fmtDuration(r.started_at, r.completed_at)}</span>
                    <div className="flex-1" />
                    {r.data.result ? <span className="text-white/40 truncate max-w-[200px]" title={String(r.data.result)}>{String(r.data.result)}</span> : null}
                </div>
            ))}
        </div>
    );
}

// ─── Edit Tab ───────────────────────────────────────────────────────

function EditTab({ task }: { task: TaskItem }) {
    const d = task.data;
    const config = (d.config || {}) as Record<string, string>;
    const loadTasks = useScheduledTaskStore((s) => s.loadTasks);
    const workspace = String(d.workspace || '');

    const [name, setName] = useState(String(d.name || ''));
    const [cron, setCron] = useState(String(d.cron || ''));
    const [agentId, setAgentId] = useState(config.agent_id || '');
    const [model, setModel] = useState(config.model || '');
    const [prompt, setPrompt] = useState(config.prompt || '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [agents, setAgents] = useState<ChatAgent[]>([]);
    const [agentsLoading, setAgentsLoading] = useState(false);
    const [providers, setProviders] = useState<Array<{ vendor: string; models: Array<{ alias: string; key: string }> }>>([]);
    const [providersLoading, setProvidersLoading] = useState(false);

    useEffect(() => {
        if (!workspace) return;
        setAgentsLoading(true);
        fetchChatAgents(workspace).then((l) => setAgents(l.filter((a) => !a.is_builtin))).finally(() => setAgentsLoading(false));
    }, [workspace]);

    useEffect(() => {
        setProvidersLoading(true);
        fetchLLMProviders().then((data) => setProviders(data.map((p: any) => ({ vendor: p.vendor, models: p.models || {} })))).catch(() => {}).finally(() => setProvidersLoading(false));
    }, []);

    const agentOpts: DropdownOption[] = agents.map((a) => ({ value: a.id, label: a.name, description: a.id }));
    const modelOpts: DropdownOption[] = [{ value: '', label: 'Default' }, ...providers.flatMap((p) => p.models.map((m) => ({ value: m.key, label: m.alias, description: p.vendor })))];

    const handleSave = async () => {
        setError(''); setSaving(true); setSaved(false);
        try {
            const cfg: Record<string, unknown> = { agent_id: agentId };
            if (model) cfg.model = model;
            if (prompt.trim()) cfg.prompt = prompt.trim();
            const r = await updateScheduledTask(task.id, { name, cron, config: cfg });
            if (r.error) { setError(r.detail || r.error); return; }
            await loadTasks(false);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } finally { setSaving(false); }
    };

    return (
        <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Name</label><input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><label className={LABEL}>Strategy</label><div className="text-[12px] font-mono text-white/50 py-1.5 px-2.5">{String(d.strategy || '-')}</div></div>
            </div>

            <div><label className={LABEL}>Schedule</label><CronSelector value={cron} onChange={setCron} /></div>

            <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Workspace</label><div className="text-[12px] font-mono text-white/50 py-1.5 px-2.5 truncate" title={workspace}>{folderName(workspace)}</div></div>
                <div><label className={LABEL}>Agent</label><FieldDropdown value={agentId} options={agentOpts} onChange={setAgentId} placeholder="Select..." loading={agentsLoading} /></div>
            </div>

            <div><label className={LABEL}>Model</label><FieldDropdown value={model} options={modelOpts} onChange={setModel} loading={providersLoading} /></div>
            <div><label className={LABEL}>Prompt</label><textarea className={`${INPUT} min-h-[48px] max-h-[120px] resize-y`} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Leave empty for default" rows={2} /></div>

            {error && <div className="text-red-400 text-[11px] font-mono">{error}</div>}

            <div className="flex justify-end">
                <button onClick={handleSave} disabled={saving || !name || !cron || !agentId}
                    className="px-3 py-1.5 rounded-md text-[11px] font-mono bg-sky-400/10 text-sky-400 border border-sky-400/20 hover:bg-sky-400/20 disabled:opacity-30 transition-colors">
                    {saving ? <Loader2 size={11} className="animate-spin" /> : saved ? '✓ Saved' : 'Save'}
                </button>
            </div>
        </div>
    );
}

// ─── 展开区域 Tab 栏 ────────────────────────────────────────────────

type DetailTab = 'info' | 'history' | 'edit';

function DetailTabBar({ active, onChange }: { active: DetailTab; onChange: (t: DetailTab) => void }) {
    const tabs: { key: DetailTab; label: string; icon: typeof Info }[] = [
        { key: 'info',    label: 'Info',    icon: Info },
        { key: 'history', label: 'History', icon: History },
        { key: 'edit',    label: 'Edit',    icon: Pen },
    ];
    return (
        <div className="flex items-center gap-0.5 mb-3">
            {tabs.map((t) => (
                <button key={t.key} onClick={(e) => { e.stopPropagation(); onChange(t.key); }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono transition-colors ${
                        active === t.key
                            ? 'bg-white/[0.08] text-white/80'
                            : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]'
                    }`}>
                    <t.icon size={11} />{t.label}
                </button>
            ))}
        </div>
    );
}

// ─── 任务行 ─────────────────────────────────────────────────────────

function ScheduledTaskRow({ task }: { task: TaskItem }) {
    const [expanded, setExpanded] = useState(false);
    const [activeTab, setActiveTab] = useState<DetailTab>('info');
    const triggerTask = useScheduledTaskStore((s) => s.triggerTask);
    const cancelTask = useScheduledTaskStore((s) => s.cancelTask);
    const deleteTask = useScheduledTaskStore((s) => s.deleteTask);
    const d = task.data;
    const isRunning = task.status === 'running';

    const handleMoreAction = (action: 'history' | 'edit' | 'delete') => {
        if (action === 'delete') {
            if (confirm('Delete this task?')) deleteTask(task.id);
            return;
        }
        setActiveTab(action);
        setExpanded(true);
    };

    return (
        <div className={`border-b border-white/[0.04] ${expanded ? 'bg-white/[0.015]' : ''}`}>
            {/* 主行 — group 用于 hover 显示操作按钮 */}
            <div onClick={() => setExpanded(!expanded)}
                className="group h-10 px-4 flex items-center gap-3 cursor-pointer hover:bg-white/[0.04] transition-colors">
                <ChevronRight size={11} className={`text-white/25 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                <div className="w-[76px] shrink-0"><StatusBadge status={task.status} /></div>
                <div className="flex-1 text-[12px] text-white/70 font-mono truncate min-w-0">{String(d.name || '-')}</div>

                {/* 右侧信息（默认可见，hover 时隐藏） */}
                <div className="flex items-center gap-3 group-hover:hidden">
                    <span className="text-[11px] text-white/45 font-mono shrink-0">{String(d.cron || '')}</span>
                    <span className="w-16 text-[11px] text-white/40 font-mono text-right shrink-0" title={d.next_run_at ? fmtTime(d.next_run_at as number) : ''}>
                        {d.next_run_at ? fmtRelative(d.next_run_at as number) : '-'}
                    </span>
                    <span className="w-8 text-[11px] text-white/35 font-mono text-right shrink-0">#{String(d.run_count ?? 0)}</span>
                </div>

                {/* 操作按钮（默认隐藏，hover 时显示） */}
                <div className="hidden group-hover:flex items-center gap-1">
                    {isRunning ? (
                        <button onClick={(e) => { e.stopPropagation(); cancelTask(task.id); }}
                            className="p-1 rounded hover:bg-amber-400/10 transition-colors" title="Stop">
                            <StopCircle size={14} className="text-amber-400/70 hover:text-amber-400" />
                        </button>
                    ) : (
                        <button onClick={(e) => { e.stopPropagation(); triggerTask(task.id); }}
                            className="p-1 rounded hover:bg-sky-400/10 transition-colors" title="Run Now">
                            <Play size={14} className="text-sky-400/70 hover:text-sky-400" />
                        </button>
                    )}
                    <MoreMenu onAction={handleMoreAction} />
                </div>
            </div>

            {/* 展开区域 — 行内 Tab */}
            {expanded && (
                <div className="px-5 pb-4 pt-1">
                    <DetailTabBar active={activeTab} onChange={setActiveTab} />
                    {activeTab === 'info' && <InfoTab task={task} />}
                    {activeTab === 'history' && <HistoryTab taskId={task.id} />}
                    {activeTab === 'edit' && <EditTab task={task} />}
                </div>
            )}
        </div>
    );
}

// ─── 主面板 ─────────────────────────────────────────────────────────

export function ScheduledTaskPanel() {
    const tasks = useScheduledTaskStore((s) => s.tasks);
    const loading = useScheduledTaskStore((s) => s.loading);
    const showCreateForm = useScheduledTaskStore((s) => s.showCreateForm);
    const openCreateForm = useScheduledTaskStore((s) => s.openCreateForm);
    const loadTasks = useScheduledTaskStore((s) => s.loadTasks);
    const rootPath = useWorkspace((s) => s.rootPath);
    const model = useChat((s) => s.model);

    const runningCount = tasks.filter((t) => t.status === 'running').length;

    return (
        <div className="h-full flex flex-col overflow-hidden bg-[#0c0c0c]">
            {/* 工具栏 */}
            <div className="shrink-0 px-3 py-2 flex items-center gap-3 border-b border-white/[0.06]">
                <button onClick={() => openCreateForm(rootPath || '', model)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 hover:bg-emerald-400/20 transition-colors">
                    <Plus size={11} />New
                </button>
                <button onClick={() => loadTasks(true)} className="p-1 rounded hover:bg-white/[0.06] transition-colors" title="Refresh">
                    <RefreshCw size={12} className={`text-white/40 hover:text-white/70 ${loading ? 'animate-spin' : ''}`} />
                </button>
                <div className="flex-1" />
                <div className="flex items-center gap-3 text-[11px] font-mono">
                    {runningCount > 0 && <span className="text-sky-400">{runningCount} running</span>}
                    <span className="text-white/40">{tasks.length} tasks</span>
                </div>
            </div>

            {showCreateForm && <CreateForm />}

            {/* 列表 */}
            <div className="flex-1 overflow-y-auto">
                {tasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2">
                        {loading ? <Loader2 size={16} className="text-white/30 animate-spin" /> : (
                            <>
                                <Timer size={20} className="text-white/20" />
                                <span className="text-[12px] text-white/35 font-mono">No scheduled tasks</span>
                                <button onClick={() => openCreateForm(rootPath || '', model)}
                                    className="mt-1 text-[11px] text-emerald-400/60 hover:text-emerald-400 font-mono transition-colors">
                                    + Create one
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                    tasks.map((task) => <ScheduledTaskRow key={task.id} task={task} />)
                )}
            </div>
        </div>
    );
}
