/**
 * ModelSelector — 聊天输入栏的主模型切换胶囊
 *
 * 通过后端 /api/config 读取已配置的 providers/models
 * 真正的下拉面板由 ModelPicker 提供，本组件只管：
 *   - 触发按钮的样式（紧凑胶囊，显示当前模型名）
 *   - 把当前选择写到 chat store 和 config.json 的 agents.defaults
 */

import { useState, useEffect, memo, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { fetchAppConfig, saveAppConfig } from "@/services/api";
import { useChat } from "@/stores/chat";
import { OPEN_SETTINGS_EVENT } from "@/app/ActivityBar";
import { ModelPicker, type ProviderInfo } from "./ModelPicker";
import { buildProviderInfos } from "./providerInfo";

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
  return {
    currentModel: config.agents?.defaults?.model || "",
    currentProvider: config.agents?.defaults?.provider || "auto",
    providers: buildProviderInfos(config.providers),
  };
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

export const ModelSelector = memo(function ModelSelector() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  // 从 store 读取当前选中的 model 和 provider
  const currentModel = useChat((s) => s.model) || "";
  const currentProvider = useChat((s) => s.provider) || "auto";
  const setModel = useChat((s) => s.setModel);
  const setProvider = useChat((s) => s.setProvider);
  const setContextWindow = useChat((s) => s.setContextWindow);

  /** 在 providers 中找到 (provider, modelId) 对应的 context_window；找不到回 null */
  const findContextWindow = useCallback(
    (
      providerName: string,
      modelId: string,
      list: ProviderInfo[],
    ): number | null => {
      const p = list.find((x) => x.name === providerName);
      const m = p?.models.find((mm) => mm.id === modelId);
      return typeof m?.context_window === "number" ? m.context_window : null;
    },
    [],
  );

  const loadConfig = useCallback(async () => {
    const data = await readConfig();
    setProviders(data.providers);
    if (data.currentModel) setModel(data.currentModel);
    if (data.currentProvider) setProvider(data.currentProvider);
    if (data.currentModel && data.currentProvider) {
      setContextWindow(
        findContextWindow(
          data.currentProvider,
          data.currentModel,
          data.providers,
        ),
      );
    }
  }, [setModel, setProvider, setContextWindow, findContextWindow]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSelectModel = async (
    providerName: string,
    modelId: string,
  ) => {
    setModel(modelId);
    setProvider(providerName);
    setContextWindow(findContextWindow(providerName, modelId, providers));
    await writeModelToConfig(modelId, providerName);
  };

  const openModelSettings = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { section: "models" } }),
    );
  }, []);

  // 获取当前模型的显示名称
  const getDisplayName = () => {
    if (!currentModel) return "选择模型";
    for (const provider of providers) {
      const model = provider.models.find((m) => m.id === currentModel);
      if (model) return model.name || model.id;
    }
    if (currentModel.length > 24) return currentModel.slice(0, 22) + "…";
    return currentModel;
  };

  return (
    <ModelPicker
      providers={providers}
      selected={
        currentModel && currentProvider !== "auto"
          ? { provider: currentProvider, modelId: currentModel }
          : null
      }
      onSelect={handleSelectModel}
      onOpenSettings={openModelSettings}
      placement="top"
      panelWidthClass="w-[280px]"
      renderTrigger={({ open, toggle }) => (
        <button
          onClick={() => {
            if (!open) void loadConfig();
            toggle();
          }}
          className="flex items-center gap-1.5 text-[13px] h-9 px-3 rounded-md font-mono transition-colors duration-150 text-t-muted hover:text-t-primary hover:bg-hover"
        >
          <span className="truncate max-w-[200px]">{getDisplayName()}</span>
          <ChevronDown size={12} className="shrink-0 opacity-60" />
        </button>
      )}
    />
  );
});
