/**
 * ModelSelector — 模型选择器
 *
 * 通过后端 /api/config 读取已配置的 providers 和 models 列表
 * 用户可以选择 provider 下的具体模型
 */

import { useState, useEffect, useRef, memo, useCallback } from "react";
import { Check, ChevronDown, Search, Settings2, ImageIcon } from "lucide-react";
import { fetchAppConfig, saveAppConfig } from "@/services/api";
import { useChat } from "@/stores/chat";
import { OPEN_SETTINGS_EVENT } from "@/app/ActivityBar";

interface ModelItem {
  name: string;
  id: string;
  /** 上下文窗口大小（token 数） */
  context_window?: number | null;
  /** 是否支持视觉输入（图片） */
  vision?: boolean;
}

interface ProviderInfo {
  name: string;
  label: string;
  models: ModelItem[];
}

// Provider 名称到显示标签的映射
const PROVIDER_LABELS: Record<string, string> = {
  custom: "自定义",
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  dashscope: "通义千问",
  gemini: "Gemini",
  moonshot: "Moonshot",
  zhipu: "智谱",
  openrouter: "OpenRouter",
  groq: "Groq",
  ollama: "Ollama",
  volcengine: "火山引擎",
  siliconflow: "硅基流动",
  qianfan: "百度千帆",
  minimax: "MiniMax",
  mistral: "Mistral",
  huggingface: "Hugging Face",
  aihubmix: "AiHubMix",
  bedrock: "AWS Bedrock",
  azure_openai: "Azure OpenAI",
};

interface ConfigData {
  currentModel: string;
  currentProvider: string;
  providers: ProviderInfo[];
}

async function readConfig(): Promise<ConfigData> {
  const config = await fetchAppConfig();
  if (!config || Object.keys(config).length === 0) {
    return { currentModel: "", currentProvider: "auto", providers: [] };
  }

  const currentModel = config.agents?.defaults?.model || "";
  const currentProvider = config.agents?.defaults?.provider || "auto";

  // 解析 providers，只显示有 api_key 且有 models 的
  const providersObj = config.providers || {};
  const providers: ProviderInfo[] = Object.entries(providersObj)
    .filter(([_, cfg]: [string, any]) => {
      const hasApiKey = !!(cfg?.api_key || cfg?.apiKey);
      const hasModels = Array.isArray(cfg?.models) && cfg.models.length > 0;
      return hasApiKey && hasModels;
    })
    .map(([name, cfg]: [string, any]) => {
      // models 可能是字符串数组 ["model-id"] 或对象数组 [{name, id, context_window?, vision?, ...}]
      const rawModels = cfg.models || [];
      const models: ModelItem[] = rawModels.map(
        (m: string | Record<string, any>) => {
          if (typeof m === "string") {
            return { name: m, id: m };
          }
          return {
            name: m.name ?? m.id ?? "",
            id: m.id ?? m.name ?? "",
            context_window:
              typeof m.context_window === "number" ? m.context_window : null,
            vision: !!m.vision,
          };
        },
      );
      return {
        name,
        label: PROVIDER_LABELS[name] || name,
        models,
      };
    });

  return { currentModel, currentProvider, providers };
}

async function writeModelToConfig(
  model: string,
  provider: string,
): Promise<void> {
  const config = await fetchAppConfig();

  if (!config.agents) config.agents = { defaults: {} };
  if (!config.agents.defaults) config.agents.defaults = {};
  config.agents.defaults.model = model;
  config.agents.defaults.provider = provider;

  const ok = await saveAppConfig(config);
  if (!ok) {
    console.error("[ModelSelector] Failed to write config");
  }
}

/** 把 token 数压缩成紧凑文字：128000 → "128K"，1500000 → "1.5M" */
function formatContext(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + "M";
  }
  if (n >= 1000) {
    const v = n / 1000;
    return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + "K";
  }
  return String(n);
}

/**
 * 模型能力的迷你徽章组（出现在模型名右侧）。
 * - 上下文窗口：纯文字（如 `128K`）
 * - 视觉支持：极小图片图标
 * 没有任一字段时整体不渲染。
 */
function ModelBadges({
  contextWindow,
  vision,
}: {
  contextWindow?: number | null;
  vision?: boolean;
}) {
  const showCtx = typeof contextWindow === "number" && contextWindow > 0;
  if (!showCtx && !vision) return null;
  return (
    <span className="flex items-center gap-1 shrink-0 text-t-ghost">
      {showCtx && (
        <span
          title={`上下文 ${contextWindow!.toLocaleString()} tokens`}
          className="px-1 h-[14px] inline-flex items-center text-[9.5px] font-mono leading-none rounded bg-hover/60 tracking-tight"
        >
          {formatContext(contextWindow!)}
        </span>
      )}
      {vision && (
        <span
          title="支持图片输入"
          className="w-[14px] h-[14px] inline-flex items-center justify-center rounded bg-hover/60"
        >
          <ImageIcon size={9} strokeWidth={2} />
        </span>
      )}
    </span>
  );
}

