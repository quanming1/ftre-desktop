/**
 * ModelSettings — Manage AI model and provider configuration.
 *
 * Reads/writes ~/.ai-base/config.json directly via Electron IPC.
 * Only touches `agents.defaults` and `providers` sections.
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, ChevronLeft, Save, Eye, EyeOff, Check } from "lucide-react";
import {
  Button,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
  Tooltip,
} from "@ftre/ui";

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
  [key: string]: unknown;
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
  if (!key) return "未配置";
  if (key.length <= 12) return "••••••••";
  return key.slice(0, 8) + "••••" + key.slice(-4);
}

async function readConfig(): Promise<AiBaseConfig> {
  try {
    const raw = await window.desktop.fs.readFile(CONFIG_PATH);
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeConfig(config: AiBaseConfig): Promise<void> {
  await window.desktop.fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ─── Sub-components ─────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[14px] font-medium text-t-primary mb-4">{children}</h2>;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[12px] text-t-ghost uppercase tracking-wider mb-2">
      {children}
    </label>
  );
}

function StatusBadge({ text, variant }: { text: string; variant: "success" | "error" }) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] ${
        variant === "success"
          ? "bg-green-500/10 text-green-500"
          : "bg-red-500/10 text-[#f85149]"
      }`}
    >
      {variant === "success" && <Check size={12} />}
      {text}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────

type View = "main" | "edit-provider";

export function ModelSettings() {
  const [config, setConfig] = useState<AiBaseConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");

  const [view, setView] = useState<View>("main");
  const [editName, setEditName] = useState("");
  const [editKey, setEditKey] = useState("");
  const [editBase, setEditBase] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isNewProvider, setIsNewProvider] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await readConfig();
      setConfig(cfg);
      setModel(cfg.agents?.defaults?.model || "");
      setProvider(cfg.agents?.defaults?.provider || "auto");
    } catch {
      setError("无法读取配置文件");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ─── Actions ────────────────────────────────────────────────────

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

  const handleEditProvider = (name: string) => {
    const p = config?.providers?.[name];
    setEditName(name);
    setEditKey(p?.api_key || "");
    setEditBase(p?.api_base || "");
    setShowKey(false);
    setIsNewProvider(false);
    setError(null);
    setView("edit-provider");
  };

  const handleAddProvider = () => {
    setEditName("");
    setEditKey("");
    setEditBase("");
    setShowKey(false);
    setIsNewProvider(true);
    setError(null);
    setView("edit-provider");
  };

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

  const handleDeleteProvider = async (name: string) => {
    if (!config) return;
    const updated = { ...config };
    if (updated.providers) delete updated.providers[name];
    await writeConfig(updated);
    setConfig(updated);
  };

  // ─── Provider Edit View ─────────────────────────────────────────

  if (view === "edit-provider") {
    const knownProvider = KNOWN_PROVIDERS.find((p) => p.name === editName);
    return (
      <div className="h-full flex flex-col">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setView("main"); setError(null); }}
          className="self-start mb-6 -ml-2 text-t-dim"
        >
          <ChevronLeft size={14} />
          返回
        </Button>

        <h2 className="text-[20px] font-light text-t-primary mb-1">
          {isNewProvider ? "添加 Provider" : `编辑 ${knownProvider?.label || editName}`}
        </h2>
        <p className="text-[13px] text-t-dim mb-8">配置 API 连接信息</p>

        {error && <StatusBadge text={error} variant="error" />}

        <div className="space-y-6 flex-1 mt-4">
          {/* Provider name */}
          <div>
            <FieldLabel>Provider</FieldLabel>
            {isNewProvider ? (
              <Select value={editName} onValueChange={(val) => {
                setEditName(val);
                const known = KNOWN_PROVIDERS.find((p) => p.name === val);
                if (known && !editBase) setEditBase(known.defaultBase);
              }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择 Provider..." />
                </SelectTrigger>
                <SelectContent>
                  {KNOWN_PROVIDERS.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="text-[14px] text-t-primary font-medium py-2">
                {knownProvider ? knownProvider.label : editName}
                <span className="text-t-ghost text-[12px] ml-2 font-normal">({editName})</span>
              </div>
            )}
          </div>

          {/* API Key */}
          <div>
            <FieldLabel>API Key</FieldLabel>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={editKey}
                onChange={(e) => setEditKey(e.target.value)}
                placeholder="sk-..."
                className="pr-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-t-ghost hover:text-t-secondary transition-colors"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* API Base */}
          <div>
            <FieldLabel>API Base URL</FieldLabel>
            <Input
              value={editBase}
              onChange={(e) => setEditBase(e.target.value)}
              placeholder={knownProvider?.defaultBase || "https://api.example.com/v1"}
              className="font-mono"
            />
            {knownProvider && knownProvider.defaultBase && (
              <p className="text-[11px] text-t-ghost mt-1.5">
                留空使用默认：{knownProvider.defaultBase}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-8 pt-4 border-t border-border flex gap-3">
          <Button onClick={handleSaveProvider} disabled={saving}>
            <Save size={14} />
            {saving ? "保存中..." : "保存"}
          </Button>
          <Button variant="ghost" onClick={() => { setView("main"); setError(null); }}>
            取消
          </Button>
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
        <h1 className="text-[20px] font-light text-t-primary mb-1">模型配置</h1>
        <p className="text-[13px] text-t-dim">
          管理 AI 模型和 Provider，修改后下次对话自动生效
        </p>
      </div>

      {error && <div className="mb-4"><StatusBadge text={error} variant="error" /></div>}
      {success && <div className="mb-4"><StatusBadge text={success} variant="success" /></div>}

      {/* ── Current Model ── */}
      <section className="mb-10 p-5 rounded-lg border border-border bg-elevated/50">
        <SectionTitle>当前模型</SectionTitle>
        <div className="space-y-4">
          <div>
            <FieldLabel>模型名称</FieldLabel>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. gpt-4o, claude-opus-4-5, mlamp/kimi-k2.6"
              className="font-mono"
            />
          </div>

          <div>
            <FieldLabel>Provider</FieldLabel>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto（按模型名自动匹配）</SelectItem>
                {providerNames.map((name) => {
                  const known = KNOWN_PROVIDERS.find((p) => p.name === name);
                  return (
                    <SelectItem key={name} value={name}>
                      {known ? `${known.label} (${name})` : name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleSaveDefaults} disabled={saving} className="mt-2">
            <Save size={14} />
            {saving ? "保存中..." : "保存模型设置"}
          </Button>
        </div>
      </section>

      {/* ── Providers ── */}
      <section className="flex-1">
        <div className="flex items-center justify-between mb-4">
          <SectionTitle>Providers</SectionTitle>
          <Button variant="ghost" size="sm" onClick={handleAddProvider}>
            <Plus size={14} />
            添加
          </Button>
        </div>

        {providerNames.length === 0 ? (
          <div className="text-center py-12 text-t-muted">
            <p className="text-[13px] mb-4">暂无 Provider 配置</p>
            <Button variant="outline" onClick={handleAddProvider}>
              <Plus size={14} />
              添加第一个 Provider
            </Button>
          </div>
        ) : (
          <div className="space-y-1 rounded-lg border border-border overflow-hidden">
            {providerNames.map((name) => {
              const p = providers[name];
              const known = KNOWN_PROVIDERS.find((k) => k.name === name);
              const isActive = provider === name;
              return (
                <div
                  key={name}
                  className={`group flex items-center justify-between py-3 px-4 cursor-pointer transition-colors hover:bg-white/[0.03] ${
                    isActive ? "bg-neon/[0.04] border-l-2 border-l-neon" : ""
                  }`}
                  onClick={() => handleEditProvider(name)}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-t-primary group-hover:text-neon transition-colors font-medium">
                        {known ? known.label : name}
                      </span>
                      {isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon/15 text-neon font-medium">
                          当前
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-t-ghost mt-0.5 truncate max-w-[350px] font-mono">
                      {maskKey(p.api_key)} • {p.api_base || (known?.defaultBase || "默认地址")}
                    </div>
                  </div>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 opacity-0 group-hover:opacity-100 text-t-ghost hover:text-[#f85149] transition-all rounded"
                      >
                        <Trash2 size={13} />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>删除 Provider</AlertDialogTitle>
                        <AlertDialogDescription>
                          确定删除 "{known?.label || name}"？此操作不可撤销。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeleteProvider(name)}>
                          删除
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
