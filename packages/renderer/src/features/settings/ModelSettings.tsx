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
  Switch,
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
import { fetchAppConfig, saveAppConfig, type ModelItem } from "@/services/api";

// ─── Types ──────────────────────────────────────────────────────────

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
  return (await fetchAppConfig()) as AiBaseConfig;
}

async function writeConfig(config: AiBaseConfig): Promise<void> {
  const ok = await saveAppConfig(config as Record<string, any>);
  if (!ok) {
    throw new Error("保存配置失败");
  }
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
    // models 兼容：旧格式（字符串 / {name,id}）+ 新格式（带 context_window/max_output/vision）
    const rawModels = p?.models || [];
    const models: ModelItem[] = rawModels.map((m: string | Record<string, any>) => {
      if (typeof m === "string") {
        return { name: m, id: m };
      }
      return {
        name: m.name ?? "",
        id: m.id ?? "",
        context_window:
          typeof m.context_window === "number" ? m.context_window : null,
        max_output:
          typeof m.max_output === "number" ? m.max_output : null,
        vision: !!m.vision,
      };
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
    if (!editBase.trim()) {
      setError("API Base URL 不能为空");
      return;
    }
    if (!editProtocol.trim()) {
      setError("请选择 API 协议");
      return;
    }
    if (!config) return;

    setSaving(true);
    setError(null);
    try {
      const updated = { ...config };
      if (!updated.providers) updated.providers = {};

      // 至少一个模型
      if (editModels.length === 0) {
        setError("至少需要配置一个模型");
        setSaving(false);
        return;
      }

      // 模型字段全量必填校验，定位到具体行
      const validModels: Record<string, any>[] = [];
      for (let i = 0; i < editModels.length; i++) {
        const m = editModels[i];
        const label = m.name.trim() || m.id.trim() || `模型 ${i + 1}`;

        if (!m.name.trim()) {
          setError(`「${label}」需要填写名称`);
          setSaving(false);
          return;
        }
        if (!m.id.trim()) {
          setError(`「${label}」需要填写模型 ID`);
          setSaving(false);
          return;
        }
        if (
          typeof m.context_window !== "number" ||
          !Number.isFinite(m.context_window) ||
          m.context_window <= 0
        ) {
          setError(`「${label}」需要填写上下文 (token)`);
          setSaving(false);
          return;
        }
        if (
          typeof m.max_output !== "number" ||
          !Number.isFinite(m.max_output) ||
          m.max_output <= 0
        ) {
          setError(`「${label}」需要填写最大输出 (token)`);
          setSaving(false);
          return;
        }

        validModels.push({
          name: m.name.trim(),
          id: m.id.trim(),
          context_window: m.context_window,
          max_output: m.max_output,
          vision: !!m.vision,
        });
      }

      const providerName = editName.trim();

      // 改名/新建时检查与其他 provider 是否重名
      const existingNames = Object.keys(updated.providers);
      const collidesWith =
        isNew || providerName !== editOriginalName
          ? existingNames.find(
              (n) => n === providerName && n !== editOriginalName,
            )
          : undefined;
      if (collidesWith) {
        setError(`已存在同名供应商: ${collidesWith}`);
        setSaving(false);
        return;
      }

      // 如果是编辑且名称改变了，删除旧记录
      if (!isNew && editOriginalName && editOriginalName !== providerName) {
        delete updated.providers[editOriginalName];
      }

      updated.providers[providerName] = {
        api_key: editKey.trim(),
        api_base: editBase.trim(),
        api_protocol: editProtocol.trim(),
        models: validModels,
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
    setEditModels([
      ...editModels,
      { name: "", id: "", context_window: null, max_output: null, vision: false },
    ]);
  };

  const updateModel = <K extends keyof ModelItem>(
    index: number,
    field: K,
    value: ModelItem[K],
  ) => {
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
          className="flex items-center gap-1 text-[12px] text-t-muted hover:text-t-primary transition-colors mb-5 self-start"
        >
          <ChevronLeft size={14} />
          返回
        </button>

        <h2 className="text-[16px] font-medium text-t-primary mb-0.5">
          {isNew ? "添加供应商" : getProviderLabel(editName)}
        </h2>
        <p className="text-[12px] text-t-muted mb-5">配置 API 连接和可用模型</p>

        {error && (
          <div className="mb-4 px-3 py-2 bg-red-500/[0.08] border border-red-500/20 text-red-400/90 text-[12px] rounded-md">
            {error}
          </div>
        )}

        <div className="space-y-4 flex-1 overflow-y-auto px-0.5">
          {/* Provider Name */}
          <div>
            <label className="block text-[11px] text-t-muted mb-1.5">
              供应商名称
              <span className="text-red-400 ml-0.5">*</span>
            </label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="如：OpenAI、Anthropic、DeepSeek"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-[11px] text-t-muted mb-1.5">
              API Key
              <span className="text-red-400 ml-0.5">*</span>
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
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>

          {/* API Base */}
          <div>
            <label className="block text-[11px] text-t-muted mb-1.5">
              API Base URL
              <span className="text-red-400 ml-0.5">*</span>
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
            <label className="block text-[11px] text-t-muted mb-1.5">
              API 协议
              <span className="text-red-400 ml-0.5">*</span>
            </label>
            <select
              value={editProtocol}
              onChange={(e) => setEditProtocol(e.target.value)}
              className="w-full h-8 px-3 rounded-md bg-elevated border border-border text-[13px] text-t-primary focus:outline-none focus:border-accent appearance-none"
            >
              <option value="" disabled>
                请选择
              </option>
              {API_PROTOCOLS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-[10.5px] text-t-ghost mt-1">
              自定义网关通常选择"OpenAI 兼容"
            </p>
          </div>

          {/* Models List */}
          <div className="pt-1">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[11px] text-t-muted">
                模型列表
                <span className="text-red-400 ml-0.5">*</span>
              </label>
              <button
                onClick={addModel}
                className="flex items-center gap-1 text-[11px] text-accent hover:text-accent/80 transition-colors"
              >
                <Plus size={12} />
                添加模型
              </button>
            </div>

            {editModels.length === 0 ? (
              <div className="text-[11.5px] text-t-ghost py-5 text-center border border-dashed border-border-subtle rounded-md">
                至少需要一个模型，点击右上角"添加模型"
              </div>
            ) : (
              <div className="space-y-2.5">
                {editModels.map((model, index) => (
                  <div
                    key={index}
                    className="rounded-md border border-border-subtle bg-elevated/30 p-3 space-y-2.5"
                  >
                    {/* 顶部：标题 + 删除 */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10.5px] text-t-ghost uppercase tracking-wide">
                        模型 {index + 1}
                      </span>
                      <button
                        onClick={() => removeModel(index)}
                        title="移除"
                        className="w-6 h-6 flex items-center justify-center text-t-ghost hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {/* 名称 */}
                    <div>
                      <label className="block text-[10.5px] text-t-muted mb-1">
                        名称
                        <span className="text-red-400 ml-0.5">*</span>
                      </label>
                      <Input
                        value={model.name}
                        onChange={(e) =>
                          updateModel(index, "name", e.target.value)
                        }
                        placeholder="如：GPT-4o"
                        className="text-[13px]"
                      />
                    </div>

                    {/* 模型 ID */}
                    <div>
                      <label className="block text-[10.5px] text-t-muted mb-1">
                        模型 ID
                        <span className="text-red-400 ml-0.5">*</span>
                      </label>
                      <Input
                        value={model.id}
                        onChange={(e) =>
                          updateModel(index, "id", e.target.value)
                        }
                        placeholder="如：gpt-4o"
                        className="text-[13px] font-mono"
                      />
                    </div>

                    {/* 上下文 + 最大输出（两列） */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[10.5px] text-t-muted mb-1">
                          上下文 (token)
                          <span className="text-red-400 ml-0.5">*</span>
                        </label>
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={
                            model.context_window == null
                              ? ""
                              : String(model.context_window)
                          }
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (!raw)
                              return updateModel(
                                index,
                                "context_window",
                                null,
                              );
                            if (!/^\d+$/.test(raw)) return;
                            updateModel(
                              index,
                              "context_window",
                              parseInt(raw, 10),
                            );
                          }}
                          placeholder="必填，如 128000"
                          className="text-[13px] font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10.5px] text-t-muted mb-1">
                          最大输出 (token)
                          <span className="text-red-400 ml-0.5">*</span>
                        </label>
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={
                            model.max_output == null
                              ? ""
                              : String(model.max_output)
                          }
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (!raw)
                              return updateModel(index, "max_output", null);
                            if (!/^\d+$/.test(raw)) return;
                            updateModel(
                              index,
                              "max_output",
                              parseInt(raw, 10),
                            );
                          }}
                          placeholder="必填，如 8192"
                          className="text-[13px] font-mono"
                        />
                      </div>
                    </div>

                    {/* 支持图片 */}
                    <div className="flex items-center justify-between pt-2 mt-1 border-t border-border-subtle/60">
                      <div>
                        <div className="text-[12px] text-t-secondary leading-tight">
                          支持图片输入
                        </div>
                        <div className="text-[10.5px] text-t-ghost mt-0.5 leading-tight">
                          开启后可在聊天发送图片附件
                        </div>
                      </div>
                      <Switch
                        size="sm"
                        checked={!!model.vision}
                        onCheckedChange={(v) =>
                          updateModel(index, "vision", v)
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10.5px] text-t-ghost mt-2">
              配置后可在聊天界面快速切换模型
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-5 pt-4 border-t border-border-subtle flex gap-2.5">
          <Button onClick={handleSave} disabled={saving}>
            <Save size={13} />
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
    return <div className="text-[12px] text-t-ghost p-4">加载中...</div>;
  }

  const providers = config?.providers || {};
  const providerNames = Object.keys(providers);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[16px] font-medium text-t-primary">供应商配置</h1>
          <p className="text-[12px] text-t-muted mt-0.5">
            管理 AI 模型供应商和可用模型
          </p>
        </div>
        <Button size="sm" onClick={handleAdd}>
          <Plus size={13} />
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