export const ModelSelector = memo(function ModelSelector() {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [search, setSearch] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 从 store 读取当前选中的 model 和 provider
  const currentModel = useChat((s) => s.model) || "";
  const currentProvider = useChat((s) => s.provider) || "auto";
  const setModel = useChat((s) => s.setModel);
  const setProvider = useChat((s) => s.setProvider);

  const loadConfig = useCallback(async () => {
    const data = await readConfig();
    setProviders(data.providers);
    // 同步配置文件中的默认模型到 store
    if (data.currentModel) {
      setModel(data.currentModel);
    }
    if (data.currentProvider) {
      setProvider(data.currentProvider);
    }
  }, [setModel, setProvider]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (open) {
      loadConfig();
      setSearch("");
      // 延迟聚焦，等待 DOM 渲染
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [open, loadConfig]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelectModel = async (modelId: string, providerName: string) => {
    // 更新 store
    setModel(modelId);
    setProvider(providerName);
    setOpen(false);
    // 写入配置文件持久化
    await writeModelToConfig(modelId, providerName);
  };

  const openModelSettings = useCallback(() => {
    setOpen(false);
    window.dispatchEvent(
      new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { section: "models" } }),
    );
  }, []);

  // 获取当前模型的显示名称
  const getDisplayName = () => {
    if (!currentModel) return "选择模型";

    // 在所有 providers 中找到当前模型的名称
    for (const provider of providers) {
      const model = provider.models.find((m) => m.id === currentModel);
      if (model) {
        return model.name || model.id;
      }
    }

    // 如果找不到，直接显示 model id
    if (currentModel.length > 24) {
      return currentModel.slice(0, 22) + "…";
    }
    return currentModel;
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[13px] h-9 px-3 rounded-md font-mono transition-colors duration-150 text-t-muted hover:text-t-primary hover:bg-hover"
      >
        <span className="truncate max-w-[200px]">{getDisplayName()}</span>
        <ChevronDown size={12} className="shrink-0 opacity-60" />
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-1 w-[280px] bg-elevated border border-border-subtle rounded-xl overflow-hidden flex flex-col shadow-2xl z-[100]"
          style={{ animation: "fadeIn 0.1s ease-out" }}
        >
          {/* 搜索框 */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-t-ghost"
              />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索模型..."
                className="w-full h-8 pl-8 pr-3 text-[13px] bg-base border border-border rounded-md text-t-primary placeholder:text-t-ghost outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          {providers.length === 0 ? (
            <div className="px-4 py-6 flex flex-col items-center gap-2">
              <div className="text-center text-[13px] text-t-muted">
                未找到已配置的模型
              </div>
              <button
                onClick={openModelSettings}
                className="mt-1 inline-flex items-center gap-1.5 px-3 h-8 rounded-md bg-accent/10 text-accent text-[12px] hover:bg-accent/15 transition-colors"
              >
                <Settings2 size={13} />
                打开设置配置模型
              </button>
            </div>
          ) : (
            <div className="max-h-[340px] overflow-y-auto py-1">
              {providers
                .map((provider) => {
                  // 过滤模型
                  const filteredModels = provider.models.filter((model) => {
                    if (!search.trim()) return true;
                    const q = search.toLowerCase();
                    return (
                      model.name.toLowerCase().includes(q) ||
                      model.id.toLowerCase().includes(q)
                    );
                  });
                  if (filteredModels.length === 0) return null;
                  return (
                    <div key={provider.name}>
                      {/* Provider 名称 */}
                      <div className="px-3 pt-3 pb-1 text-[11px] text-t-ghost uppercase tracking-wider font-medium">
                        {provider.label}
                      </div>
                      {/* 模型列表 */}
                      {filteredModels.map((model) => {
                        const isSelected =
                          model.id === currentModel &&
                          provider.name === currentProvider;
                        return (
                          <button
                            key={`${provider.name}-${model.id}`}
                            onClick={() =>
                              handleSelectModel(model.id, provider.name)
                            }
                            className={`w-full px-3 py-1.5 text-left text-[13px] flex items-center gap-2 transition-colors ${
                              isSelected
                                ? "text-accent bg-accent/10"
                                : "text-t-secondary hover:text-t-primary hover:bg-hover"
                            }`}
                          >
                            <span className="truncate flex-1 min-w-0">
                              {model.name || model.id}
                            </span>
                            <ModelBadges
                              contextWindow={model.context_window}
                              vision={model.vision}
                            />
                            {isSelected && (
                              <Check size={14} className="shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })
                .filter(Boolean)}
            </div>
          )}

          {/* 底部：一键打开设置管理模型列表（providers 非空时常驻显示） */}
          {providers.length > 0 && (
            <div className="border-t border-border-subtle">
              <button
                onClick={openModelSettings}
                className="w-full flex items-center gap-2 px-3 h-9 text-[12.5px] text-t-muted hover:text-t-primary hover:bg-hover transition-colors"
                title="打开设置 → 模型，编辑供应商与模型列表"
              >
                <Settings2 size={13} className="shrink-0 opacity-70" />
                <span className="truncate">管理模型…</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
