/**
 * SkillsPanel — Skill 管理面板（CRUD）。
 *
 * 后端契约（~/.ftre/skills/<name>.md 或 <name>/SKILL.md）：
 *   列表项 { name, description, kind, updated_at }
 *   详情   { name, description, kind, updated_at, content }
 *
 * Skill 是可复用的本地能力说明；后端会把它们的描述注入 system_prompt，
 * 并提供 loadSkill 工具按需读取完整内容（见 ~/.ftre/plugins/skill_plugin.py）。
 *
 * UI：
 *   - 顶部：标题 + 搜索 + 刷新 + 新建
 *   - 列表：卡片网格，hover 显示编辑/删除
 *   - 查看/编辑/创建：Modal 内嵌 markdown 文本编辑器
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  RefreshCw,
  Loader2,
  Pencil,
  Trash2,
  AlertCircle,
  FileText,
  Folder,
} from "lucide-react";
import {
  fetchSkills,
  fetchSkill,
  createSkill,
  updateSkill,
  deleteSkill,
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
  onOpen,
  onDelete,
}: {
  skill: SkillSummary;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const KindIcon = skill.kind === "dir" ? Folder : FileText;
  const kindLabel = skill.kind === "dir" ? "目录" : "单文件";

  return (
    <div
      onClick={onOpen}
      className="group relative p-4 border border-border-subtle rounded-lg hover:border-border hover:bg-surface transition-colors cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <KindIcon size={13} className="shrink-0 text-t-ghost" />
          <span className="text-sm font-medium text-t-primary truncate">
            {skill.name}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            title="编辑"
            className="w-7 h-7 rounded-full flex items-center justify-center text-t-ghost hover:text-t-primary hover:bg-hover transition-colors"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="删除"
            className="w-7 h-7 rounded-full flex items-center justify-center text-t-ghost hover:text-red-400 hover:bg-hover transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Description */}
      <p className="text-[11px] text-t-ghost leading-relaxed mb-3 line-clamp-2 min-h-[2.4em]">
        {skill.description || "（无描述）"}
      </p>

      {/* Footer */}
      <div className="flex items-center gap-2 text-[10px] text-t-ghost">
        <span>{kindLabel}</span>
        {skill.updated_at > 0 && (
          <>
            <span>·</span>
            <span>更新于 {formatDate(skill.updated_at)}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── 编辑 / 创建表单 ────────────────────────────────────────────────

interface SkillFormProps {
  /** "new" = 新建；否则编辑已存在 Skill */
  mode: "new" | "edit";
  initialName?: string;
  initialContent?: string;
  loading?: boolean;
  onCancel: () => void;
  onSubmit: (data: {
    name: string;
    content: string;
    kind: SkillKind;
  }) => Promise<void>;
}

function SkillForm({
  mode,
  initialName = "",
  initialContent = "",
  loading = false,
  onCancel,
  onSubmit,
}: SkillFormProps) {
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState<SkillKind>("dir");
  const [content, setContent] = useState(initialContent);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = mode === "edit";

  const handleSubmit = async () => {
    if (!isEdit) {
      const nameErr = quickValidateName(name);
      if (nameErr) return setError(nameErr);
    }
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={18} className="text-t-ghost animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Field label="名称" required>
        <input
          type="text"
          value={name}
          disabled={isEdit}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：pdf-processing"
          className="w-full bg-surface border border-border-subtle rounded-md px-4 py-3 text-[15px] font-mono text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-neon/50 disabled:opacity-50"
        />
      </Field>

      {!isEdit && (
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
      )}

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
          {isEdit ? "保存" : "创建"}
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
          : "border-border-subtle text-t-ghost hover:text-t-secondary hover:bg-hover"
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
    <div className="space-y-1.5">
      <label className="block text-[15px] text-t-secondary font-medium">
        {label}
        {required && <span className="text-red-400/80 ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-[13px] text-t-ghost leading-relaxed">{hint}</p>}
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────

type EditState =
  | null
  | { mode: "new" }
  | { mode: "edit"; name: string; content: string; loading: boolean };

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

  const openEdit = useCallback(async (name: string) => {
    setEditing({ mode: "edit", name, content: "", loading: true });
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
      mode: "edit",
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

  const handleUpdate = useCallback(
    async (name: string, content: string) => {
      const res = await updateSkill(name, content);
      if ("error" in res) {
        useNotification.getState().addNotification({
          level: "error",
          message: `保存失败: ${res.error}`,
        });
        throw new Error(res.error);
      }
      useNotification.getState().addNotification({
        level: "success",
        message: `已保存 Skill「${name}」`,
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
      <div className="shrink-0 px-5 py-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[17px] text-t-primary font-semibold">技能</h1>
            <p className="text-[11px] text-t-dim mt-0.5">
              {skills.length === 0
                ? "暂无技能"
                : `${skills.length} 个技能 · 为智能体提供可复用的能力说明`}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={reload}
              disabled={loading}
              title="刷新"
              className="p-2 rounded-md text-t-secondary hover:bg-hover hover:text-t-primary transition-colors disabled:opacity-30"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={() => setEditing({ mode: "new" })}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-neon text-base hover:bg-neon/80 transition-colors"
            >
              <Plus size={13} />
              新建
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mt-3 max-w-[320px]">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-t-ghost"
          />
          <input
            className="w-full bg-base border border-border-subtle rounded-md pl-8 pr-3 py-1.5 text-xs text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-neon/50"
            placeholder="搜索技能"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading && skills.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={16} className="text-t-ghost animate-spin" />
          </div>
        )}

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

        {!loading && !error && skills.length === 0 && (
          <div className="text-center px-4 py-16">
            <p className="text-[14px] text-t-dim">暂无技能</p>
            <p className="text-[12px] text-t-ghost mt-1">
              点击右上角「新建」创建你的第一个 Skill
            </p>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((skill) => (
              <SkillCard
                key={skill.name}
                skill={skill}
                onOpen={() => openEdit(skill.name)}
                onDelete={() => handleDelete(skill)}
              />
            ))}
          </div>
        )}

        {!loading && !error && skills.length > 0 && filtered.length === 0 && (
          <div className="text-center text-t-ghost text-xs py-12">
            没有找到匹配的技能
          </div>
        )}
      </div>

      {/* 新建 */}
      {editing?.mode === "new" && (
        <Modal open onClose={() => setEditing(null)} title="新建技能">
          <SkillForm
            mode="new"
            onCancel={() => setEditing(null)}
            onSubmit={handleCreate}
          />
        </Modal>
      )}

      {/* 编辑 */}
      {editing?.mode === "edit" && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={`编辑技能 · ${editing.name}`}
        >
          {/* key 随 loading 翻转：内容拉到后强制重挂载，
              让 SkillForm 的 useState(initialContent) 重新读到正文 */}
          <SkillForm
            key={editing.loading ? "loading" : "loaded"}
            mode="edit"
            initialName={editing.name}
            initialContent={editing.content}
            loading={editing.loading}
            onCancel={() => setEditing(null)}
            onSubmit={({ content }) => handleUpdate(editing.name, content)}
          />
        </Modal>
      )}
    </div>
  );
}
