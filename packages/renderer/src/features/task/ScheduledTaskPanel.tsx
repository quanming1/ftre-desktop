/**
 * ScheduledTaskPanel — 定时任务面板（CRUD）
 *
 * 后端契约（~/.ftre/cron/<job_id>.json）：
 *   { id, cron, title, prompt, disabled, created_at, run_history: number[] }
 *
 * UI:
 *   - 顶部：标题 + 刷新 + 新建按钮
 *   - 列表：卡片式，点击展开详情；hover 时显示启停 / 编辑 / 删除
 *   - 编辑/创建：行内表单 sheet（cron / title / prompt + 启用开关）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  RefreshCw,
  Calendar,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  X,
  AlertCircle,
  Power,
  PowerOff,
} from "lucide-react";
import { Switch } from "@ftre/ui";
import {
  fetchCronJobs,
  createCronJob,
  updateCronJob,
  deleteCronJob,
  type CronJob,
  type CronJobInput,
} from "@/services/api";
import { useNotification } from "@/stores/notification";

// ─── Helpers ────────────────────────────────────────────────────────


function fmtRelative(ts: number | undefined | null): string {
  if (!ts) return "—";
  const seconds = ts < 1e12 ? ts : ts / 1000;
  const diff = Date.now() / 1000 - seconds;
  if (diff < 0) return "刚刚";
  if (diff < 60) return `${Math.floor(diff)}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

/** 5 段 cron 简单合法性自检（前端立即反馈，正式校验由后端 croniter 做）*/
function quickValidateCron(expr: string): string | null {
  const trimmed = expr.trim();
  if (!trimmed) return "cron 表达式不能为空";
  const segs = trimmed.split(/\s+/);
  if (segs.length !== 5) {
    return "cron 表达式必须是 5 段（分 时 日 月 周）";
  }
  return null;
}

// ─── Job Card ───────────────────────────────────────────────────────

