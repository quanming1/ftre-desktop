/**
 * ModelSettings — 模型和供应商配置
 *
 * 层级结构：
 * 1. 供应商列表（主页面）
 * 2. 供应商详情（API Key、API Base、模型列表）
 */

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  ChevronLeft,
  Save,
  Eye,
  EyeOff,
  Cpu,
} from "lucide-react";
import {
  Button,
  Input,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@ftre/ui";
import { AI_BASE_CONFIG_PATH } from "@/lib/paths";

// ─── Types ──────────────────────────────────────────────────────────

interface ModelItem {
  name: string;
  id: string;
}

interface ProviderConfig {
  api_key?: string | null;
  api_base?: string | null;
  api_protocol?: string | null;
  models?: ModelItem[];
}

interface AiBaseConfig {
  agents?: { defaults?: { model?: string; provider?: string } };
  providers?: Record<string, ProviderConfig>;
  [key: string]: unknown;
}

// ─── Constants ──────────────────────────────────────────────────────

const API_PROTOCOLS: { value: string; label: string }[] = [
  { value: "", label: "自动（按模型名推断）" },
  { value: "openai", label: "OpenAI 兼容" },
  { value: "anthropic", label: "Anthropic" },
  { value: "azure", label: "Azure OpenAI" },
  { value: "bedrock", label: "AWS Bedrock" },
  { value: "gemini", label: "Gemini" },
];

const KNOWN_PROVIDERS: { name: string; label: string; defaultBase: string }[] =
  [
    { name: "custom", label: "自定义", defaultBase: "" },
    {
      name: "openai",
      label: "OpenAI",
      defaultBase: "https://api.openai.com/v1",
    },
    {
      name: "anthropic",
      label: "Anthropic",
      defaultBase: "https://api.anthropic.com",
    },
    {
      name: "deepseek",
      label: "DeepSeek",
      defaultBase: "https://api.deepseek.com",
    },
    {
      name: "moonshot",
      label: "Moonshot (Kimi)",
      defaultBase: "https://api.moonshot.ai/v1",
    },
    {
      name: "dashscope",
      label: "通义 (Qwen)",
      defaultBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    {
      name: "openrouter",
      label: "OpenRouter",
      defaultBase: "https://openrouter.ai/api/v1",
    },
    {
      name: "volcengine",
      label: "火山引擎",
      defaultBase: "https://ark.cn-beijing.volces.com/api/v3",
    },
    {
      name: "siliconflow",
      label: "硅基流动",
      defaultBase: "https://api.siliconflow.cn/v1",
    },
    {
      name: "minimax",
      label: "MiniMax",
      defaultBase: "https://api.minimax.io/v1",
    },
    {
      name: "gemini",
      label: "Gemini",
      defaultBase: "https://generativelanguage.googleapis.com/v1beta/openai/",
    },
    {
      name: "zhipu",
      label: "智谱",
      defaultBase: "https://open.bigmodel.cn/api/paas/v4",
    },
    {
      name: "qianfan",
      label: "百度千帆",
      defaultBase: "https://qianfan.baidubce.com/v2",
    },
    {
      name: "groq",
      label: "Groq",
      defaultBase: "https://api.groq.com/openai/v1",
    },
    {
      name: "mistral",
      label: "Mistral",
      defaultBase: "https://api.mistral.ai/v1",
    },
  ];

// ─── Helpers ────────────────────────────────────────────────────────

function maskKey(key: string | null | undefined): string {
  if (!key) return "";
  if (key.length <= 12) return "••••••••";
  return key.slice(0, 6) + "••••" + key.slice(-4);
}

async function readConfig(): Promise<AiBaseConfig> {
  try {
    const result = await window.desktop.fs.readFile(AI_BASE_CONFIG_PATH);
    const raw = typeof result === "string" ? result : result?.content || "";
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeConfig(config: AiBaseConfig): Promise<void> {
  await window.desktop.fs.writeFile(
    AI_BASE_CONFIG_PATH,
    JSON.stringify(config, null, 2),
  );
}

function getProviderLabel(name: string): string {
  const known = KNOWN_PROVIDERS.find((p) => p.name === name);
  return known?.label || name;
}

/**
 * 校验供应商名称
 * 只允许：中文、英文、数字、下划线
 */
function validateProviderName(name: string): {
  valid: boolean;
  error?: string;
} {
  if (!name.trim()) {
    return { valid: false, error: "请输入供应商名称" };
  }

  // 只允许中文、英文、数字、下划线
  const validPattern = /^[\u4e00-\u9fa5a-zA-Z0-9_]+$/;
  if (!validPattern.test(name.trim())) {
    return {
      valid: false,
      error: "供应商名称只能包含中文、英文、数字、下划线",
    };
  }

  return { valid: true };
}

// ─── Component ──────────────────────────────────────────────────────

type View = "list" | "edit";

export function ModelSettings() {
  const [config, setConfig] = useState<AiBaseConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>("list");
  const [editName, setEditName] = useState("");
  const [editOriginalName, setEditOriginalName] = useState<string | null>(null); // 编辑时的原始名称
  const [editKey, setEditKey] = useState("");
  const [editBase, setEditBase] = useState("");
  const [editProtocol, setEditProtocol] = useState("");
  const [editModels, setEditModels] = useState<ModelItem[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [isNew, setIsNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await readConfig();
      setConfig(cfg);
    } catch {
      setError("无法读取配置文件");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ─── Actions ────────────────────────────────────────────────────

  const handleEdit = (name: string) => {
    const p = config?.providers?.[name];
    setEditName(name);
    setEditOriginalName(name); // 记住原始名称，用于删除旧记录
    setEditKey(p?.api_key || "");
    setEditBase(p?.api_base || "");
    setEditProtocol(p?.api_protocol || "");
    // models 可能是字符串数组 ["model-id"] 或对象数组 [{name, id}]
    const rawModels = p?.models || [];
    const models: ModelItem[] = rawModels.map((m: string | ModelItem) => {
      if (typeof m === "string") {
        return { name: m, id: m };
      }
      return m as ModelItem;
    });
    setEditModels(models);
    setShowKey(false);
    setIsNew(false);
    setError(null);
    setView("edit");
  };

  const handleAdd = () => {
    setEditName("");
    setEditOriginalName(null);
    setEditKey("");
    setEditBase("");
    setEditProtocol("");
    setEditModels([]);
    setShowKey(false);
    setIsNew(true);
    setError(null);
    setView("edit");
  };

  const handleSave = async () => {
    // 校验供应商名称
    const validation = validateProviderName(editName);
    if (!validation.valid) {
      setError(validation.error || "名称无效");
      return;
    }
    if (!editKey.trim()) {
      setError("API Key 不能为空");
      return;
    }
    if (!config) return;

    setSaving(true);
    setError(null);
    try {
      const updated = { ...config };
      if (!updated.providers) updated.providers = {};

      // 过滤掉空的模型，并只保留 name 和 id 字段
      const validModels = editModels
        .filter((m) => m.name.trim() || m.id.trim())
        .map((m) => ({ name: m.name.trim(), id: m.id.trim() }));

      const providerName = editName.trim();

      // 如果是编辑且名称改变了，删除旧记录
      if (!isNew && editOriginalName && editOriginalName !== providerName) {
        delete updated.providers[editOriginalName];
      }

      updated.providers[providerName] = {
        api_key: editKey.trim(),
        api_base: editBase.trim() || null,
        api_protocol: editProtocol.trim() || null,
        models: validModels.length > 0 ? validModels : undefined,
      };

      await writeConfig(updated);
      setConfig(updated);
      setView("list");
    } catch {
      setError("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!config) return;
    const updated = { ...config };
    if (updated.providers) delete updated.providers[name];
    await writeConfig(updated);
    setConfig(updated);
  };

  // ─── Model List Actions ─────────────────────────────────────────

  const addModel = () => {
    setEditModels([...editModels, { name: "", id: "" }]);
  };

  const updateModel = (index: number, field: "name" | "id", value: string) => {
    const updated = [...editModels];
    updated[index] = { ...updated[index], [field]: value };
    setEditModels(updated);
  };

  const removeModel = (index: number) => {
    setEditModels(editModels.filter((_, i) => i !== index));
  };

  // ─── Edit View ──────────────────────────────────────────────

  if (view === "edit") {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <button
          onClick={() => {
            setView("list");
            setError(null);
          }}
          className="flex items-center gap-1.5 text-[13px] text-t-muted hover:text-t-primary transition-colors mb-6 self-start"
        >
          <ChevronLeft size={16} />
          返回
        </button>

        <h2 className="text-[18px] font-medium text-t-primary mb-1">
          {isNew ? "添加供应商" : getProviderLabel(editName)}
        </h2>
        <p className="text-[13px] text-t-muted mb-6">配置 API 连接和可用模型</p>

        {error && (
          <div className="mb-4 px-3 py-2 bg-red-500/10 text-red-400 text-[13px] rounded-md">
            {error}
          </div>
        )}

        <div className="space-y-5 flex-1 overflow-y-auto px-0.5">
          {/* Provider Name */}
          <div>
            <label className="block text-[12px] text-t-muted mb-1.5">
              供应商名称
            </label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="如：OpenAI、Anthropic、DeepSeek"
              disabled={!isNew}
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-[12px] text-t-muted mb-1.5">
              API Key
            </label>
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
            <label className="block text-[12px] text-t-muted mb-1.5">
              API Base URL
            </label>
            <Input
              value={editBase}
              onChange={(e) => setEditBase(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="font-mono"
            />
          </div>

          {/* API Protocol */}
          <div>
            <label className="block text-[12px] text-t-muted mb-1.5">
              API 协议
            </label>
            <select
              value={editProtocol}
              onChange={(e) => setEditProtocol(e.target.value)}
              className="w-full h-9 px-3 rounded-md bg-elevated border border-border text-[13px] text-t-primary focus:outline-none focus:border-accent appearance-none"
            >
              {API_PROTOCOLS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-t-ghost mt-1">
              自定义网关通常选择"OpenAI 兼容"
            </p>
          </div>

          {/* Models List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[12px] text-t-muted">模型列表</label>
              <button
                onClick={addModel}
                className="flex items-center gap-1 text-[12px] text-accent hover:text-accent/80 transition-colors"
              >
                <Plus size={14} />
                添加模型
              </button>
            </div>

            {editModels.length === 0 ? (
              <div className="text-[12px] text-t-ghost py-4 text-center border border-dashed border-border rounded-md">
                暂无模型，点击上方"添加模型"
              </div>
            ) : (
              <div className="space-y-2">
                {/* Header */}
                <div className="flex gap-2 text-[11px] text-t-ghost px-1">
                  <div className="flex-1">名称</div>
                  <div className="flex-1">模型 ID</div>
                  <div className="w-8"></div>
                </div>
                {/* Rows */}
                {editModels.map((model, index) => (
                  <div key={index} className="flex gap-2 items-center">
                    <Input
                      value={model.name}
                      onChange={(e) =>
                        updateModel(index, "name", e.target.value)
                      }
                      placeholder="如：GPT-4o"
                      className="flex-1 text-[13px]"
                    />
                    <Input
                      value={model.id}
                      onChange={(e) => updateModel(index, "id", e.target.value)}
                      placeholder="如：gpt-4o"
                      className="flex-1 text-[13px] font-mono"
                    />
                    <button
                      onClick={() => removeModel(index)}
                      className="w-8 h-8 flex items-center justify-center text-t-ghost hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-t-ghost mt-2">
              配置后可在聊天界面快速切换模型
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 pt-4 border-t border-border flex gap-3">
          <Button onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? "保存中..." : "保存"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setView("list");
              setError(null);
            }}
          >
            取消
          </Button>
        </div>
      </div>
    );
  }

  // ─── List View ──────────────────────────────────────────────────

  if (loading) {
    return <div className="text-[13px] text-t-ghost p-4">加载中...</div>;
  }

  const providers = config?.providers || {};
  const providerNames = Object.keys(providers);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[18px] font-medium text-t-primary">供应商配置</h1>
          <p className="text-[13px] text-t-muted mt-0.5">
            管理 AI 模型供应商和可用模型
          </p>
        </div>
        <Button size="sm" onClick={handleAdd}>
          <Plus size={14} />
          添加
        </Button>
      </div>

      {/* Provider List */}
      {providerNames.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-panel flex items-center justify-center mx-auto mb-3">
              <Cpu size={20} className="text-t-ghost" />
            </div>
            <p className="text-[14px] text-t-muted mb-1">暂无供应商</p>
            <p className="text-[12px] text-t-ghost">点击上方"添加"按钮配置</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {providerNames.map((name) => {
            const p = providers[name];
            const modelCount = p.models?.length || 0;

            return (
              <div
                key={name}
                className="flex items-center justify-between p-3 rounded-lg border border-border bg-elevated/50 hover:bg-elevated transition-colors cursor-pointer group"
                onClick={() => handleEdit(name)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-t-primary">
                    {getProviderLabel(name)}
                  </div>
                  <div className="text-[12px] text-t-muted mt-0.5 flex items-center gap-3">
                    <span className="font-mono">{maskKey(p.api_key)}</span>
                    {modelCount > 0 && <span>{modelCount} 个模型</span>}
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-t-ghost hover:text-red-400"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>删除供应商</AlertDialogTitle>
                        <AlertDialogDescription>
                          确定要删除 {getProviderLabel(name)}{" "}
                          吗？此操作无法撤销。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(name)}>
                          删除
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
