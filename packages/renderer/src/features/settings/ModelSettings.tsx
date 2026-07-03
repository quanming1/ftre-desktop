/**
 * ModelSettings — 供应商和模型配置
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus,
  Trash2,
  Save,
  Eye,
  EyeOff,
  Cpu,
  ChevronDown,
  X,
} from "lucide-react";
import { fetchAppConfig, saveAppConfig, type ModelItem } from "@/services/api";
import { ModelPicker } from "../chat/ModelPicker";
import { buildProviderInfos } from "../chat/providerInfo";

// ─── Types ──────────────────────────────────────────────────────────

interface ProviderConfig {
  api_key?: string | null;
  api_base?: string | null;
  api_protocol?: string | null;
  models?: ModelItem[];
}

interface AiBaseConfig {
  agents?: {
    title_generation?: { provider?: string; model?: string } | null;
    compact_generation?: { provider?: string; model?: string } | null;
  };
  providers?: Record<string, ProviderConfig>;
  [key: string]: unknown;
}

const API_PROTOCOLS: { value: string; label: string }[] = [
  { value: "openai", label: "OpenAI 兼容" },
  { value: "anthropic", label: "Anthropic" },
  { value: "azure", label: "Azure OpenAI" },
  { value: "bedrock", label: "AWS Bedrock" },
  { value: "gemini", label: "Gemini" },
];

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
  { name: "qianfan", label: "百度千帆", defaultBase: "https://qianfan.baidubce.com/v2" },
  { name: "groq", label: "Groq", defaultBase: "https://api.groq.com/openai/v1" },
  { name: "mistral", label: "Mistral", defaultBase: "https://api.mistral.ai/v1" },
];

function maskKey(key: string | null | undefined): string {
  if (!key) return "";
  if (key.length <= 12) return "••••••••";
  return key.slice(0, 6) + "••••" + key.slice(-4);
}

async function readConfig(): Promise<AiBaseConfig> {
  return (await fetchAppConfig()) as AiBaseConfig;
}

async function writeConfig(config: AiBaseConfig): Promise<void> {
  const ok = await saveAppConfig(config as Record<string, any>);
  if (!ok) throw new Error("保存配置失败");
}

function getProviderLabel(name: string): string {
  const known = KNOWN_PROVIDERS.find((p) => p.name === name);
  return known?.label || name;
}

function validateProviderName(name: string): { valid: boolean; error?: string } {
  if (!name.trim()) return { valid: false, error: "请输入供应商名称" };
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_]+$/.test(name.trim()))
    return { valid: false, error: "供应商名称只能包含中文、英文、数字、下划线" };
  return { valid: true };
}

// ─── 主组件 ──────────────────────────────────────────────────────────

export function ModelSettings() {
  const [config, setConfig] = useState<AiBaseConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "edit">("list");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formTemplate, setFormTemplate] = useState("custom");
  const [formKey, setFormKey] = useState("");
  const [formBase, setFormBase] = useState("");
  const [formProtocol, setFormProtocol] = useState("openai");
  const [formModels, setFormModels] = useState<ModelItem[]>([]);
  const [showKey, setShowKey] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setConfig(await readConfig());
      setError(null);
    } catch (e: any) {
      setError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const startEdit = (name: string) => {
    const p = config?.providers?.[name];
    if (!p) return;
    setView("edit");
    setEditingName(name);
    setFormName(name);
    setFormTemplate("custom");
    setFormKey(p.api_key || "");
    setFormBase(p.api_base || "");
    setFormProtocol(p.api_protocol || "openai");
    setFormModels(p.models ? [...p.models] : []);
    setShowKey(false);
    setError(null);
  };

  const startAdd = () => {
    setView("edit");
    setEditingName(null);
    setFormName("");
    setFormTemplate("custom");
    setFormKey("");
    setFormBase("");
    setFormProtocol("openai");
    setFormModels([]);
    setShowKey(false);
    setError(null);
  };

  const handleSave = async () => {
    const name = formName.trim();
    const nameCheck = validateProviderName(name);
    if (!nameCheck.valid) {
      setError(nameCheck.error);
      return;
    }
    if (editingName && name !== editingName) {
      setError("供应商名称不可修改");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = JSON.parse(JSON.stringify(config || {})) as AiBaseConfig;
      if (!updated.providers) updated.providers = {};
      if (editingName && editingName !== name) {
        delete updated.providers[editingName];
      }
      updated.providers[name] = {
        api_key: formKey || null,
        api_base: formBase || null,
        api_protocol: formProtocol || "openai",
        models: formModels,
      };
      await writeConfig(updated);
      setView("list");
      await refresh();
    } catch (e: any) {
      setError(e.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    setError(null);
    try {
      const updated = JSON.parse(JSON.stringify(config || {})) as AiBaseConfig;
      if (updated.providers) delete updated.providers[name];
      await writeConfig(updated);
      setDeleteConfirm(null);
      await refresh();
    } catch (e: any) {
      setError(e.message || "删除失败");
    }
  };

  const updateModel = (index: number, key: string, value: any) => {
    const next = [...formModels];
    next[index] = { ...next[index], [key]: value };
    setFormModels(next);
  };

  const addModel = () => {
    setFormModels([...formModels, { id: "", name: "", context_window: null, max_output: null }]);
  };

  const removeModel = (index: number) => {
    setFormModels(formModels.filter((_, i) => i !== index));
  };

  // ─── Edit View ──────────────────────────────────────────────────

  if (view === "edit") {
    return (
      <div className="space-y-6">
        <button
          onClick={() => { setView("list"); setError(null); }}
          className="group flex items-center gap-1.5 text-[13px] text-black/40 hover:text-black transition-colors active:scale-[0.96] transition-transform"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M9 3L4 8L4 10L6 10L11 5" /></svg>
          {editingName ? `编辑 ${getProviderLabel(editingName)}` : "添加供应商"}
        </button>

        {error && (
          <div className="flex items-center gap-2 px-4 py-2.5 text-[12px] rounded-lg bg-black/[0.02] border border-black/[0.06] text-black/60">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-black/30 hover:text-black/60 transition-colors"><X size={13} /></button>
          </div>
        )}

        <div className="space-y-5">
          {/* Name */}
          <div>
            <div className="text-[12px] font-semibold text-black/70 mb-2">供应商名称</div>
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              disabled={!!editingName}
              placeholder="DeepSeek 官方"
              className="w-full h-10 px-3.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white disabled:opacity-40 transition-all"
            />
          </div>

          {/* Quick select template */}
          {!editingName && (
            <div>
              <div className="text-[12px] font-semibold text-black/70 mb-2">快速选择</div>
              <div className="flex flex-wrap gap-2">
                {KNOWN_PROVIDERS.filter(p => p.name !== "custom").map((p) => (
                  <button
                    key={p.name}
                    onClick={() => {
                      setFormTemplate(p.name);
                      if (p.name !== "custom") {
                        setFormName(p.name === "openai" ? "" : p.name);
                        setFormBase(p.defaultBase);
                      }
                    }}
                    className={`px-3 py-1.5 text-[12px] font-medium rounded-lg border transition-all active:scale-[0.96] ${
                      formTemplate === p.name
                        ? "border-black bg-black text-white"
                        : "border-black/[0.08] bg-white text-black/60 hover:border-black/[0.15]"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* API Key */}
          <div>
            <div className="text-[12px] font-semibold text-black/70 mb-2">API Key</div>
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
                placeholder="sk-..."
                className="flex-1 h-10 px-3.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white font-mono transition-all"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-black/[0.08] bg-white text-black/30 hover:text-black/60 active:scale-[0.96] transition-[color,transform]"
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* API Base */}
          <div>
            <div className="text-[12px] font-semibold text-black/70 mb-2">API Base</div>
            <input
              value={formBase}
              onChange={(e) => setFormBase(e.target.value)}
              placeholder="https://api.deepseek.com"
              className="w-full h-10 px-3.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white font-mono transition-all"
            />
          </div>

          {/* Protocol */}
          <div>
            <div className="text-[12px] font-semibold text-black/70 mb-2">协议</div>
            <div className="flex flex-wrap gap-2">
              {API_PROTOCOLS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setFormProtocol(p.value)}
                  className={`px-3 py-1.5 text-[12px] font-medium rounded-lg border transition-all active:scale-[0.96] ${
                    formProtocol === p.value
                      ? "border-black bg-black text-white"
                      : "border-black/[0.08] bg-white text-black/60 hover:border-black/[0.15]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Models */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[12px] font-semibold text-black/70">模型列表</div>
              <button
                onClick={addModel}
                className="flex items-center gap-1 text-[12px] text-black/40 hover:text-black active:scale-[0.96] transition-[color,transform]"
              >
                <Plus size={13} />添加模型
              </button>
            </div>
            {formModels.length === 0 ? (
              <div className="text-[12px] text-black/30 py-4 text-center rounded-lg bg-black/[0.01] border border-dashed border-black/[0.06]">
                暂无模型，点击"添加模型"配置
              </div>
            ) : (
              <div className="space-y-3">
                {formModels.map((model, index) => (
                  <div key={index} className="rounded-xl border border-black/[0.06] bg-white p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[12px] font-semibold text-black/40">模型 #{index + 1}</span>
                      <button
                        onClick={() => removeModel(index)}
                        className="text-black/20 hover:text-black/50 active:scale-[0.96] transition-[color,transform]"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="space-y-3">
                      <input
                        value={model.id}
                        onChange={(e) => updateModel(index, "id", e.target.value)}
                        placeholder="模型 ID，如 deepseek-chat"
                        className="w-full h-10 px-3.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white font-mono transition-all"
                      />
                      <input
                        value={model.name || ""}
                        onChange={(e) => updateModel(index, "name", e.target.value)}
                        placeholder="显示名称，如 DeepSeek Chat"
                        className="w-full h-10 px-3.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white transition-all"
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <input
                          type="text" inputMode="numeric"
                          value={model.context_window == null ? "" : String(model.context_window)}
                          onChange={(e) => { const v = e.target.value.trim(); if (!v) return updateModel(index, "context_window", null); if (/^\d+$/.test(v)) updateModel(index, "context_window", parseInt(v)); }}
                          placeholder="上下文 token"
                          className="h-10 px-3.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white font-mono tabular-nums transition-all"
                        />
                        <input
                          type="text" inputMode="numeric"
                          value={model.max_output == null ? "" : String(model.max_output)}
                          onChange={(e) => { const v = e.target.value.trim(); if (!v) return updateModel(index, "max_output", null); if (/^\d+$/.test(v)) updateModel(index, "max_output", parseInt(v)); }}
                          placeholder="最大输出 token"
                          className="h-10 px-3.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white font-mono tabular-nums transition-all"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-black/[0.06]">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 h-9 px-5 rounded-full text-[13px] font-medium bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform] disabled:opacity-30 disabled:pointer-events-none"
          >
            <Save size={13} />
            {saving ? "保存中..." : "保存"}
          </button>
          <button
            onClick={() => { setView("list"); setError(null); }}
            className="text-[12px] text-black/35 hover:text-black/60 active:scale-[0.96] transition-[color,transform]"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  // ─── List View ──────────────────────────────────────────────────

  if (loading) {
    return <div className="text-[12px] text-black/30 p-4">加载中...</div>;
  }

  const providers = config?.providers || {};
  const providerNames = Object.keys(providers);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-black">供应商配置</h2>
          <p className="text-[12px] text-black/40 mt-1">管理 AI 模型供应商和可用模型</p>
        </div>
        <button
          onClick={startAdd}
          className="flex items-center gap-2 h-9 px-4 rounded-full text-[13px] font-medium bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform]"
        >
          <Plus size={14} />添加
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 text-[12px] rounded-lg bg-black/[0.02] border border-black/[0.06] text-black/60">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-black/30 hover:text-black/60 transition-colors"><X size={13} /></button>
        </div>
      )}

      {deleteConfirm && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-black/[0.02] border border-black/[0.06]">
          <span className="text-[13px] text-black/70">确定删除 <strong className="font-semibold text-black">{getProviderLabel(deleteConfirm)}</strong>？</span>
          <div className="flex gap-2">
            <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 text-[12px] font-medium rounded-lg text-black/50 hover:text-black hover:bg-black/[0.04] active:scale-[0.96] transition-[color,background-color,transform]">取消</button>
            <button onClick={() => handleDelete(deleteConfirm)} className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform]">删除</button>
          </div>
        </div>
      )}

      {providerNames.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 rounded-2xl bg-black/[0.01] border border-dashed border-black/[0.06]">
          <div className="w-12 h-12 rounded-2xl bg-black/[0.03] flex items-center justify-center mb-4">
            <Cpu size={20} className="text-black/30" />
          </div>
          <p className="text-[13px] font-medium text-black/60 mb-1">暂无供应商</p>
          <p className="text-[11px] text-black/30 mb-6">点击"添加"按钮配置</p>
          <button onClick={startAdd} className="flex items-center gap-2 h-8 px-4 rounded-full text-[13px] font-medium bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform]">
            <Plus size={13} />添加供应商
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <TitleGenerationPicker config={config!} onChange={setConfig} />
          <CompactGenerationPicker config={config!} onChange={setConfig} />
          {providerNames.map((name) => {
            const p = providers[name];
            const modelCount = p.models?.length || 0;
            return (
              <div
                key={name}
                onClick={() => startEdit(name)}
                className="rounded-xl border border-black/[0.06] bg-white hover:border-black/[0.1] transition-colors cursor-pointer active:scale-[0.99]"
              >
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-black">{getProviderLabel(name)}</div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-black/40">
                      <span className="font-mono">{maskKey(p.api_key)}</span>
                      {modelCount > 0 && <span>{modelCount} 个模型</span>}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(name); }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-black/20 hover:text-black/50 hover:bg-black/[0.04] active:scale-[0.96] transition-[color,background-color,transform]"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Title Generation Picker ────────────────────────────────────────

function TitleGenerationPicker({
  config,
  onChange,
}: {
  config: AiBaseConfig;
  onChange: (next: AiBaseConfig) => void;
}) {
  const providers = useMemo(() => buildProviderInfos(config.providers), [config.providers]);
  const tg = config.agents?.title_generation || null;
  const selected = tg?.provider && tg?.model ? { provider: tg.provider, modelId: tg.model } : null;

  const currentLabel = (() => {
    if (!selected) return "沿用主对话模型";
    for (const p of providers) {
      const m = p.models.find((mm) => mm.id === selected.modelId);
      if (m && p.name === selected.provider) return m.name || m.id;
    }
    return `${selected.provider} / ${selected.modelId}`;
  })();

  const persist = async (next: AiBaseConfig) => {
    try { await writeConfig(next); onChange(next); } catch {}
  };

  const handleSelectModel = async (providerName: string, modelId: string) => {
    const updated = JSON.parse(JSON.stringify(config));
    if (!updated.agents) updated.agents = {};
    updated.agents.title_generation = { provider: providerName, model: modelId };
    await persist(updated);
  };

  const handleClear = async () => {
    const updated = JSON.parse(JSON.stringify(config));
    if (updated.agents?.title_generation !== undefined)
      delete updated.agents.title_generation;
    await persist(updated);
  };

  return (
    <div className="rounded-xl border border-black/[0.06] bg-white p-4">
      <div className="text-[13px] font-semibold text-black mb-1">标题生成模型</div>
      <div className="text-[11px] text-black/40 mb-3">首条用户消息后异步生成会话标题</div>
      <ModelPicker
        providers={providers}
        selected={selected}
        onSelect={handleSelectModel}
        placement="bottom"
        panelWidthClass="w-full min-w-[280px]"
        extraTopOption={{
          key: "fallback", label: "沿用主对话模型", selected: !selected, onSelect: handleClear,
        }}
        renderTrigger={({ open, toggle }) => (
          <button
            type="button" onClick={toggle}
            className="w-full h-9 px-3.5 flex items-center justify-between gap-2 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black hover:border-black/[0.15] transition-all"
          >
            <span className="truncate text-left flex-1">{currentLabel}</span>
            <ChevronDown size={12} className={`shrink-0 text-black/30 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      />
    </div>
  );
}

// ─── Compact Generation Picker ──────────────────────────────────────

function CompactGenerationPicker({
  config,
  onChange,
}: {
  config: AiBaseConfig;
  onChange: (next: AiBaseConfig) => void;
}) {
  const providers = useMemo(() => buildProviderInfos(config.providers), [config.providers]);
  const cg = config.agents?.compact_generation || null;
  const selected = cg?.provider && cg?.model ? { provider: cg.provider, modelId: cg.model } : null;

  const currentLabel = (() => {
    if (!selected) return "沿用主对话模型";
    for (const p of providers) {
      const m = p.models.find((mm) => mm.id === selected.modelId);
      if (m && p.name === selected.provider) return m.name || m.id;
    }
    return `${selected.provider} / ${selected.modelId}`;
  })();

  const persist = async (next: AiBaseConfig) => {
    try { await writeConfig(next); onChange(next); } catch {}
  };

  const handleSelectModel = async (providerName: string, modelId: string) => {
    const updated = JSON.parse(JSON.stringify(config));
    if (!updated.agents) updated.agents = {};
    updated.agents.compact_generation = { provider: providerName, model: modelId };
    await persist(updated);
  };

  const handleClear = async () => {
    const updated = JSON.parse(JSON.stringify(config));
    if (updated.agents?.compact_generation !== undefined)
      delete updated.agents.compact_generation;
    await persist(updated);
  };

  return (
    <div className="rounded-xl border border-black/[0.06] bg-white p-4">
      <div className="text-[13px] font-semibold text-black mb-1">上下文压缩模型</div>
      <div className="text-[11px] text-black/40 mb-3">长上下文自动压缩时使用的模型</div>
      <ModelPicker
        providers={providers}
        selected={selected}
        onSelect={handleSelectModel}
        placement="bottom"
        panelWidthClass="w-full min-w-[280px]"
        extraTopOption={{
          key: "fallback", label: "沿用主对话模型", selected: !selected, onSelect: handleClear,
        }}
        renderTrigger={({ open, toggle }) => (
          <button
            type="button" onClick={toggle}
            className="w-full h-9 px-3.5 flex items-center justify-between gap-2 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black hover:border-black/[0.15] transition-all"
          >
            <span className="truncate text-left flex-1">{currentLabel}</span>
            <ChevronDown size={12} className={`shrink-0 text-black/30 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      />
    </div>
  );
}