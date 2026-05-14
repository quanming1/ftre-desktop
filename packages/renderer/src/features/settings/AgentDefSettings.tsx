import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, ChevronLeft } from "lucide-react";
import { Input, SearchableMultiSelect } from "@ftre/ui";
import { useWorkspace } from "@/stores/workspace";
import { fetchAgentDefs, type AgentDef } from "@/services/api";
import { AVAILABLE_TOOLS } from "./constants";

interface AgentDefFormData {
  id: string;
  name: string;
  description: string;
  tools: string[];
}

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface AgentDefFormProps {
  initialData?: AgentDefFormData;
  isEdit?: boolean;
  onSave: (data: AgentDefFormData) => Promise<void>;
  onCancel: () => void;
}

function AgentDefForm({ initialData, isEdit, onSave, onCancel }: AgentDefFormProps) {
  const [formData, setFormData] = useState<AgentDefFormData>(
    initialData || {
      id: "",
      name: "",
      description: "",
      tools: [],
    },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = (name: string) => {
    setFormData((prev) => ({
      ...prev,
      name,
      id: isEdit ? prev.id : toKebabCase(name),
    }));
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      setError("名称不能为空");
      return;
    }
    if (!formData.id.trim()) {
      setError("ID 不能为空");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await onSave(formData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <button
        onClick={onCancel}
        className="inline-flex items-center gap-1 text-[13px] text-t-dim hover:text-t-primary transition-colors mb-12"
      >
        <ChevronLeft size={14} />
        返回
      </button>

      <div className="flex-1">
        <h1 className="text-[24px] font-light text-t-primary mb-2">
          {isEdit ? "编辑智能体" : "新建智能体"}
        </h1>
        <p className="text-[13px] text-t-dim mb-12">
          定义一个跨工作区协作的 AI 智能体
        </p>

        <div className="space-y-8">
          <div>
            <input
              value={formData.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="智能体名称"
              className="w-full text-[18px] font-light bg-transparent text-t-primary placeholder:text-t-ghost border-b border-border pb-3 focus:outline-none focus:border-neon transition-colors"
            />
            {!isEdit && formData.id && (
              <div className="text-[11px] text-t-ghost mt-2 font-mono">
                {formData.id}
              </div>
            )}
          </div>

          <div>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="这个智能体是做什么的？"
              rows={3}
              className="w-full text-[14px] bg-transparent text-t-secondary placeholder:text-t-ghost border-b border-border pb-3 focus:outline-none focus:border-neon transition-colors resize-none leading-relaxed"
            />
          </div>

          <div>
            <label className="block text-[11px] text-t-ghost uppercase tracking-wider mb-3">
              可用工具
            </label>
            <SearchableMultiSelect
              options={AVAILABLE_TOOLS}
              value={formData.tools}
              onChange={(tools) => setFormData((prev) => ({ ...prev, tools }))}
              placeholder="选择工具..."
              searchPlaceholder="搜索..."
            />
          </div>
        </div>

        {error && (
          <div className="text-[13px] text-[#f85149] mt-6">{error}</div>
        )}

        <div className="mt-16">
          <button
            onClick={handleSubmit}
            disabled={saving || !formData.name.trim()}
            className="px-8 py-3 text-[13px] font-medium text-base bg-neon hover:bg-neon-hover rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {saving ? "保存中..." : "保存智能体"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgentDefSettings() {
  const workspace = useWorkspace((s) => s.rootPath);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"list" | "create" | "edit">("list");
  const [editingAgent, setEditingAgent] = useState<AgentDef | null>(null);

  const loadAgents = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const defs = await fetchAgentDefs(workspace);
      setAgents(defs);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleSave = async (data: AgentDefFormData) => {
    if (!workspace) return;

    const agentMdContent = `---
name: "${data.name}"
description: "${data.description}"
tools:
${data.tools.map((t) => `  - ${t}`).join("\n")}
---

# ${data.name}

${data.description}
`;

    const agentDir = `${workspace}/.ftre/agents_def/${data.id}`;
    const agentFile = `${agentDir}/AGENT.md`;

    await window.desktop.fs.createFolder(agentDir);
    const result = await window.desktop.fs.writeFile(agentFile, agentMdContent);

    if (!result.success) {
      throw new Error(result.error || "写入文件失败");
    }

    await loadAgents();
    setView("list");
    setEditingAgent(null);
  };

  const handleDelete = async (agent: AgentDef) => {
    if (!workspace) return;
    if (!confirm(`确定删除智能体"${agent.name}"？`)) return;

    const agentDir = `${workspace}/.ftre/agents_def/${agent.id}`;
    await window.desktop.fs.delete(agentDir, true);
    await loadAgents();
  };

  const handleEdit = (agent: AgentDef) => {
    setEditingAgent(agent);
    setView("edit");
  };

  if (!workspace) {
    return (
      <div className="text-[13px] text-t-muted text-center py-8">
        先打开一个工作区以配置智能体
      </div>
    );
  }

  if (view === "create") {
    return (
      <AgentDefForm
        onSave={handleSave}
        onCancel={() => setView("list")}
      />
    );
  }

  if (view === "edit" && editingAgent) {
    return (
      <AgentDefForm
        initialData={{
          id: editingAgent.id,
          name: editingAgent.name,
          description: editingAgent.description,
          tools: editingAgent.tools || [],
        }}
        isEdit
        onSave={handleSave}
        onCancel={() => {
          setView("list");
          setEditingAgent(null);
        }}
      />
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="mb-16">
        <h1 className="text-[24px] font-light text-t-primary mb-2">智能体</h1>
        <p className="text-[13px] text-t-dim">
          跨工作区协作的 AI 智能体
        </p>
      </div>

      <div className="flex-1">
        {loading ? (
          <div className="text-[13px] text-t-ghost">加载中...</div>
        ) : agents.length === 0 ? (
          <div>
            <p className="text-[14px] text-t-muted leading-relaxed mb-8">
              还没有智能体。创建一个智能体来启用跨工作区的 AI 协作能力。
            </p>
            <button
              onClick={() => setView("create")}
              className="inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-medium text-base bg-neon hover:bg-neon-hover rounded transition-colors"
            >
              <Plus size={16} strokeWidth={2} />
              创建智能体
            </button>
          </div>
        ) : (
          <div>
            <div className="space-y-1 mb-12">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  onClick={() => handleEdit(agent)}
                  className="group flex items-center justify-between py-4 border-b border-border/50 cursor-pointer hover:border-border transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-[14px] text-t-primary group-hover:text-neon transition-colors">
                      {agent.name}
                    </div>
                    {agent.description && (
                      <div className="text-[12px] text-t-ghost mt-1 truncate max-w-[300px]">
                        {agent.description}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(agent);
                    }}
                    className="p-2 opacity-0 group-hover:opacity-100 text-t-ghost hover:text-[#f85149] transition-all"
                    title="删除智能体"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() => setView("create")}
              className="inline-flex items-center gap-2 text-[13px] text-t-dim hover:text-neon transition-colors"
            >
              <Plus size={14} />
              再添加一个智能体
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
