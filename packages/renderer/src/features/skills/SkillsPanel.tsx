/**
 * SkillsPanel — Skills management page.
 *
 * Layout: left sidebar nav + right content area with skill cards grid.
 * Reference: Manus-style skill management UI.
 */
import { useState } from "react";
import { Search, Plus, MoreHorizontal, Info } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────

interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source: "official" | "community" | "custom";
  updatedAt: string;
  isNew?: boolean;
}

type NavSection = "skills" | "integrations";
type SkillFilter = "all" | "official" | "community" | "custom";

// ─── Mock Data ──────────────────────────────────────────────────────

const MOCK_SKILLS: Skill[] = [
  { id: "code-agent", name: "code-agent", description: "读写文件、执行命令、搜索代码。核心编程技能，支持多语言项目开发。", enabled: true, source: "official", updatedAt: "2026年5月14日" },
  { id: "web-search", name: "web-search", description: "搜索互联网获取最新信息，支持多搜索引擎和结果过滤。", enabled: true, source: "official", updatedAt: "2026年5月7日" },
  { id: "file-ops", name: "file-ops", description: "创建、编辑、删除文件和目录，支持批量操作和模板生成。", enabled: true, source: "official", updatedAt: "2026年4月30日" },
  { id: "shell-executor", name: "shell-executor", description: "执行系统命令和脚本，支持超时控制和安全沙箱。", enabled: true, source: "official", updatedAt: "2026年4月23日" },
  { id: "deep-reasoning", name: "deep-reasoning", description: "复杂问题的深度推理和分析，适用于数学、逻辑和多步骤问题。", enabled: false, source: "official", updatedAt: "2026年5月10日", isNew: true },
  { id: "api-docs", name: "api-docs", description: "从代码自动生成 API 文档，支持 OpenAPI、GraphQL 等格式。", enabled: false, source: "community", updatedAt: "2026年4月15日" },
  { id: "git-workflow", name: "git-workflow", description: "Git 工作流自动化，支持分支管理、PR 创建和代码审查。", enabled: true, source: "community", updatedAt: "2026年5月1日" },
  { id: "project-lint", name: "project-lint", description: "检查代码是否符合项目规范，支持自定义规则和自动修复。", enabled: true, source: "custom", updatedAt: "2026年5月12日" },
  { id: "test-generator", name: "test-generator", description: "根据代码自动生成单元测试，支持多测试框架。", enabled: false, source: "community", updatedAt: "2026年4月20日" },
  { id: "greet-plugin", name: "greet-plugin", description: "示例插件，向用户打招呼。用于演示插件开发流程。", enabled: true, source: "custom", updatedAt: "2026年5月14日" },
];

// ─── Component ──────────────────────────────────────────────────────

export function SkillsPanel() {
  const [activeNav, setActiveNav] = useState<NavSection>("skills");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [search, setSearch] = useState("");
  const [skills, setSkills] = useState<Skill[]>(MOCK_SKILLS);

  const filtered = skills.filter((s) => {
    if (filter !== "all" && s.source !== filter) return false;
    if (search && !s.name.includes(search) && !s.description.includes(search)) return false;
    return true;
  });

  const toggleSkill = (id: string) => {
    setSkills((prev) => prev.map((s) => s.id === id ? { ...s, enabled: !s.enabled } : s));
  };

  return (
    <div className="h-full flex text-t-primary">
      {/* Left Nav */}
      <nav className="w-[180px] border-r border-border flex flex-col py-4 shrink-0">
        <div className="px-4 mb-4">
          <div className="text-sm font-medium text-t-primary">ftre</div>
          <div className="text-[11px] text-t-ghost">workspace</div>
        </div>

        <div className="px-3 space-y-0.5">
          <NavItem label="技能" active={activeNav === "skills"} onClick={() => setActiveNav("skills")} />
          <NavItem label="集成" active={activeNav === "integrations"} onClick={() => setActiveNav("integrations")} />
        </div>
      </nav>

      {/* Right Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-4">
          <h1 className="text-lg font-medium text-t-primary">技能</h1>
          <p className="text-xs text-t-ghost mt-1">为你的智能体提供预封装且可重复的最佳实践与工具</p>
        </div>

        {/* Toolbar */}
        <div className="px-6 pb-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-[300px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-t-ghost" />
            <input
              className="w-full bg-surface border border-border-subtle rounded-md pl-8 pr-3 py-1.5 text-xs text-t-primary placeholder:text-t-ghost"
              placeholder="搜索技能"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1 text-[11px]">
            <FilterButton label="全部" active={filter === "all"} onClick={() => setFilter("all")} />
            <FilterButton label="官方" active={filter === "official"} onClick={() => setFilter("official")} />
            <FilterButton label="社区" active={filter === "community"} onClick={() => setFilter("community")} />
            <FilterButton label="自定义" active={filter === "custom"} onClick={() => setFilter("custom")} />
          </div>
        </div>

        {/* Add custom skill banner */}
        <div className="mx-6 mb-4 flex items-center justify-between px-4 py-2.5 bg-panel border border-border-subtle rounded-lg">
          <div>
            <div className="text-xs text-t-primary">添加自定义技能</div>
            <div className="text-[11px] text-t-ghost">添加技能以解锁您或您团队的新功能。</div>
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-active hover:bg-hover border border-border-subtle rounded-md transition-colors">
            <Plus size={12} />
            添加
          </button>
        </div>

        {/* Skill Cards Grid */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onToggle={() => toggleSkill(skill.id)} />
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="text-center text-t-ghost text-xs py-12">没有找到匹配的技能</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub Components ─────────────────────────────────────────────────

function NavItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors ${
        active ? "bg-active text-t-primary" : "text-t-secondary hover:bg-hover"
      }`}
    >
      {label}
    </button>
  );
}

function FilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md transition-colors ${
        active ? "bg-active text-t-primary" : "text-t-ghost hover:text-t-secondary"
      }`}
    >
      {label}
    </button>
  );
}

function SkillCard({ skill, onToggle }: { skill: Skill; onToggle: () => void }) {
  const sourceLabel = skill.source === "official" ? "官方" : skill.source === "community" ? "社区" : "自定义";

  return (
    <div className="p-4 border border-border-subtle rounded-lg hover:border-border transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-t-primary">{skill.name}</span>
          {skill.isNew && <span className="text-[9px] px-1.5 py-0.5 rounded bg-neon/20 text-neon">NEW</span>}
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle */}
          <button
            onClick={onToggle}
            className={`w-9 h-5 rounded-full transition-colors relative ${skill.enabled ? "bg-neon/80" : "bg-active"}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-t-primary transition-transform ${skill.enabled ? "left-[18px]" : "left-0.5"}`} />
          </button>
        </div>
      </div>

      {/* Description */}
      <p className="text-[11px] text-t-ghost leading-relaxed mb-3 line-clamp-2">{skill.description}</p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] text-t-ghost">
          <span>{sourceLabel}</span>
          <span>·</span>
          <span>更新于 {skill.updatedAt}</span>
        </div>
        <button className="p-1 rounded hover:bg-hover text-t-ghost">
          <MoreHorizontal size={12} />
        </button>
      </div>
    </div>
  );
}
