/**
 * SkillsPanel — Displays available skills/agents.
 *
 * Currently uses mock data. Will be connected to backend API later.
 */
import { useState } from "react";
import { Zap, Search, Play, Code, Globe, FileText, Terminal, Brain } from "lucide-react";

// ─── Mock Data ──────────────────────────────────────────────────────

interface Skill {
  id: string;
  name: string;
  description: string;
  icon: "code" | "web" | "file" | "terminal" | "brain" | "zap";
  category: "builtin" | "custom" | "plugin";
  enabled: boolean;
}

const MOCK_SKILLS: Skill[] = [
  { id: "code_agent", name: "Code Agent", description: "读写文件、执行命令、搜索代码", icon: "code", category: "builtin", enabled: true },
  { id: "web_search", name: "Web Search", description: "搜索互联网获取最新信息", icon: "web", category: "builtin", enabled: true },
  { id: "file_ops", name: "File Operations", description: "创建、编辑、删除文件和目录", icon: "file", category: "builtin", enabled: true },
  { id: "shell", name: "Shell Executor", description: "执行系统命令和脚本", icon: "terminal", category: "builtin", enabled: true },
  { id: "reasoning", name: "Deep Reasoning", description: "复杂问题的深度推理和分析", icon: "brain", category: "builtin", enabled: false },
  { id: "greet", name: "Greet Plugin", description: "示例插件 — 向用户打招呼", icon: "zap", category: "plugin", enabled: true },
  { id: "custom_1", name: "项目规范检查", description: "检查代码是否符合项目规范", icon: "code", category: "custom", enabled: true },
  { id: "custom_2", name: "API 文档生成", description: "从代码自动生成 API 文档", icon: "file", category: "custom", enabled: false },
];

const ICON_MAP = {
  code: Code,
  web: Globe,
  file: FileText,
  terminal: Terminal,
  brain: Brain,
  zap: Zap,
};

const CATEGORY_LABELS: Record<string, string> = {
  builtin: "内置技能",
  custom: "自定义技能",
  plugin: "插件",
};

// ─── Component ──────────────────────────────────────────────────────

export function SkillsPanel() {
  const [search, setSearch] = useState("");
  const [skills] = useState<Skill[]>(MOCK_SKILLS);

  const filtered = search
    ? skills.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()) || s.description.includes(search))
    : skills;

  const grouped = Object.entries(
    filtered.reduce<Record<string, Skill[]>>((acc, skill) => {
      (acc[skill.category] ||= []).push(skill);
      return acc;
    }, {}),
  );

  return (
    <div className="h-full flex flex-col text-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium text-t-primary mb-2">技能</h2>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-t-ghost" />
          <input
            className="w-full bg-black/20 border border-white/10 rounded pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-t-ghost"
            placeholder="搜索技能..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Skill list */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {grouped.map(([category, categorySkills]) => (
          <div key={category} className="mb-4">
            <div className="text-[10px] uppercase tracking-wider text-t-ghost mb-1.5 px-1">
              {CATEGORY_LABELS[category] || category}
            </div>
            <div className="space-y-1">
              {categorySkills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} />
              ))}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center text-t-ghost text-xs py-8">
            没有找到匹配的技能
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Skill Card ─────────────────────────────────────────────────────

function SkillCard({ skill }: { skill: Skill }) {
  const Icon = ICON_MAP[skill.icon] || Zap;

  return (
    <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/[0.04] transition-colors group cursor-pointer">
      <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${skill.enabled ? "bg-neon/10 text-neon" : "bg-white/5 text-t-ghost"}`}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-t-primary truncate">{skill.name}</span>
          {!skill.enabled && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-white/5 text-t-ghost">禁用</span>
          )}
        </div>
        <div className="text-[11px] text-t-ghost truncate">{skill.description}</div>
      </div>
      <button
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/10"
        title="运行"
      >
        <Play size={12} className="text-t-secondary" />
      </button>
    </div>
  );
}
