/**
 * SkillsPanel — Skill 管理面板（CRUD）。
 *
 * 后端契约（~/.ftre/skills/<name>.md 或 <name>/SKILL.md）：
 *   列表项 { name, description, kind, updated_at, disabled }
 *   详情   { name, description, kind, updated_at, content, disabled }
 *
 * UI：
 *   - 顶部：标题 + 搜索 + 刷新 + 新建
 *   - 列表：卡片网格，hover 显示预览/删除，左下角禁用开关
 *   - 预览：大弹窗只读展示 Markdown 原文
 *   - 创建：Modal 内嵌表单
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Search,
  RefreshCw,
  Loader2,
  Eye,
  Trash2,
  AlertCircle,
  FileText,
  Folder,
  Zap,
  Plus,
  Pencil,
  Save,
} from "lucide-react";
import { ToggleSwitch } from "@/components/ToggleSwitch";
import {
  fetchSkills,
  fetchSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  toggleSkillDisabled,
  type SkillSummary,
  type SkillDetail,
  type SkillKind,
} from "@/services/api";
import { useNotification } from "@/stores/notification";
import { remarkPlugins, rehypePlugins, urlTransform } from "@/lib/markdown-plugins";
import { FtreExtensionImage, serializeFtreRef } from "@/lib/ftre-extensions";
import { classifySkillOrigin, formatSkillName } from "@/lib/skill-display";
import { Modal } from "@/components/Modal";

// ─── Helpers ────────────────────────────────────────────────────────

/** epoch 秒 → 中文日期 */
function formatDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// ─── Skill Card ─────────────────────────────────────────────────────