function JobCard({
  job,
  onEdit,
  onDelete,
  onToggleDisabled,
}: {
  job: CronJob;
  onEdit: () => void;
  onDelete: () => void;
  onToggleDisabled: () => void;
}) {
  const history = job.run_history || [];
  const lastRun = history.length > 0 ? history[history.length - 1] : undefined;
  const isDisabled = !!job.disabled;

  return (
    <div
      className={`px-5 py-4 rounded-xl border transition-colors ${
        isDisabled
          ? "border-border/30 bg-elevated/20 opacity-70 hover:opacity-100"
          : "border-border/30 hover:bg-surface"
      }`}
    >
      {/* Row 1: 标题 + 操作按钮 */}
      <div className="flex items-start gap-3">
        <button
          onClick={onEdit}
          className="flex-1 min-w-0 flex items-start gap-3 text-left"
        >
          {/* Icon */}
          <div
            className={`mt-1 shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
              isDisabled ? "bg-hover" : "bg-neon/10"
            }`}
          >
            <Calendar
              size={14}
              className={isDisabled ? "text-t-ghost" : "text-neon/70"}
            />
          </div>

          <div className="flex-1 min-w-0">
            {/* Title */}
            <div className="flex items-center gap-2 min-w-0">
              <h3
                className={`text-[15px] font-medium leading-tight truncate ${
                  isDisabled ? "text-t-muted line-through decoration-t-ghost/40" : "text-t-primary"
                }`}
              >
                {job.title}
              </h3>
              {isDisabled && (
                <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-hover text-t-muted border border-border-subtle">
                  <PowerOff size={9} />
                  已禁用
                </span>
              )}
            </div>

            {/* Prompt 预览 */}
            {job.prompt && (
              <p className="text-[12px] text-t-dim mt-1 leading-relaxed line-clamp-1">
                {job.prompt}
              </p>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[11px] font-mono text-t-secondary bg-hover px-1.5 py-0.5 rounded">
                {job.cron}
              </span>

              {lastRun && (
                <>
                  <span className="text-t-ghost text-[11px]">·</span>
                  <span className="text-[11px] text-t-dim">
                    上次 {fmtRelative(lastRun)}
                  </span>
                </>
              )}

              <span className="text-t-ghost text-[11px]">·</span>
              <span className="text-[11px] text-t-dim">
                累计 {history.length} 次
              </span>
            </div>
          </div>

        </button>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 shrink-0 mt-1">
          <button
            onClick={onToggleDisabled}
            title={isDisabled ? "启用" : "禁用"}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
              isDisabled
                ? "text-t-ghost hover:text-neon hover:bg-hover"
                : "text-t-ghost hover:text-amber-400 hover:bg-hover"
            }`}
          >
            {isDisabled ? <Power size={13} /> : <PowerOff size={13} />}
          </button>
          <button
            onClick={onEdit}
            title="编辑"
            className="w-7 h-7 rounded-full flex items-center justify-center text-t-ghost hover:text-t-primary hover:bg-hover transition-colors"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={onDelete}
            title="删除"
            className="w-7 h-7 rounded-full flex items-center justify-center text-t-ghost hover:text-red-400 hover:bg-hover transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

    </div>
  );
}

function MetaField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] text-t-ghost uppercase tracking-wider">
        {label}
      </div>
      <div
        className={`text-[12px] mt-0.5 text-t-muted ${mono ? "font-mono" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

// ─── 编辑/创建 表单 ────────────────────────────────────────────────

interface JobFormProps {
  initial?: CronJob | null;
  onCancel: () => void;
  onSubmit: (input: CronJobInput) => Promise<void>;
}

function JobForm({ initial, onCancel, onSubmit }: JobFormProps) {
  const [cron, setCron] = useState(initial?.cron || "");
  const [title, setTitle] = useState(initial?.title || "");
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [disabled, setDisabled] = useState(!!initial?.disabled);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const cronErr = quickValidateCron(cron);
    if (cronErr) return setError(cronErr);
    if (!title.trim()) return setError("请填写标题");
    if (!prompt.trim()) return setError("请填写 prompt");
    setError(null);
    setSaving(true);
    try {
      await onSubmit({
        cron: cron.trim(),
        title: title.trim(),
        prompt: prompt.trim(),
        disabled,
      });
    } catch (e) {
      setError((e as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] text-t-primary font-semibold">
          {initial ? "编辑定时任务" : "新建定时任务"}
        </h3>
        <button
          onClick={onCancel}
          className="w-8 h-8 rounded-full flex items-center justify-center text-t-ghost hover:text-t-primary hover:bg-hover transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* 字段 */}
      <Field label="标题" required>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="如：每天提醒喝水"
          className="w-full bg-surface border border-border-subtle rounded-md px-4 py-3 text-[14px] text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-neon/50"
        />
      </Field>

      <Field
        label="Cron 表达式"
        required
        hint="5 段：分 时 日 月 周。例：*/5 * * * *（每5分钟）、0 9 * * *（每天9点）"
      >
        <input
          type="text"
          value={cron}
          onChange={(e) => setCron(e.target.value)}
          placeholder="*/5 * * * *"
          className="w-full bg-surface border border-border-subtle rounded-md px-3 py-2 text-[13px] font-mono text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-neon/50"
        />
      </Field>

      <Field
        label="Prompt"
        required
        hint="到期触发时发给 agent 的指令；不要写「每天/每隔X分钟」等频率词，频率由 cron 表达"
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例：写一首诗，要求选一个国家作为灵感，注明国家名"
          rows={8}
          className="w-full bg-surface border border-border-subtle rounded-md px-4 py-3 text-[14px] text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-neon/50 resize-none"
        />
      </Field>

      {/* 启用开关 */}
      <div className="flex items-center justify-between pt-2 pb-1">
        <div>
          <div className="text-[14px] text-t-secondary leading-tight">
            启用调度
          </div>
          <div className="text-[12px] text-t-ghost mt-0.5 leading-tight">
            关闭后调度器跳过该任务，但保留任务定义和历史
          </div>
        </div>
        <Switch
          size="sm"
          checked={!disabled}
          onCheckedChange={(v) => setDisabled(!v)}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-400/[0.06] border border-red-400/[0.15]">
          <AlertCircle size={12} className="text-red-400/80 mt-0.5 shrink-0" />
          <p className="text-[13px] text-red-400/90 leading-relaxed">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 text-[14px] text-t-secondary rounded-md hover:bg-hover transition-colors disabled:opacity-40"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="px-4 py-2 text-[14px] font-medium text-base bg-neon rounded-md hover:bg-neon/80 transition-colors disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          {initial ? "保存" : "创建"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] text-t-secondary font-medium">
        {label}
        {required && <span className="text-red-400/80 ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-[12px] text-t-ghost leading-relaxed">{hint}</p>}
    </div>
  );
}

function JobFormDialog({
  initial,
  onCancel,
  onSubmit,
}: JobFormProps) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 16 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="w-[640px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-48px)] min-h-[520px] overflow-y-auto rounded-2xl border border-border bg-elevated shadow-2xl p-6"
        >
          <JobForm initial={initial} onCancel={onCancel} onSubmit={onSubmit} />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Main ───────────────────────────────────────────────────────────

export function ScheduledTaskPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * 表单状态：null = 关闭，"new" = 新建，CronJob = 编辑
   */
  const [editing, setEditing] = useState<null | "new" | CronJob>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCronJobs();
      setJobs(data);
    } catch (e) {
      setError((e as Error).message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleCreate = useCallback(
    async (input: CronJobInput) => {
      const res = await createCronJob(input);
      if ("error" in res) {
        useNotification.getState().addNotification({
          level: "error",
          message: `创建失败: ${res.error}`,
        });
        throw new Error(res.error);
      }
      setEditing(null);
      await reload();
    },
    [reload],
  );

  const handleUpdate = useCallback(
    async (jobId: string, input: CronJobInput) => {
      const res = await updateCronJob(jobId, input);
      if ("error" in res) {
        useNotification.getState().addNotification({
          level: "error",
          message: `更新失败: ${res.error}`,
        });
        throw new Error(res.error);
      }
      setEditing(null);
      await reload();
    },
    [reload],
  );

  const handleDelete = useCallback(
    async (job: CronJob) => {
      if (!confirm(`确定删除「${job.title}」？`)) return;
      const res = await deleteCronJob(job.id);
      if ("error" in res) {
        useNotification.getState().addNotification({
          level: "error",
          message: `删除失败: ${res.error}`,
        });
        return;
      }
      await reload();
    },
    [reload],
  );

  const handleToggleDisabled = useCallback(
    async (job: CronJob) => {
      const next = !job.disabled;
      // 乐观更新：先改本地，避免 PATCH 期间 UI 闪烁
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, disabled: next } : j)),
      );
      const res = await updateCronJob(job.id, { disabled: next });
      if ("error" in res) {
        useNotification.getState().addNotification({
          level: "error",
          message: `${next ? "禁用" : "启用"}失败: ${res.error}`,
        });
        // 回滚
        await reload();
        return;
      }
      // 后端返回最新 job，与 reload 等价
      setJobs((prev) => prev.map((j) => (j.id === job.id ? res.job : j)));
    },
    [reload],
  );

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort(
        (a, b) => (b.created_at || 0) - (a.created_at || 0),
      ),
    [jobs],
  );

  const enabledCount = jobs.filter((j) => !j.disabled).length;
  const disabledCount = jobs.length - enabledCount;

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="shrink-0 px-5 py-4 flex items-center justify-between border-b border-border/50">
        <div>
          <h1 className="text-[17px] text-t-primary font-semibold">定时任务</h1>
          <p className="text-[11px] text-t-dim mt-0.5">
            {jobs.length === 0
              ? "暂无任务"
              : disabledCount > 0
                ? `${enabledCount} 启用 · ${disabledCount} 禁用`
                : `${enabledCount} 个任务`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={reload}
            disabled={loading}
            title="刷新"
            className="p-2 rounded-md text-t-secondary hover:bg-hover hover:text-t-primary transition-colors disabled:opacity-30"
          >
            <RefreshCw
              size={14}
              className={loading ? "animate-spin" : ""}
            />
          </button>
          <button
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-neon text-base hover:bg-neon/80 transition-colors"
          >
            <Plus size={13} />
            新建
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {editing === "new" && (
          <JobFormDialog
            initial={null}
            onCancel={() => setEditing(null)}
            onSubmit={handleCreate}
          />
        )}
        {editing && typeof editing !== "string" && (
          <JobFormDialog
            initial={editing}
            onCancel={() => setEditing(null)}
            onSubmit={(input) => handleUpdate(editing.id, input)}
          />
        )}

        {/* 状态：loading */}
        {loading && jobs.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={16} className="text-t-ghost animate-spin" />
          </div>
        )}

        {/* 状态：error */}
        {error && !loading && (
          <div className="text-center px-4 py-12">
            <p className="text-[12px] text-red-400/70">{error}</p>
            <button
              onClick={reload}
              className="mt-2 text-[11px] text-t-ghost hover:text-neon transition-colors"
            >
              重试
            </button>
          </div>
        )}

        {/* 状态：empty */}
        {!loading && !error && jobs.length === 0 && (
          <div className="text-center px-4 py-16">
            <p className="text-[14px] text-t-dim">暂无定时任务</p>
            <p className="text-[12px] text-t-ghost mt-1">
              点击右上角「新建」或在对话中让 AI 创建
            </p>
          </div>
        )}

        {/* 任务列表 */}
        <div className="grid grid-cols-2 gap-2">
          {sortedJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onEdit={() => setEditing(job)}
              onDelete={() => handleDelete(job)}
              onToggleDisabled={() => handleToggleDisabled(job)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
