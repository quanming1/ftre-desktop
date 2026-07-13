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
    setFormModels([...formModels, { id: "", name: "", context_window: null, max_output: null, vision: false }]);
  };

  const removeModel = (index: number) => {
    setFormModels(formModels.filter((_, i) => i !== index));
  };

  // ─── Edit View ──────────────────────────────────────────────────

  if (view === "edit") {
    return (
      <div className="flex min-h-0 flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => { setView("list"); setError(null); }}
              aria-label="返回供应商列表"
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-black/[0.08] bg-white text-black/45 hover:border-black/[0.16] hover:text-black active:scale-95 transition-all"
            >
              <span className="text-[18px] leading-none">‹</span>
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-black">
                  {editingName ? getProviderLabel(editingName) : "添加供应商"}
                </h2>
                {editingName && <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] text-black/40">供应商</span>}
              </div>
              <p className="mt-1 text-[12px] text-black/40">配置连接信息，并管理该供应商下的模型能力</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => { setView("list"); setError(null); }}
              className="h-9 rounded-lg px-3 text-[12px] font-medium text-black/45 hover:bg-black/[0.04] hover:text-black transition-colors"
            >取消</button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-black px-4 text-[12px] font-medium text-white hover:bg-black/80 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 transition-all"
            >
              <Save size={13} />{saving ? "保存中" : "保存修改"}
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/15 bg-red-500/[0.04] px-3.5 py-2.5 text-[12px] text-red-700/75">
            <span className="min-w-0 flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="关闭错误提示" className="text-red-700/40 hover:text-red-700"><X size={13} /></button>
          </div>
        )}

        <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/[0.06] text-[12px] font-semibold text-black/60">01</div>
            <div>
              <h3 className="text-[13px] font-semibold text-black">连接设置</h3>
              <p className="text-[11px] text-black/35">供应商名称、鉴权和请求协议</p>
            </div>
          </div>

          {!editingName && (
            <div className="mb-4 rounded-xl bg-black/[0.025] p-3.5">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/35">快速开始</div>
              <div className="flex flex-wrap gap-1.5">
                {KNOWN_PROVIDERS.filter(p => p.name !== "custom").map((p) => (
                  <button
                    type="button"
                    key={p.name}
                    onClick={() => {
                      setFormTemplate(p.name);
                      setFormName(p.name === "openai" ? "" : p.name);
                      setFormBase(p.defaultBase);
                    }}
                    className={`rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-all active:scale-95 ${formTemplate === p.name ? "border-black bg-black text-white" : "border-black/[0.08] bg-white text-black/55 hover:border-black/[0.18] hover:text-black"}`}
                  >{p.label}</button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="mb-1.5 block text-[11px] font-medium text-black/55">供应商名称</span>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} disabled={!!editingName} placeholder="例如：OpenAI、公司网关" className="w-full rounded-lg border border-black/[0.09] bg-black/[0.015] px-3 h-10 text-[13px] text-black outline-none placeholder:text-black/25 focus:border-black/30 focus:bg-white disabled:cursor-not-allowed disabled:opacity-45 transition-all" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-black/55">API Key</span>
              <div className="relative">
                <input type={showKey ? "text" : "password"} value={formKey} onChange={(e) => setFormKey(e.target.value)} placeholder="sk-..." className="w-full rounded-lg border border-black/[0.09] bg-black/[0.015] px-3 pr-10 h-10 font-mono text-[12px] text-black outline-none placeholder:text-black/25 focus:border-black/30 focus:bg-white transition-all" />
                <button type="button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md text-black/30 hover:bg-black/[0.05] hover:text-black/65 transition-colors">{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-black/55">API Base URL</span>
              <input value={formBase} onChange={(e) => setFormBase(e.target.value)} placeholder="https://api.openai.com/v1" className="w-full rounded-lg border border-black/[0.09] bg-black/[0.015] px-3 h-10 font-mono text-[12px] text-black outline-none placeholder:text-black/25 focus:border-black/30 focus:bg-white transition-all" />
            </label>
          </div>

          <div className="mt-4">
            <span className="mb-1.5 block text-[11px] font-medium text-black/55">API 协议</span>
            <div className="inline-flex flex-wrap gap-1 rounded-lg bg-black/[0.035] p-1">
              {API_PROTOCOLS.map((p) => (
                <button type="button" key={p.value} onClick={() => setFormProtocol(p.value)} className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-all ${formProtocol === p.value ? "bg-white text-black shadow-sm" : "text-black/45 hover:text-black/75"}`}>{p.label}</button>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/[0.06] text-[12px] font-semibold text-black/60">02</div>
              <div>
                <h3 className="text-[13px] font-semibold text-black">模型目录</h3>
                <p className="text-[11px] text-black/35">为每个模型设置能力和 token 限制</p>
              </div>
            </div>
            <button type="button" onClick={addModel} className="flex h-8 items-center gap-1.5 rounded-lg border border-black/[0.1] px-2.5 text-[11px] font-medium text-black/60 hover:border-black/25 hover:text-black active:scale-95 transition-all"><Plus size={13} />添加模型</button>
          </div>

          {formModels.length === 0 ? (
            <button type="button" onClick={addModel} className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-black/[0.1] bg-black/[0.012] py-9 text-center hover:border-black/25 hover:bg-black/[0.025] transition-all">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-black/[0.05]"><Plus size={16} className="text-black/45" /></div>
              <span className="text-[12px] font-medium text-black/55">添加第一个模型</span>
              <span className="mt-1 text-[11px] text-black/30">模型 ID 是发送请求时使用的唯一标识</span>
            </button>
          ) : (
            <div className="space-y-2.5">
              {formModels.map((model, index) => (
                <div key={index} className="rounded-xl border border-black/[0.08] bg-black/[0.012] p-3.5 hover:border-black/[0.16] transition-colors">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-black/[0.07] font-mono text-[10px] text-black/45">{String(index + 1).padStart(2, "0")}</span>
                      <span className="truncate text-[12px] font-semibold text-black/70">{model.name || model.id || "未命名模型"}</span>
                      {model.vision === true && <span className="shrink-0 rounded-full bg-blue-500/[0.09] px-2 py-0.5 text-[10px] font-medium text-blue-700/70">Vision</span>}
                    </div>
                    <button type="button" onClick={() => removeModel(index)} aria-label={`删除模型 ${index + 1}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-black/25 hover:bg-red-500/[0.08] hover:text-red-600/70 active:scale-95 transition-all"><Trash2 size={14} /></button>
                  </div>
                  <div className="grid gap-2.5 md:grid-cols-2">
                    <label className="block md:col-span-2"><span className="mb-1 block text-[10px] font-medium text-black/40">模型 ID <b className="font-normal text-red-500/70">*</b></span><input value={model.id} onChange={(e) => updateModel(index, "id", e.target.value)} placeholder="例如：gpt-4o" className="w-full rounded-lg border border-black/[0.09] bg-white px-3 h-9 font-mono text-[12px] text-black outline-none placeholder:text-black/25 focus:border-black/30 transition-all" /></label>
                    <label className="block"><span className="mb-1 block text-[10px] font-medium text-black/40">显示名称</span><input value={model.name || ""} onChange={(e) => updateModel(index, "name", e.target.value)} placeholder="可选，默认使用模型 ID" className="w-full rounded-lg border border-black/[0.09] bg-white px-3 h-9 text-[12px] text-black outline-none placeholder:text-black/25 focus:border-black/30 transition-all" /></label>
                    <label className="block"><span className="mb-1 block text-[10px] font-medium text-black/40">上下文窗口（tokens）</span><input type="text" inputMode="numeric" value={model.context_window == null ? "" : String(model.context_window)} onChange={(e) => { const v = e.target.value.trim(); if (!v) return updateModel(index, "context_window", null); if (/^\d+$/.test(v)) updateModel(index, "context_window", parseInt(v)); }} placeholder="例如：128000" className="w-full rounded-lg border border-black/[0.09] bg-white px-3 h-9 font-mono text-[12px] text-black outline-none placeholder:text-black/25 focus:border-black/30 transition-all" /></label>
                    <label className="block"><span className="mb-1 block text-[10px] font-medium text-black/40">最大输出（tokens）</span><input type="text" inputMode="numeric" value={model.max_output == null ? "" : String(model.max_output)} onChange={(e) => { const v = e.target.value.trim(); if (!v) return updateModel(index, "max_output", null); if (/^\d+$/.test(v)) updateModel(index, "max_output", parseInt(v)); }} placeholder="例如：8192" className="w-full rounded-lg border border-black/[0.09] bg-white px-3 h-9 font-mono text-[12px] text-black outline-none placeholder:text-black/25 focus:border-black/30 transition-all" /></label>
                    <label className={`flex min-h-9 items-center gap-2 rounded-lg border px-3 cursor-pointer select-none transition-all ${model.vision === true ? "border-blue-500/25 bg-blue-500/[0.05]" : "border-black/[0.09] bg-white hover:border-black/20"}`}><input type="checkbox" checked={model.vision === true} onChange={(e) => updateModel(index, "vision", e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" /><span className="text-[11px] font-medium text-black/60">支持图片识别</span><span className="ml-auto text-[10px] text-black/30">Vision</span></label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
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
        <div className="grid gap-3 lg:grid-cols-2">
          <GenerationModelPicker config={config!} onChange={setConfig} type="title_generation" title="标题生成模型" description="首条用户消息后异步生成会话标题" />
          <GenerationModelPicker config={config!} onChange={setConfig} type="compact_generation" title="上下文压缩模型" description="长上下文自动压缩时使用的模型" />
          <div className="space-y-2 lg:col-span-2">
            {providerNames.map((name) => {
              const p = providers[name];
              const modelCount = p.models?.length || 0;
              return (
                <div key={name} onClick={() => startEdit(name)} className="rounded-xl border border-black/[0.06] bg-white hover:border-black/[0.1] transition-colors cursor-pointer active:scale-[0.99]">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-black">{getProviderLabel(name)}</div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-black/40"><span className="font-mono">{maskKey(p.api_key)}</span>{modelCount > 0 && <span>{modelCount} 个模型</span>}</div>
                    </div>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(name); }} className="flex h-8 w-8 items-center justify-center rounded-lg text-black/20 hover:text-black/50 hover:bg-black/[0.04] active:scale-[0.96] transition-all"><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Generation Model Picker ─────────────────────────────────────────

type GenerationModelType = "title_generation" | "compact_generation";

function GenerationModelPicker({
  config,
  onChange,
  type,
  title,
  description,
}: {
  config: AiBaseConfig;
  onChange: (next: AiBaseConfig) => void;
  type: GenerationModelType;
  title: string;
  description: string;
}) {
  const providers = useMemo(() => buildProviderInfos(config.providers), [config.providers]);
  const selectedConfig = config.agents?.[type] || null;
  const selected = selectedConfig?.provider && selectedConfig?.model
    ? { provider: selectedConfig.provider, modelId: selectedConfig.model }
    : null;

  const currentLabel = (() => {
    if (!selected) return "沿用主对话模型";
    for (const provider of providers) {
      const model = provider.models.find((item) => item.id === selected.modelId);
      if (model && provider.name === selected.provider) return model.name || model.id;
    }
    return `${selected.provider} / ${selected.modelId}`;
  })();

  const persist = async (next: AiBaseConfig) => {
    try {
      await writeConfig(next);
      onChange(next);
    } catch {
      // 页面级保存错误由供应商编辑表单处理；选择器保持静默失败，避免打断设置页面。
    }
  };

  const handleSelectModel = async (providerName: string, modelId: string) => {
    const updated = JSON.parse(JSON.stringify(config)) as AiBaseConfig;
    if (!updated.agents) updated.agents = {};
    updated.agents[type] = { provider: providerName, model: modelId };
    await persist(updated);
  };

  const handleClear = async () => {
    const updated = JSON.parse(JSON.stringify(config)) as AiBaseConfig;
    if (updated.agents?.[type] !== undefined) delete updated.agents[type];
    await persist(updated);
  };

  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
      <div className="mb-3 flex min-w-0 items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-black/[0.05] text-black/50">
          {type === "title_generation" ? <span className="text-[14px]">T</span> : <span className="text-[13px]">↻</span>}
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold text-black">{title}</h3>
          <p className="mt-0.5 truncate text-[11px] text-black/35">{description}</p>
        </div>
      </div>
      <ModelPicker
        providers={providers}
        selected={selected}
        onSelect={handleSelectModel}
        placement="bottom"
        panelWidthClass="w-full min-w-[280px]"
        extraTopOption={{
          key: "fallback",
          label: "沿用主对话模型",
          selected: !selected,
          onSelect: handleClear,
        }}
        renderTrigger={({ open, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-black/[0.09] bg-black/[0.018] px-3 text-[12px] text-black hover:border-black/[0.2] hover:bg-white transition-all"
          >
            <span className="min-w-0 truncate text-left font-medium">{currentLabel}</span>
            <ChevronDown size={13} className={`shrink-0 text-black/30 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      />
    </section>
  );
}