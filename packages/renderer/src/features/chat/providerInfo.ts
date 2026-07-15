/**
 * 把 config.providers (raw dict) 转成 ModelPicker 需要的 ProviderInfo[]。
 * 仅保留 api_key + models 都齐的供应商。
 */

import type { ModelItem } from "@/services/api";
import type { ProviderInfo } from "./ModelPicker";

// Provider 名称到显示标签的映射
export const PROVIDER_LABELS: Record<string, string> = {
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

export function getProviderLabel(name: string): string {
    return PROVIDER_LABELS[name] || name;
}

export function buildProviderInfos(
    providersDict: Record<string, any> | null | undefined,
): ProviderInfo[] {
    if (!providersDict) return [];
    return Object.entries(providersDict)
        .filter(([_, cfg]: [string, any]) => {
            const hasApiKey = !!(cfg?.api_key || cfg?.apiKey);
            const hasModels = Array.isArray(cfg?.models) && cfg.models.length > 0;
            return hasApiKey && hasModels;
        })
        .map(([name, cfg]: [string, any]) => {
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
                        reasoning_effort_values: Array.isArray(m.reasoning_effort_values) ? m.reasoning_effort_values : undefined,
                    };
                },
            );
            return {
                name,
                label: getProviderLabel(name),
                models,
            };
        });
}
