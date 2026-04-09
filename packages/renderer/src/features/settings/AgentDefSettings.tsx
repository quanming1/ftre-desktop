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
      setError("Name is required");
      return;
    }
    if (!formData.id.trim()) {
      setError("ID is required");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await onSave(formData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Back link */}
      <button
        onClick={onCancel}
        className="inline-flex items-center gap-1 text-[13px] text-t-dim hover:text-t-primary transition-colors mb-12"
      >
        <ChevronLeft size={14} />
        Back
      </button>

      {/* Main content - full width with generous spacing */}
      <div className="flex-1">
        {/* Title */}
        <h1 className="text-[24px] font-light text-t-primary mb-2">
          {isEdit ? "Edit Agent" : "Create Agent"}
        </h1>
        <p className="text-[13px] text-t-dim mb-12">
          Define an AI agent for cross-workspace collaboration
        </p>

        {/* Form fields with generous spacing */}
        <div className="space-y-8">
          {/* Name - the hero field */}
          <div>
            <input
              value={formData.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Agent name"
              className="w-full text-[18px] font-light bg-transparent text-t-primary placeholder:text-t-ghost border-b border-border pb-3 focus:outline-none focus:border-neon transition-colors"
            />
            {!isEdit && formData.id && (
              <div className="text-[11px] text-t-ghost mt-2 font-mono">
                {formData.id}
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="What does this agent do?"
              rows={3}
              className="w-full text-[14px] bg-transparent text-t-secondary placeholder:text-t-ghost border-b border-border pb-3 focus:outline-none focus:border-neon transition-colors resize-none leading-relaxed"
            />
          </div>

          {/* Tools */}
          <div>
            <label className="block text-[11px] text-t-ghost uppercase tracking-wider mb-3">
              Available Tools
            </label>
            <SearchableMultiSelect
              options={AVAILABLE_TOOLS}
              value={formData.tools}
              onChange={(tools) => setFormData((prev) => ({ ...prev, tools }))}
              placeholder="Select tools..."
              searchPlaceholder="Search..."
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="text-[13px] text-[#f85149] mt-6">{error}</div>
        )}

        {/* Save button - prominent, at the bottom */}
        <div className="mt-16">
          <button
            onClick={handleSubmit}
            disabled={saving || !formData.name.trim()}
            className="px-8 py-3 text-[13px] font-medium text-base bg-neon hover:bg-neon-hover rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save Agent"}
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

    // Create directory and write file
    await window.desktop.fs.createFolder(agentDir);
    const result = await window.desktop.fs.writeFile(agentFile, agentMdContent);

    if (!result.success) {
      throw new Error(result.error || "Failed to write file");
    }

    await loadAgents();
    setView("list");
    setEditingAgent(null);
  };

  const handleDelete = async (agent: AgentDef) => {
    if (!workspace) return;
    if (!confirm(`Delete agent "${agent.name}"?`)) return;

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
        Open a workspace to configure agents
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
      {/* Title section with generous top spacing */}
      <div className="mb-16">
        <h1 className="text-[24px] font-light text-t-primary mb-2">Agents</h1>
        <p className="text-[13px] text-t-dim">
          AI agents for cross-workspace collaboration
        </p>
      </div>

      {/* Content */}
      <div className="flex-1">
        {loading ? (
          <div className="text-[13px] text-t-ghost">Loading...</div>
        ) : agents.length === 0 ? (
          /* Empty state - clean and inviting */
          <div>
            <p className="text-[14px] text-t-muted leading-relaxed mb-8">
              No agents yet. Create an agent to enable AI-powered collaboration across different workspaces.
            </p>
            <button
              onClick={() => setView("create")}
              className="inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-medium text-base bg-neon hover:bg-neon-hover rounded transition-colors"
            >
              <Plus size={16} strokeWidth={2} />
              Create Agent
            </button>
          </div>
        ) : (
          /* Agent list - spacious layout */
          <div>
            {/* List */}
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
                    title="Delete agent"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Add new button */}
            <button
              onClick={() => setView("create")}
              className="inline-flex items-center gap-2 text-[13px] text-t-dim hover:text-neon transition-colors"
            >
              <Plus size={14} />
              Add another agent
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