function SkillCard({
  skill,
  onPreview,
  onDelete,
  onToggleDisabled,
  onEdit,
}: {
  skill: SkillSummary;
  onPreview: () => void;
  onDelete: () => void;
  onToggleDisabled: () => void;
  onEdit: () => void;
}) {
  const KindIcon = skill.kind === "dir" ? Folder : FileText;
  const readOnly = skill.scope === "private";
  const origin = classifySkillOrigin({
    origin: skill.origin,
    scope: skill.scope,
    route: skill.route,
    sourcePath: skill.source?.kind === "filesystem" ? skill.source.path : undefined,
  });

  return (
    <div
      onClick={onPreview}
      className={`group relative p-5 rounded-xl border border-border-subtle bg-elevated/40 hover:bg-elevated hover:border-border/50 transition-colors duration-150 cursor-pointer ${
        skill.disabled ? "opacity-50" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="shrink-0 w-6 h-6 rounded-md bg-neon/8 flex items-center justify-center">
            <KindIcon size={13} className="text-neon/70" />
          </span>
          <span className="text-[15px] font-semibold text-t-primary truncate">
            <span title={skill.name}>{formatSkillName(skill.name)}</span>
          </span>
          {skill.disabled && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-t-ghost/10 text-t-ghost">
              已禁用
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-150">
          <button
            onClick={(e) => { e.stopPropagation(); onPreview(); }}
            title="预览"
            className="w-7 h-7 rounded-full flex items-center justify-center text-t-ghost hover:text-t-primary hover:bg-white/8 transition-colors"
          >
            <Eye size={13} />
          </button>
          {!readOnly && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                title="编辑"
                className="w-7 h-7 rounded-full flex items-center justify-center text-t-ghost hover:text-t-primary hover:bg-white/8 transition-colors"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                title="删除"
                className="w-7 h-7 rounded-full flex items-center justify-center text-t-ghost hover:text-red-400 hover:bg-red-400/10 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-[12px] text-t-dim leading-relaxed mb-3 line-clamp-2 min-h-[2.8em]">
        {skill.description || "（无描述）"}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {skill.updated_at > 0 ? (
            <span className="text-[11px] text-t-ghost">更新于 {formatDate(skill.updated_at)}</span>
          ) : null}
          <span className="shrink-0 rounded-full bg-black/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-t-ghost dark:bg-white/[0.06]">
            {origin.shortLabel}
          </span>
        </div>
        <div onClick={(e) => e.stopPropagation()} className={readOnly ? "pointer-events-none opacity-60" : ""}>
          <ToggleSwitch
            checked={!skill.disabled}
            onChange={() => { if (!readOnly) onToggleDisabled(); }}
            size="sm"
          />
        </div>
      </div>
    </div>
  );
}

// ─── 预览组件 ────────────────────────────────────────────────────────

function SkillPreview({
  content,
  loading,
  skill,
}: {
  content: string;
  loading: boolean;
  skill?: SkillDetail | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={18} className="text-t-ghost animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {skill && <SkillPreviewMeta skill={skill} />}
      <div className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[...remarkPlugins]}
          rehypePlugins={[...rehypePlugins]}
          components={{ img: FtreExtensionImage }}
          urlTransform={urlTransform}
        >
          {content || "（空内容）"}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function SkillPreviewMeta({ skill }: { skill: SkillDetail }) {
  const origin = classifySkillOrigin({
    origin: skill.origin,
    scope: skill.scope,
    route: skill.route,
    sourcePath: skill.source?.kind === "filesystem" ? skill.source.path : undefined,
  });
  const route = skill.uri || `ftre://v1/skill/${skill.name}`;
  const command = serializeFtreRef({
    version: "v1",
    type: "skill",
    name: skill.name,
    args: {},
  });
  return (
    <div className="rounded-lg bg-hover/60 px-3 py-2.5 text-[12px] text-t-secondary">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Command <code className="break-all font-mono text-t-primary">{command}</code></span>
      </div>
      <div className="mt-1 break-all text-t-ghost">
        Route <code className="font-mono text-t-secondary">{route}</code>
      </div>
      {skill.source?.kind === "filesystem" && (
        <div className="mt-1 break-all text-t-ghost">
          Path <code className="font-mono text-t-secondary">{skill.source.path}</code>
        </div>
      )}
      <div className="mt-1">
        <span className="font-semibold text-t-primary">{origin.label}</span>
      </div>
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────

type EditState =
  | null
  | { mode: "preview"; name: string; content: string; loading: boolean; detail?: SkillDetail | null }
  | { mode: "create"; name: string; description: string; content: string; kind: SkillKind; saving: boolean }
  | { mode: "edit"; name: string; content: string; loading: boolean; saving: boolean };

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EditState>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSkills();
      setSkills(data);
    } catch (e) {
      setError((e as Error).message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const openPreview = useCallback(async (name: string) => {
    setEditing({ mode: "preview", name, content: "", loading: true });
    const res = await fetchSkill(name);
    if ("error" in res) {
      useNotification.getState().addNotification({
        level: "error",
        message: `打开失败: ${res.error}`,
      });
      setEditing(null);
      return;
    }
    setEditing({
      mode: "preview",
      name,
      content: res.skill.content,
      loading: false,
      detail: res.skill,
    });
  }, []);

  const openEdit = useCallback(async (name: string) => {
    setEditing({ mode: "edit", name, content: "", loading: true, saving: false });
    const res = await fetchSkill(name);
    if ("error" in res) {
      useNotification.getState().addNotification({ level: "error", message: `打开失败: ${res.error}` });
      setEditing(null);
      return;
    }
    setEditing({ mode: "edit", name, content: res.skill.content, loading: false, saving: false });
  }, []);

  const submitCreate = useCallback(async () => {
    if (!editing || editing.mode !== "create") return;
    if (!editing.name.trim()) {
      useNotification.getState().addNotification({ level: "warning", message: "请输入 Skill 名称" });
      return;
    }
    setEditing({ ...editing, saving: true });
    const result = await createSkill({
      name: editing.name.trim(),
      description: editing.description,
      content: editing.content,
      kind: editing.kind,
    });
    if ("error" in result) {
      setEditing({ ...editing, saving: false });
      useNotification.getState().addNotification({ level: "error", message: `创建失败: ${result.error}` });
      return;
    }
    setEditing(null);
    await reload();
  }, [editing, reload]);

  const submitEdit = useCallback(async () => {
    if (!editing || editing.mode !== "edit" || editing.loading) return;
    setEditing({ ...editing, saving: true });
    const result = await updateSkill(editing.name, editing.content);
    if ("error" in result) {
      setEditing({ ...editing, saving: false });
      useNotification.getState().addNotification({ level: "error", message: `保存失败: ${result.error}` });
      return;
    }
    setEditing(null);
    await reload();
  }, [editing, reload]);

  const handleDelete = useCallback(
    async (skill: SkillSummary) => {
      const extra =
        skill.kind === "dir" ? "（将连同其目录下所有资源一并删除）" : "";
      if (!confirm(`确定删除 Skill「${formatSkillName(skill.name)}」？${extra}`)) return;
      const res = await deleteSkill(skill.name);
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
    async (skill: SkillSummary) => {
      const res = await toggleSkillDisabled(skill.name);
      if ("error" in res) {
        useNotification.getState().addNotification({
          level: "error",
          message: `操作失败: ${res.error}`,
        });
        return;
      }
      useNotification.getState().addNotification({
        level: "success",
        message: res.disabled
          ? `已禁用 Skill「${formatSkillName(skill.name)}」`
          : `已启用 Skill「${formatSkillName(skill.name)}」`,
      });
      await reload();
    },
    [reload],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skills, search]);

  return (
    <div className="h-full flex flex-col bg-surface text-t-primary">
      {/* Header */}
      <div className="shrink-0 px-6 pt-5 pb-4 border-b border-border/30">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-semibold text-t-primary tracking-tight">技能</h1>
            <p className="text-[12px] text-t-dim mt-1">
              {skills.length === 0
                ? "为智能体提供可复用的能力说明"
                : `${skills.length} 个技能`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing({ mode: "create", name: "", description: "", content: "", kind: "dir", saving: false })}
              title="新建 Skill"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] text-t-dim hover:text-t-primary hover:bg-hover transition-colors"
            >
              <Plus size={14} /> 新建
            </button>
            <button onClick={reload} disabled={loading} title="刷新"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-t-dim hover:text-t-primary hover:bg-white/6 transition-colors disabled:opacity-30"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        {skills.length > 0 && (
          <div className="relative mt-3.5">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-t-ghost pointer-events-none" />
            <input
              className="w-full bg-elevated/40 border border-border-subtle rounded-lg pl-9 pr-3 py-2 text-[13px] text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-neon/40 focus:bg-elevated transition-colors"
              placeholder="搜索技能名称或描述……" value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading && skills.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={18} className="text-t-ghost animate-spin" />
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <AlertCircle size={28} className="text-red-400/60" />
            <p className="text-[13px] text-red-400/70">{error}</p>
            <button onClick={reload}
              className="text-[12px] text-t-ghost hover:text-neon transition-colors">重试</button>
          </div>
        )}

        {!loading && !error && skills.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-14 h-14 rounded-2xl bg-neon/5 flex items-center justify-center">
              <Zap size={24} className="text-neon/40" />
            </div>
            <div className="text-center">
              <p className="text-[15px] text-t-dim font-medium">还没有技能</p>
              <p className="text-[12px] text-t-ghost mt-1">创建你的第一个 Skill，让智能体拥有可复用的能力</p>
            </div>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((skill) => (
              <SkillCard key={skill.name} skill={skill}
                onPreview={() => openPreview(skill.name)}
                onEdit={() => openEdit(skill.name)}
                onDelete={() => handleDelete(skill)}
                onToggleDisabled={() => handleToggleDisabled(skill)}
              />
            ))}
          </div>
        )}

        {!loading && !error && skills.length > 0 && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Search size={24} className="text-t-ghost/40" />
            <p className="text-[13px] text-t-ghost">没有找到匹配「{search}」的技能</p>
          </div>
        )}
      </div>

      {/* 预览 */}
      {editing?.mode === "preview" && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={`预览 · ${formatSkillName(editing.name)}`}
          width={900}
        >
          <SkillPreview
            key={editing.loading ? "loading" : "loaded"}
            content={editing.content}
            loading={editing.loading}
            skill={editing.detail}
          />
        </Modal>
      )}
      {editing?.mode === "create" && (
        <Modal open onClose={() => setEditing(null)} title="新建 Skill" width={760}>
          <SkillForm
            mode="create"
            name={editing.name}
            description={editing.description}
            kind={editing.kind}
            content={editing.content}
            saving={editing.saving}
            onChange={(patch) => setEditing((current) => current?.mode === "create" ? { ...current, ...patch } : current)}
            onCancel={() => setEditing(null)}
            onSubmit={submitCreate}
          />
        </Modal>
      )}
      {editing?.mode === "edit" && (
          <Modal open onClose={() => setEditing(null)} title={`编辑 · ${formatSkillName(editing.name)}`} width={900}>
          {editing.loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={18} className="text-t-ghost animate-spin" /></div>
          ) : (
            <SkillForm
              mode="edit"
              name={editing.name}
              description=""
              kind="file"
              content={editing.content}
              saving={editing.saving}
              onChange={(patch) => setEditing((current) => current?.mode === "edit" ? { ...current, ...patch } : current)}
              onCancel={() => setEditing(null)}
              onSubmit={submitEdit}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

function SkillForm({
  mode,
  name,
  description,
  kind,
  content,
  saving,
  onChange,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit";
  name: string;
  description: string;
  kind: SkillKind;
  content: string;
  saving: boolean;
  onChange: (patch: Partial<{ name: string; description: string; kind: SkillKind; content: string }>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <label className="flex flex-col gap-1.5 text-[12px] text-t-dim">
          名称
          <input
            value={name}
            disabled={mode === "edit" || saving}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="review-code"
            className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[13px] text-t-primary outline-none focus:border-neon/50 disabled:opacity-60"
          />
        </label>
        {mode === "create" && (
          <label className="flex flex-col gap-1.5 text-[12px] text-t-dim">
            存储
            <select
              value={kind}
              onChange={(event) => onChange({ kind: event.target.value as SkillKind })}
              className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[13px] text-t-primary outline-none"
            >
              <option value="dir">目录</option>
              <option value="file">文件</option>
            </select>
          </label>
        )}
      </div>
      {mode === "create" && (
        <label className="flex flex-col gap-1.5 text-[12px] text-t-dim">
          描述
          <input
            value={description}
            disabled={saving}
            onChange={(event) => onChange({ description: event.target.value })}
            placeholder="这个 Skill 用来做什么"
            className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[13px] text-t-primary outline-none focus:border-neon/50"
          />
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-[12px] text-t-dim">
        内容（Markdown）
        <textarea
          value={content}
          disabled={saving}
          onChange={(event) => onChange({ content: event.target.value })}
          rows={16}
          className="resize-y rounded-lg border border-border-subtle bg-surface px-3 py-2 font-mono text-[13px] leading-relaxed text-t-primary outline-none focus:border-neon/50"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-[12px] text-t-dim hover:bg-hover">取消</button>
        <button type="button" onClick={onSubmit} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-neon px-3 py-2 text-[12px] text-white disabled:opacity-50">
          <Save size={13} /> {saving ? "保存中…" : mode === "create" ? "创建" : "保存"}
        </button>
      </div>
    </div>
  );
}
