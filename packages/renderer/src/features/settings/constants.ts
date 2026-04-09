import type { SelectOption } from "@ftre/ui";

// ==================== Model Provider Types ====================

export interface ModelConfig {
  model_id: string;
  parallel_tool_calls: boolean;
  vision: boolean;
  max_context_length: number;
}

export interface ProviderConfig {
  api_key: string;
  base_url: string;
  models: Record<string, ModelConfig>; // key = 显示名
}

export type ProvidersConfig = Record<string, ProviderConfig>; // key = provider 名

// ==================== Mock Data ====================

export const INITIAL_PROVIDERS: ProvidersConfig = {
  dashscope: {
    api_key: "sk-1cdcb7b0e7fb40d49bd6b66b8666022e",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: {
      "qwen3-max": {
        model_id: "qwen3-max-2026-01-23",
        parallel_tool_calls: true,
        vision: false,
        max_context_length: 128000,
      },
      "kimi-k2.5": {
        model_id: "kimi-k2.5",
        parallel_tool_calls: true,
        vision: false,
        max_context_length: 128000,
      },
      "qwen-image-2.0": {
        model_id: "qwen-image-2.0",
        parallel_tool_calls: false,
        vision: true,
        max_context_length: 32000,
      },
    },
  },
  deepminer: {
    api_key: "sk-hjcMKlZoxvUCzUhsQH2FOXMXnzVh4m4l64QGuLqcBrzOAl7q",
    base_url: "https://llm-gateway.mlamp.cn/v1",
    models: {
      "claude-opus-4-6": {
        model_id: "claude-opus-4-6",
        parallel_tool_calls: true,
        vision: true,
        max_context_length: 200000,
      },
      "claude-opus-4-5": {
        model_id: "claude-opus-4-5",
        parallel_tool_calls: true,
        vision: true,
        max_context_length: 200000,
      },
      "vertexai/claude-opus-4-5": {
        model_id: "vertexai/claude-opus-4-5",
        parallel_tool_calls: true,
        vision: true,
        max_context_length: 200000,
      },
      "vertexai/claude-opus-4-6": {
        model_id: "vertexai/claude-opus-4-6",
        parallel_tool_calls: true,
        vision: true,
        max_context_length: 200000,
      },
    },
  },
};

// ==================== Tools Config ====================

export const AVAILABLE_TOOLS: SelectOption[] = [
  // File Operations
  { value: "read", label: "read", group: "File" },
  { value: "write", label: "write", group: "File" },
  { value: "edit", label: "edit", group: "File" },
  { value: "glob", label: "glob", group: "File" },
  { value: "grep", label: "grep", group: "File" },

  // Execution
  { value: "bash", label: "bash", group: "Execution" },
  { value: "task", label: "task", group: "Execution" },

  // Search & Analysis
  { value: "workspace_search", label: "workspace_search", group: "Search" },

  // Communication
  { value: "send_email", label: "send_email", group: "Communication" },
  { value: "check_email", label: "check_email", group: "Communication" },

  // Memory
  { value: "load_skill", label: "load_skill", group: "Memory" },
  { value: "recall", label: "recall", group: "Memory" },
  { value: "read_message", label: "read_message", group: "Memory" },

  // Thinking
  { value: "think", label: "think", group: "Thinking" },
];
