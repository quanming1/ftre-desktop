/**
 * ModelSettings — Manage AI model and provider configuration.
 *
 * Reads/writes ~/.ai-base/config.json directly via Electron IPC.
 * Only touches `agents.defaults` and `providers` sections.
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, ChevronLeft, Save, Eye, EyeOff } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────

interface ProviderConfig {
  api_key?: string | null;
  api_base?: string | null;
  extra_headers?: Record<string, string>;
  extra_body?: Record<string, unknown>;
}

interface AgentDefaults {
  model: string;
  provider: string;
  [key: string]: unknown;
}

interface AiBaseConfig {
  agents?: { defaults?: AgentDefaults; [key: string]: unknown };
  providers?: Record<string, ProviderConfig>;
  [key: string]: unknown; // preserve other fields
}

// ─── Constants ──────────────────────────────────────────────────────

const CONFIG_PATH = "~/.ai-base/config.json";

const KNOWN_PROVIDERS: { name: string; label: string; defaultBase: string }[] = [
  { name: "custom", label: "自定义", defaultBase: "" },
  { name: "openai", label: "OpenAI", defaultBase: "https://api.openai.com/v1" },
  { name: "anthropic", label: "Anthropic", defaultBase: "https://api.anthropic.com" },
  { name: "deepseek", label: "DeepSeek", defaultBase: "https://api.deepseek.com" },
  { name: "moonshot", label: "Moonshot (Kimi)", defaultBase: "https://api.moonshot.ai/v1" },
  { name: "dashscope", label: "通义 (Qwen)", defaultBase: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { name: "openrouter", label: "OpenRouter", defaultBase: "https://openrouter.ai/api/v1" },
  { name: "volcengine", label: "火山引擎", defaultBase: "https://ark.cn-beijing.volces.com/api/v3" },
  { name: "siliconflow", label: "硅基流动", defaultBase: "https://api.siliconflow.cn/v1" },
  { name: "minimax", label: "MiniMax", defaultBase: "https://api.minimax.io/v1" },
  { name: "gemini", label: "Gemini", defaultBase: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  { name: "zhipu", label: "智谱", defaultBase: "https://open.bigmodel.cn/api/paas/v4" },
];

// ─── Helpers ────────────────────────────────────────────────────────

function maskKey(key: string | null | undefined): string {
  if (!key) return "";
  if (key.length <= 12) return "••••••••";
  return key.slice(0, 8) + "••••••••" + key.slice(-4);
}

function resolveConfigPath(): string {
  // Electron IPC should handle ~ expansion, but just in case
  return CONFIG_PATH;
}

async function readConfig(): Promise<AiBaseConfig> {
  try {
    const raw = await window.desktop.fs.readFile(resolveConfigPath());
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeConfig(config: AiBaseConfig): Promise<void> {
  const content = JSON.stringify(config, null, 2);
  await window.desktop.fs.writeFile(resolveConfigPath(), content);
}

// ─── Component ──────────────────────────────────────────────────────

type View = "main" | "edit-provider";

export function ModelSettings() {
  const [config, setConfig] = useState<AiBaseConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Current model/provider
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");

  // Provider edit
  const [view, setView] = useState<View>("main");
  const [editName, setEditName] = useState("");
  const [editKey, setEditKey] = useState("");
  const [editBase, setEditBase] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isNewProvider, setIsNewProvider] = useState(false);

  // Load config
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await readConfig();
      setConfig(cfg);
      setModel(cfg.agents?.defaults?.model || "");
      setProvider(cfg.agents?.defaults?.provider || "auto");
    } catch (e) {
      setError("无法读取配置文件");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Save model + provider selection
  const handleSaveDefaults = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = { ...config };
      if (!updated.agents) updated.agents = { defaults: { model: "", provider: "auto" } };
      if (!updated.agents.defaults) updated.agents.defaults = { model: "", provider: "auto" };
      updated.agents.defaults.model = model;
      updated.agents.defaults.provider = provider;
      await writeConfig(updated);
      setConfig(updated);
      setSuccess("已保存，下次对话生效");
      setTimeout(() => setSuccess(null), 3000);
    } catch {
      setError("保存失败");
    } finally {
      setSaving(false);
    }
  };

  // Open provider editor
  const handleEditProvider = (name: string) => {
    const p = config?.providers?.[name];
    setEditName(name);
    setEditKey(p?.api_key || "");
    setEditBase(p?.api_base || "");
    setShowKey(false);
    setIsNewProvider(false);
    setView("edit-provider");
  };

  const handleAddProvider = () => {
    setEditName("");
    setEditKey("");
    setEditBase("");
    setShowKey(false);
    setIsNewProvider(true);
    setView("edit-provider");
  };

  // Save provider
  const handleSaveProvider = async () => {
    if (!editName.trim()) { setError("Provider 名称不能为空"); return; }
    if (!editKey.trim()) { setError("API Key 不能为空"); return; }
    if (!config) return;

    setSaving(true);
    setError(null);
    try {
      const updated = { ...config };
      if (!updated.providers) updated.providers = {};
      updated.providers[editName.trim()] = {
        api_key: editKey.trim(),
        api_base: editBase.trim() || null,
      };
      await writeConfig(updated);
      setConfig(updated);
      setView("main");
      setSuccess("Provider 已保存");
      setTimeout(() => setSuccess(null), 3000);
    } catch {
      setError("保存失败");
    } finally {
      setSaving(false);
    }
  };

  // Delete provider
  const handleDeleteProvider = async (name: string) => {
    if (!config) return;
    if (!confirm(`确定删除 Provider "${name}"？`)) return;
    const updated = { ...config };
    if (updated.providers) {
      delete updated.providers[name];
    }
    await writeConfig(updated);
    setConfig(updated);
  };

  // ─── Provider Edit View ─────────────────────────────────────────

  if (view === "edit-provider") {
    const knownProvider = KNOWN_PROVIDERS.find((p) => p.name === editName);
    return (
      <div className="h-full flex flex-col">
        <button
          onClick={() => { setView("main"); setError(null); }}
          className="inline-flex items-center gap-1 text-[13px] text-t-dim hover:text-t-primary transition-colors mb-8"
        >
          <ChevronLeft size={14} />
          返回
        </button>

        <h2 className="text-[20px] font-light text-t-primary mb-2">
          {isNewProvider ? "添加 Provider" : `编辑 ${editName}`}
        </h2>
        <p className="text-[13px] text-t-dim mb-8">配置 API 连接信息</p>

        {error && <div className="text-[13px] text-[#f85149] mb-4">{error}</div>}

        <div className="space-y-6 flex-1">
          {/* Provider name */}
          <div>
            <label className="block text-[12px] text-t-ghost uppercase tracking-wider mb-2">
              Provider 名称
            </label>
            {isNewProvider ? (
              <select
                value={editName}
                onChange={(e) => {
                  setEditName(e.target.value);
                  const known = KNOWN_PROVIDERS.find((p) => p.name === e.target.value);
                  if (known && !editBase) setEditBase(known.defaultBase);
                }}
                className="w-full h-9 px-3 rounded bg-elevated border border-border text-[13px] text-t-primary focus:outline-none focus:border-neon"
              >
                <option value="">选择 Provider...</option>
                {KNOWN_PROVIDERS.map((p) => (
                  <option key={p.name} value={p.name}>{p.label} ({p.name})</option>
                ))}
              </select>
            ) : (
              <div className="text-[14px] text-t-primary font-mono py-2">
                {knownProvider ? `${knownProvider.label} (${editName})` : editName}
              </div>
            )}
          </div>

          {/* API Key */}
          <div>
            <label className="block text-[12px] text-t-ghost uppercase tracking-wider mb-2">
              API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={editKey}
                onChange={(e) => setEditKey(e.target.value)}
                placeholder="sk-..."
                className="w-full h-9 px-3 pr-10 rounded bg-elevated border border-border text-[13px] text-t-primary font-mono focus:outline-none focus:border-neon"
              />
              <button
                type="button"
                onClick={() => setShowKey((p) => !p)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-t-ghost hover:text-t-secondary"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* API Base */}
          <div>
            <label className="block text-[12px] text-t-ghost uppercase tracking-wider mb-2">
              API Base URL
            </label>
            <input
              value={editBase}
              onChange={(e) => setEditBase(e.target.value)}
              placeholder={knownProvider?.defaultBase || "https://api.example.com/v1"}
              className="w-full h-9 px-3 rounded bg-elevated border border-border text-[13px] text-t-primary font-mono focus:outline-none focus:border-neon"
            />
            {knownProvider && knownProvider.defaultBase && (
              <p className="text-[11px] text-t-ghost mt-1">
                留空则使用默认地址：{knownProvider.defaultBase}
              </p>
            )}
          </div>
        </div>

        {/* Save button */}
        <div className="mt-8 pt-4 border-t border-border">
          <button
            onClick={handleSaveProvider}
            disabled={saving}
            className="px-6 py-2.5 text-[13px] font-medium text-base bg-neon hover:bg-neon-hover rounded transition-colors disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    );
  }

  // ─── Main View ──────────────────────────────────────────────────

  if (loading) {
    return <div className="text-[13px] text-t-ghost p-8">加载配置中...</div>;
  }

  const providers = config?.providers || {};
  const providerNames = Object.keys(providers);

  return (
    <div className="h-full flex flex-col">
      <div className="mb-8">
        <h1 className="text-[20px] font-light text-t-primary mb-2">模型配置</h1>
        <p className="text-[13px] text-t-dim">
          管理 AI 模型和 Provider 连接，修改后下次对话自动生效
        </p>
      </div>

      {error && <div className="text-[13px] text-[#f85149] mb-4">{error}</div>}
      {success && <div className="text-[13px] text-green-500 mb-4">{success}</div>}

      {/* ── Current Model ── */}
      <section className="mb-8">
        <h2 className="text-[14px] font-medium text-t-primary mb-4">当前模型</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-[12px] text-t-ghost uppercase tracking-wider mb-2">
              模型名称
            </label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. gpt-4o, claude-opus-4-5, mlamp/kimi-k2.6"
              className="w-full h-9 px-3 rounded bg-elevated border border-border text-[13px] text-t-primary font-mono focus:outline-none focus:border-neon"
            />
          </div>

          <div>
            <label className="block text-[12px] text-t-ghost uppercase tracking-wider mb-2">
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full h-9 px-3 rounded bg-elevated border border-border text-[13px] text-t-primary focus:outline-none focus:border-neon"
            >
              <option value="auto">auto（按模型名自动匹配）</option>
              {providerNames.map((name) => {
                const known = KNOWN_PROVIDERS.find((p) => p.name === name);
                return (
                  <option key={name} value={name}>
                    {known ? `${known.label} (${name})` : name}
                  </option>
                );
              })}
            </select>
          </div>

          <button
            onClick={handleSaveDefaults}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2 text-[13px] font-medium text-base bg-neon hover:bg-neon-hover rounded transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? "保存中..." : "保存模型设置"}
          </button>
        </div>
      </section>

      {/* ── Providers ── */}
      <section className="flex-1">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[14px] font-medium text-t-primary">Providers</h2>
          <button
            onClick={handleAddProvider}
            className="inline-flex items-center gap-1.5 text-[13px] text-t-dim hover:text-neon transition-colors"
          >
            <Plus size={14} />
            添加
          </button>
        </div>

        {providerNames.length === 0 ? (
          <p className="text-[13px] text-t-muted">暂无 Provider 配置</p>
        ) : (
          <div className="space-y-1">
            {providerNames.map((name) => {
              const p = providers[name];
              const known = KNOWN_PROVIDERS.find((k) => k.name === name);
              return (
                <div
                  key={name}
                  className="group flex items-center justify-between py-3 px-3 -mx-3 rounded-md hover:bg-white/[0.03] cursor-pointer transition-colors"
                  onClick={() => handleEditProvider(name)}
                >
                  <div className="min-w-0">
                    <div className="text-[13px] text-t-primary group-hover:text-neon transition-colors">
                      {known ? known.label : name}
                      {known && <span className="text-t-ghost ml-1.5 text-[11px]">({name})</span>}
                    </div>
                    <div className="text-[11px] text-t-ghost mt-0.5 truncate max-w-[350px] font-mono">
                      {maskKey(p.api_key)} • {p.api_base || (known?.defaultBase || "默认")}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteProvider(name); }}
                    className="p-1.5 opacity-0 group-hover:opacity-100 text-t-ghost hover:text-[#f85149] transition-all"
                    title="删除"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
