import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, X } from "lucide-react";
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
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function AgentDefForm({ initialData, isEdit, onSave, onCancel }: {
  initialData?: AgentDefFormData;
  isEdit?: boolean;
  onSave: (data: AgentDefFormData) => Promise<void>;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState<AgentDefFormData>(
    initialData || { id: "", name: "", description: "", tools: [] },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = (name: string) => {
    setFormData((prev) => ({ ...prev, name, id: isEdit ? prev.id : toKebabCase(name) }));
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) { setError("名称不能为空"); return; }
    if (!formData.id.trim()) { setError("ID 不能为空"); return; }
    setError(null);
    setSaving(true);
    try { await onSave(formData); }
    catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); }
  };

  const toggleTool = (tool: string) => {
    setFormData((prev) => ({
      ...prev,
      tools: prev.tools.includes(tool) ? prev.tools.filter((t) => t !== tool) : [...prev.tools, tool],
    }));
  };

  return (
    <div className="space-y-6">
      <button onClick={onCancel} className="flex items-center gap-1.5 text-[13px] text-black/40 hover:text-black transition-colors active:scale-[0.96] transition-transform">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M9 3L4 8L4 10L6 10L11 5" /></svg>
        返回
      </button>

      <div>
        <h2 className="text-[15px] font-semibold text-black">{isEdit ? "编辑智能体" : "新建智能体"}</h2>
        <p className="text-[12px] text-black/40 mt-1">定义一个跨工作区协作的 AI 智能体</p>
      </div>

      <div className="space-y-5">
        <div>
          <div className="text-[12px] font-semibold text-black/70 mb-2">名称</div>
          <input
            value={formData.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="智能体名称"
            className="w-full h-10 px-3.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white transition-all"
          />
          {!isEdit && formData.id && (
            <div className="text-[11px] text-black/30 mt-1.5 font-mono">{formData.id}</div>
          )}
        </div>

        <div>
          <div className="text-[12px] font-semibold text-black/70 mb-2">描述</div>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
            placeholder="这个智能体是做什么的？"
            rows={3}
            className="w-full px-3.5 py-2.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white resize-y transition-all"
          />
        </div>

        <div>
          <div className="text-[12px] font-semibold text-black/70 mb-2">可用工具</div>
          <div className="flex flex-wrap gap-2">
            {AVAILABLE_TOOLS.map((tool) => {
              const active = formData.tools.includes(tool);
              return (
                <button
                  key={tool}
                  onClick={() => toggleTool(tool)}
                  className={`px-3 py-1.5 text-[12px] font-medium rounded-lg border transition-all active:scale-[0.96] ${
                    active ? "border-black bg-black text-white" : "border-black/[0.08] bg-white text-black/60 hover:border-black/[0.15]"
                  }`}
                >
                  {tool}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 text-[12px] rounded-lg bg-black/[0.02] border border-black/[0.06] text-black/60">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-black/30 hover:text-black/60 transition-colors"><X size={13} /></button>
        </div>
      )}

      <div className="flex items-center gap-3 pt-4 border-t border-black/[0.06]">
        <button
          onClick={handleSubmit}
          disabled={saving || !formData.name.trim()}
          className="flex items-center gap-1.5 h-9 px-5 rounded-full text-[13px] font-medium bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform] disabled:opacity-30 disabled:pointer-events-none"
        >
          {saving ? "保存中..." : "保存智能体"}
        </button>
        <button onClick={onCancel} className="text-[12px] text-black/35 hover:text-black/60 active:scale-[0.96] transition-[color,transform]">取消</button>
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
  const [deleteConfirm, setDeleteConfirm] = useState<AgentDef | null>(null);

  const loadAgents = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try { setAgents(await fetchAgentDefs(workspace)); }
    finally { setLoading(false); }
  }, [workspace]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

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
    await window.desktop.fs.createFolder(agentDir);
    const result = await window.desktop.fs.writeFile(`${agentDir}/AGENT.md`, agentMdContent);
    if (!result.success) throw new Error(result.error || "写入文件失败");
    await loadAgents();
    setView("list");
    setEditingAgent(null);
  };

  const handleDelete = async (agent: AgentDef) => {
    if (!workspace) return;
    const agentDir = `${workspace}/.ftre/agents_def/${agent.id}`;
    await window.desktop.fs.delete(agentDir, true);
    setDeleteConfirm(null);
    await loadAgents();
  };

  if (!workspace) {
    return <div className="text-[13px] text-black/40 text-center py-8">先打开一个工作区以配置智能体</div>;
  }

  if (view === "create") {
    return <AgentDefForm onSave={handleSave} onCancel={() => setView("list")} />;
  }

  if (view === "edit" && editingAgent) {
    return (
      <AgentDefForm
        initialData={{ id: editingAgent.id, name: editingAgent.name, description: editingAgent.description, tools: editingAgent.tools || [] }}
        isEdit
        onSave={handleSave}
        onCancel={() => { setView("list"); setEditingAgent(null); }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-black">智能体</h2>
          <p className="text-[12px] text-black/40 mt-1">跨工作区协作的 AI 智能体</p>
        </div>
        <button onClick={() => setView("create")} className="flex items-center gap-2 h-9 px-4 rounded-full text-[13px] font-medium bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform]">
          <Plus size={14} />创建
        </button>
      </div>

      {deleteConfirm && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-black/[0.02] border border-black/[0.06]">
          <span className="text-[13px] text-black/70">确定删除 <strong className="font-semibold text-black">{deleteConfirm.name}</strong>？</span>
          <div className="flex gap-2">
            <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 text-[12px] font-medium rounded-lg text-black/50 hover:text-black hover:bg-black/[0.04] active:scale-[0.96] transition-[color,background-color,transform]">取消</button>
            <button onClick={() => handleDelete(deleteConfirm)} className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform]">删除</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-[12px] text-black/30">加载中...</div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 rounded-2xl bg-black/[0.01] border border-dashed border-black/[0.06]">
          <p className="text-[13px] font-medium text-black/60 mb-1">还没有智能体</p>
          <p className="text-[11px] text-black/30 mb-6">创建智能体以启用跨工作区 AI 协作</p>
          <button onClick={() => setView("create")} className="flex items-center gap-2 h-8 px-4 rounded-full text-[13px] font-medium bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform]">
            <Plus size={13} />创建智能体
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          {agents.map((agent) => (
            <div
              key={agent.id}
              onClick={() => handleEdit(agent)}
              className="flex items-center justify-between px-4 py-3 rounded-xl border border-black/[0.06] bg-white hover:border-black/[0.1] transition-colors cursor-pointer active:scale-[0.99]"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-black">{agent.name}</div>
                {agent.description && (
                  <div className="text-[11px] text-black/40 mt-0.5 truncate max-w-[300px]">{agent.description}</div>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteConfirm(agent); }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-black/20 hover:text-black/50 hover:bg-black/[0.04] active:scale-[0.96] transition-[color,background-color,transform]"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button onClick={() => setView("create")} className="flex items-center gap-2 text-[13px] text-black/40 hover:text-black transition-colors mt-4 active:scale-[0.96] transition-transform">
            <Plus size={14} />再添加一个
          </button>
        </div>
      )}
    </div>
  );
}