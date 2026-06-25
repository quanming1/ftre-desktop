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
import remarkGfm from "remark-gfm";
import {
  Search,
  Plus,
  RefreshCw,
  Loader2,
  Eye,
  Trash2,
  AlertCircle,
  FileText,
  Folder,
  Zap,
} from "lucide-react";
import { Switch } from "@ftre/ui";
import {
  fetchSkills,
  fetchSkill,
  createSkill,
  deleteSkill,
  toggleSkillDisabled,
  type SkillSummary,
  type SkillKind,
} from "@/services/api";
import { useNotification } from "@/stores/notification";
import { Modal } from "@/components/Modal";

// ─── Helpers ────────────────────────────────────────────────────────

/** Skill 名称合法性自检（与后端 is_valid_name 对齐，前端即时反馈）。*/
function quickValidateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "名称不能为空";
  if (trimmed === "." || trimmed === "..") return "名称非法";
  if (trimmed.startsWith(".")) return "名称不能以 . 开头";
  if (/[\\/]/.test(trimmed)) return "名称不能包含 / 或 \\";
  return null;
}

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
}: {
  skill: SkillSummary;
  onPreview: () => void;
  onDelete: () => void;
  onToggleDisabled: () => void;
}) {
  const KindIcon = skill.kind === "dir" ? Folder : FileText;

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
            {skill.name}
          </span>
          {skill.disabled && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-t-ghost/10 text-t-ghost">
              已禁用
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={!skill.disabled}
              onCheckedChange={() => onToggleDisabled()}
              size="sm"
            />
          </div>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-150">
            <button
              onClick={(e) => { e.stopPropagation(); onPreview(); }}
              title="预览"
              className="w-7 h-7 rounded-full flex items-center justify-center text-t-ghost hover:text-t-primary hover:bg-white/8 transition-colors"
            >
              <Eye size={13} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="删除"
              className="w-7 h-7 rounded-full flex items-center justify-center text-t-ghost hover:text-red-400 hover:bg-red-400/10 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-[12px] text-t-dim leading-relaxed mb-3 line-clamp-2 min-h-[2.8em]">
        {skill.description || "（无描述）"}
      </p>

      {/* Footer */}
      {skill.updated_at > 0 && (
        <div className="text-[11px] text-t-ghost">更新于 {formatDate(skill.updated_at)}</div>
      )}
    </div>
  );
}

// ─── 预览组件 ────────────────────────────────────────────────────────

function SkillPreview({
  content,
  loading,
}: {
  content: string;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={18} className="text-t-ghost animate-spin" />
      </div>
    );
  }

  return (
    <div className="markdown-body max-h-[60vh] overflow-y-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content || "（空内容）"}
      </ReactMarkdown>
    </div>
  );
}

// ─── 创建表单 ────────────────────────────────────────────────────────

interface SkillFormProps {
  onCancel: () => void;
  onSubmit: (data: {
    name: string;
    content: string;
    kind: SkillKind;
  }) => Promise<void>;
}

function SkillForm({
  onCancel,
  onSubmit,
}: SkillFormProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SkillKind>("dir");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const nameErr = quickValidateName(name);
    if (nameErr) return setError(nameErr);
    setError(null);
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), content, kind });
    } catch (e) {
      setError((e as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Field label="名称" required>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：pdf-processing"
          className="w-full bg-surface border border-border-subtle rounded-md px-4 py-3 text-[15px] font-mono text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-neon/50"
        />
      </Field>

      <Field label="存储形态" hint="目录形态可附带 references / scripts 等资源">
        <div className="flex items-center gap-2">
          <KindOption
            label="目录 (<name>/SKILL.md)"
            active={kind === "dir"}
            onClick={() => setKind("dir")}
          />
          <KindOption
            label="单文件 (<name>.md)"
            active={kind === "file"}
            onClick={() => setKind("file")}
          />
        </div>
      </Field>

      <Field
        label="内容"
        hint="Skill 正文（Markdown）。建议含 frontmatter 的 description，便于被自动识别。"
      >
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={"---\nname: my-skill\ndescription: 这个 Skill 用来……\n---\n\n# My Skill\n"}
          rows={16}
          spellCheck={false}
          className="w-full bg-surface border border-border-subtle rounded-md px-4 py-3 text-[13px] font-mono leading-relaxed text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-neon/50 resize-none"
        />
      </Field>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-400/[0.06] border border-red-400/[0.15]">
          <AlertCircle size={12} className="text-red-400/80 mt-0.5 shrink-0" />
          <p className="text-[14px] text-red-400/90 leading-relaxed">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-5 py-2.5 text-[15px] text-t-secondary rounded-md hover:bg-hover transition-colors disabled:opacity-40"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="px-5 py-2.5 text-[15px] font-medium text-base bg-neon rounded-md hover:bg-neon/80 transition-colors disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          创建
        </button>
      </div>
    </div>
  );
}

function KindOption({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-md text-[13px] font-mono border transition-colors ${
        active
          ? "border-neon/50 bg-neon/10 text-t-primary"
          : "border-border-subtle bg-surface text-t-dim hover:text-t-secondary"
      }`}
    >
      {label}
    </button>
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
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <label className="text-[13px] font-medium text-t-secondary">
          {label}
          {required && <span className="text-neon/70 ml-0.5">*</span>}
        </label>
        {hint && <span className="text-[11px] text-t-ghost">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────

type PreviewState = { name: string; content: string; loading: boolean } | null;

type EditState =
  | null
  | { mode: "new" }
  | { mode: "preview"; name: string; content: string; loading: boolean };

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
    });
  }, []);

  const handleCreate = useCallback(
    async (data: { name: string; content: string; kind: SkillKind }) => {
      const res = await createSkill({
        name: data.name,
        content: data.content || undefined,
        kind: data.kind,
      });
      if ("error" in res) {
        useNotification.getState().addNotification({
          level: "error",
          message: `创建失败: ${res.error}`,
        });
        throw new Error(res.error);
      }
      useNotification.getState().addNotification({
        level: "success",
        message: `已创建 Skill「${data.name}」`,
      });
      setEditing(null);
      await reload();
    },
    [reload],
  );

  const handleDelete = useCallback(
    async (skill: SkillSummary) => {
      const extra =
        skill.kind === "dir" ? "（将连同其目录下所有资源一并删除）" : "";
      if (!confirm(`确定删除 Skill「${skill.name}」？${extra}`)) return;
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
          ? `已禁用 Skill「${skill.name}」`
          : `已启用 Skill「${skill.name}」`,
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
            <button onClick={reload} disabled={loading} title="刷新"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-t-dim hover:text-t-primary hover:bg-white/6 transition-colors disabled:opacity-30"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={() => setEditing({ mode: "new" })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium bg-neon text-base hover:bg-neon/90 transition-all duration-150 active:scale-95"
            >
              <Plus size={14} strokeWidth={2} />新建
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

      {/* 新建 */}
      {editing?.mode === "new" && (
        <Modal open onClose={() => setEditing(null)} title="新建技能">
          <SkillForm
            onCancel={() => setEditing(null)}
            onSubmit={handleCreate}
          />
        </Modal>
      )}

      {/* 预览 */}
      {editing?.mode === "preview" && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={`预览 · ${editing.name}`}
          width={900}
        >
          <SkillPreview
            key={editing.loading ? "loading" : "loaded"}
            content={editing.content}
            loading={editing.loading}
          />
        </Modal>
      )}
    </div>
  );
}
