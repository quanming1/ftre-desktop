/**
 * AgentDefSettings — 管理 ~/.ftre/agents/ 下的 agent
 *
 * 功能：
 * - 列出所有 agent（从 GET /api/agents 获取）
 * - 创建新 agent（POST /api/agents）
 * - 编辑 agent 的 name / model / workspace / prompt 文件
 * - 删除 agent（DELETE /api/agents/{id}，default 不可删）
 */
import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, ChevronRight, Save, X } from "lucide-react";
import {
  fetchChatAgents,
  createAgent,
  deleteAgent,
  updateAgent,
  fetchAgentPrompts,
  updateAgentPrompt,
  fetchAppConfig,
  type ChatAgent,
} from "@/services/api";
import { ModelPicker } from "@/features/chat/ModelPicker";
import { buildProviderInfos } from "@/features/chat/providerInfo";

type View = "list" | "create" | "edit";

export function AgentDefSettings() {
  const [view, setView] = useState<View>("list");
  const [agents, setAgents] = useState<ChatAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editAgent, setEditAgent] = useState<ChatAgent | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ChatAgent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchChatAgents();
      setAgents(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreated = async (id: string) => {
    await load();
    const agent = agents.find((a) => a.id === id);
    if (agent) {
      setEditAgent(agent);
      setView("edit");
    } else {
      // refresh and find
      const list = await fetchChatAgents();
      setAgents(list);
      const found = list.find((a) => a.id === id);
      if (found) {
        setEditAgent(found);
        setView("edit");
      } else {
        setView("list");
      }
    }
  };

  const handleDelete = async (agent: ChatAgent) => {
    const ok = await deleteAgent(agent.id);
    if (ok) {
      setDeleteConfirm(null);
      await load();
    }
  };

  // ─── List View ────────────────────────────────────────────
  if (view === "list") {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-[15px] font-semibold text-black">智能体</h2>
          <p className="text-[12px] text-black/40 mt-1">
            管理你的 AI 智能体。每个智能体有独立的模型、工作区、工具权限和提示词。
          </p>
        </div>

        {loading ? (
          <div className="text-[12px] text-black/30">加载中...</div>
        ) : agents.length === 0 ? (
          <div className="text-[12px] text-black/30">还没有智能体</div>
        ) : (
          <div className="space-y-2">
            {agents.map((agent) => (
              <div
                key={agent.id}
                onClick={() => {
                  setEditAgent(agent);
                  setView("edit");
                }}
                className="flex items-center gap-3 p-3.5 rounded-xl border border-black/[0.06] bg-white hover:border-black/[0.1] transition-colors cursor-pointer active:scale-[0.99] transition-transform"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-black">
                      {agent.name || agent.id}
                    </span>
                    {agent.is_builtin && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/[0.04] text-black/40">
                        内置
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-black/40 mt-0.5 truncate">
                    {agent.provider && agent.model
                      ? `${agent.provider} / ${agent.model}`
                      : "未配置模型"}
                    {agent.workspace ? ` · ${agent.workspace}` : ""}
                  </div>
                </div>
                {!agent.is_builtin && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(agent);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-black/20 hover:text-black/50 hover:bg-black/[0.04] active:scale-[0.96] transition-[color,background-color,transform]"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <ChevronRight size={16} className="text-black/20" />
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => setView("create")}
          className="flex items-center gap-2 text-[13px] text-black/40 hover:text-black transition-colors mt-4 active:scale-[0.96] transition-transform"
        >
          <Plus size={14} />创建新智能体
        </button>

        {/* Delete confirm */}
        {deleteConfirm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
            onClick={() => setDeleteConfirm(null)}
          >
            <div
              className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-[15px] font-semibold text-black mb-2">
                删除智能体
              </h3>
              <p className="text-[13px] text-black/50 mb-5">
                确定删除「{deleteConfirm.name || deleteConfirm.id}」吗？此操作不可撤销。
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="h-9 px-4 rounded-full text-[13px] font-medium text-black/60 hover:bg-black/[0.04] transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  className="h-9 px-4 rounded-full text-[13px] font-medium bg-red-500 text-white hover:bg-red-600 active:scale-[0.96] transition-[background-color,transform]"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Create View ──────────────────────────────────────────
  if (view === "create") {
    return (
      <CreateAgentForm
        onSave={handleCreated}
        onCancel={() => setView("list")}
      />
    );
  }

  // ─── Edit View ────────────────────────────────────────────
  if (view === "edit" && editAgent) {
    return (
      <EditAgentForm
        agent={editAgent}
        onBack={() => {
          setEditAgent(null);
          setView("list");
          load();
        }}
      />
    );
  }

  return null;
}

// ─── Create Agent Form ───────────────────────────────────────

function CreateAgentForm({
  onSave,
  onCancel,
}: {
  onSave: (id: string) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const idValid = id.length > 0 && /^[a-zA-Z0-9_-]+$/.test(id);

  const handleSubmit = async () => {
    if (!idValid) return;
    setSaving(true);
    setError("");
    try {
      const result = await createAgent({
        id: id.trim(),
        name: name.trim() || id.trim(),
      });
      if (result.ok) {
        onSave(id.trim());
      } else {
        setError("创建失败，可能 ID 已存在");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={onCancel}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-black/40 hover:text-black hover:bg-black/[0.04] transition-colors"
        >
          <X size={16} />
        </button>
        <h2 className="text-[15px] font-semibold text-black">创建智能体</h2>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-[12px] font-medium text-black/60 mb-1.5 block">
            Agent ID
          </label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="如：coder、writer、translator"
            className="w-full px-3.5 py-2.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white transition-all"
          />
          <p className="text-[11px] text-black/30 mt-1">
            只能包含字母、数字、连字符和下划线。用作目录名和 API 标识。
          </p>
        </div>

        <div>
          <label className="text-[12px] font-medium text-black/60 mb-1.5 block">
            显示名称
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="留空则使用 ID"
            className="w-full px-3.5 py-2.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white transition-all"
          />
        </div>

        {error && (
          <p className="text-[12px] text-red-500">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="h-9 px-4 rounded-full text-[13px] font-medium text-black/60 hover:bg-black/[0.04] transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !idValid}
            className="flex items-center gap-1.5 h-9 px-5 rounded-full text-[13px] font-medium bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform] disabled:opacity-30 disabled:pointer-events-none"
          >
            {saving ? "创建中..." : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Agent Form ─────────────────────────────────────────

const PROMPT_FILES = ["SOUL.md", "AGENTS.md", "USER.md"] as const;
type PromptFile = (typeof PROMPT_FILES)[number];

function EditAgentForm({
  agent,
  onBack,
}: {
  agent: ChatAgent;
  onBack: () => void;
}) {
  const [name, setName] = useState(agent.name || agent.id);
  const [workspace, setWorkspace] = useState(agent.workspace || "");
  const [provider, setProvider] = useState(agent.provider || "");
  const [model, setModel] = useState(agent.model || "");
  const [providers, setProviders] = useState<ReturnType<typeof buildProviderInfos>>([]);
  const [activePrompt, setActivePrompt] = useState<PromptFile>("SOUL.md");
  const [promptContents, setPromptContents] = useState<Record<string, string>>({});
  const [promptDirty, setPromptDirty] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Load providers from config
  useEffect(() => {
    fetchAppConfig().then((cfg) => {
      setProviders(buildProviderInfos(cfg.providers));
    });
  }, []);

  // Load prompts
  useEffect(() => {
    fetchAgentPrompts(agent.id).then((prompts) => {
      setPromptContents(prompts);
      setPromptDirty(false);
    });
  }, [agent.id]);

  const handleSaveProfile = async () => {
    setSavingField("profile");
    try {
      await updateAgent(agent.id, {
        name: name.trim(),
        workspace: workspace.trim(),
        llm: provider && model ? { provider, model } : undefined,
      });
      setSavedAt(Date.now());
    } finally {
      setSavingField(null);
    }
  };

  const handleSavePrompt = async () => {
    setSavingPrompt(true);
    try {
      await updateAgentPrompt(agent.id, activePrompt, promptContents[activePrompt] || "");
      setPromptDirty(false);
      setSavedAt(Date.now());
    } finally {
      setSavingPrompt(false);
    }
  };

  const profileDirty =
    name !== (agent.name || agent.id) ||
    workspace !== (agent.workspace || "") ||
    provider !== (agent.provider || "") ||
    model !== (agent.model || "");

  const currentPromptContent = promptContents[activePrompt] || "";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-black/40 hover:text-black hover:bg-black/[0.04] transition-colors"
        >
          <X size={16} />
        </button>
        <h2 className="text-[15px] font-semibold text-black">
          编辑：{agent.name || agent.id}
        </h2>
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-black/[0.04] text-black/40 font-mono">
          {agent.id}
        </span>
      </div>

      {/* Basic Profile */}
      <div className="rounded-xl border border-black/[0.06] bg-white p-4 space-y-4">
        <div className="text-[13px] font-semibold text-black">基本信息</div>

        <div>
          <label className="text-[12px] font-medium text-black/60 mb-1.5 block">
            显示名称
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black focus:outline-none focus:border-black/30 focus:bg-white transition-all"
          />
        </div>

        <div>
          <label className="text-[12px] font-medium text-black/60 mb-1.5 block">
            工作区
          </label>
          <input
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            placeholder="留空则使用全局默认"
            className="w-full px-3.5 py-2.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white transition-all font-mono"
          />
        </div>

        <div>
          <label className="text-[12px] font-medium text-black/60 mb-1.5 block">
            模型
          </label>
          <ModelPicker
            providers={providers}
            selected={provider && model ? { provider, modelId: model } : null}
            onSelect={(p, m) => {
              setProvider(p);
              setModel(m);
            }}
            renderTrigger={({ toggle }) => (
              <button
                onClick={toggle}
                className="flex items-center gap-2 h-9 px-3.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black hover:border-black/30 transition-colors"
              >
                {provider && model
                  ? `${provider} / ${model}`
                  : "选择模型"}
              </button>
            )}
          />
        </div>

        {profileDirty && (
          <button
            onClick={handleSaveProfile}
            disabled={savingField === "profile"}
            className="flex items-center gap-1.5 h-9 px-5 rounded-full text-[13px] font-medium bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform] disabled:opacity-30"
          >
            <Save size={14} />
            {savingField === "profile" ? "保存中..." : "保存"}
          </button>
        )}
      </div>

      {/* Prompt Files */}
      <div className="rounded-xl border border-black/[0.06] bg-white p-4 space-y-3">
        <div className="text-[13px] font-semibold text-black">提示词文件</div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 rounded-lg bg-black/[0.03]">
          {PROMPT_FILES.map((f) => (
            <button
              key={f}
              onClick={() => {
                setActivePrompt(f);
                setPromptDirty(false);
              }}
              className={`flex-1 h-8 rounded-md text-[12px] font-medium transition-colors ${
                activePrompt === f
                  ? "bg-white text-black shadow-sm"
                  : "text-black/40 hover:text-black/60"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Description for current file */}
        <p className="text-[11px] text-black/30">
          {activePrompt === "SOUL.md" && "智能体人设、边界、语气。追加到系统提示词。"}
          {activePrompt === "AGENTS.md" && "项目约定和操作指令。由 context_govern 注入。"}
          {activePrompt === "USER.md" && "用户偏好和个人要求。追加到系统提示词。"}
        </p>

        {/* Editor */}
        <textarea
          key={activePrompt}
          value={currentPromptContent}
          onChange={(e) => {
            setPromptContents((prev) => ({ ...prev, [activePrompt]: e.target.value }));
            setPromptDirty(true);
          }}
          rows={12}
          placeholder={`在 ${activePrompt} 中写入内容...`}
          className="w-full px-3.5 py-2.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white resize-y transition-all font-mono leading-relaxed"
        />

        <div className="flex items-center gap-3">
          <button
            onClick={handleSavePrompt}
            disabled={savingPrompt || !promptDirty}
            className="flex items-center gap-1.5 h-9 px-5 rounded-full text-[13px] font-medium bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform] disabled:opacity-30 disabled:pointer-events-none"
          >
            <Save size={14} />
            {savingPrompt ? "保存中..." : "保存"}
          </button>
          {savedAt && !promptDirty && !profileDirty && (
            <span className="text-[12px] text-black/35">已保存</span>
          )}
        </div>
      </div>

      {/* Agent info summary */}
      {(agent.tools_allow || agent.tools_deny || agent.mcp_servers?.length) && (
        <div className="rounded-xl border border-black/[0.06] bg-white p-4 space-y-2">
          <div className="text-[13px] font-semibold text-black">其他配置</div>
          {agent.tools_allow && agent.tools_allow.length > 0 && (
            <div className="text-[12px] text-black/50">
              <span className="font-medium text-black/70">工具白名单：</span>
              {agent.tools_allow.join(", ")}
            </div>
          )}
          {agent.tools_deny && agent.tools_deny.length > 0 && (
            <div className="text-[12px] text-black/50">
              <span className="font-medium text-black/70">工具黑名单：</span>
              {agent.tools_deny.join(", ")}
            </div>
          )}
          {agent.mcp_servers && agent.mcp_servers.length > 0 && (
            <div className="text-[12px] text-black/50">
              <span className="font-medium text-black/70">MCP 服务器：</span>
              {agent.mcp_servers.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
