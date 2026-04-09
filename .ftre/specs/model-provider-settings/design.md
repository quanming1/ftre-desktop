# 技术设计：Model Provider Settings

> **架构概要：** 新增 ModelSettings 组件，复用 SettingsPanel 的视图切换模式和 AgentDefSettings 的 list/edit 模式。数据结构定义在 constants.ts，用 useState 管理 CRUD 状态。使用现有 @ftre/ui 组件（Input、Switch）构建表单。

## 涉及文件

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| 新建 | `packages/renderer/src/features/settings/ModelSettings.tsx` | Provider 和 Model 两级 CRUD 管理组件 |
| 修改 | `packages/renderer/src/features/settings/SettingsPanel.tsx` | 添加 Models 入口卡片和视图切换 |
| 修改 | `packages/renderer/src/features/settings/constants.ts` | 添加 mock 数据和类型定义 |
| 修改 | `packages/renderer/src/features/settings/index.ts` | 导出 ModelSettings |

## 现有代码意图分析

### SettingsPanel.tsx

**当前代码的意图**：作为 Settings 的主入口，使用 `view` state 在首页和子页面之间切换。首页展示分类卡片，点击卡片切换到对应子页面（如 "agents" → AgentDefSettings）。

**承载的隐式约束**：
- `SettingsView` 类型控制所有可能的视图
- 子页面组件在 SettingsPanel 内部渲染，共享外层布局（max-w-[800px]、p-8）
- 返回按钮的面包屑样式保持一致

**为什么改动是安全的**：
- 仅扩展 `SettingsView` 类型，添加 `"models"` 选项
- 新增一个 SettingsCategory 卡片和对应的条件渲染分支
- 不修改现有 "home" 和 "agents" 的逻辑

### constants.ts

**当前代码的意图**：存放 settings 相关的静态配置数据（如 AVAILABLE_TOOLS）。

**为什么改动是安全的**：
- 仅添加新的类型定义和 mock 数据常量
- 不修改现有的 AVAILABLE_TOOLS

### index.ts

**当前代码的意图**：统一导出 settings 模块的公共组件。

**为什么改动是安全的**：
- 仅添加新的导出项

## 架构决策

- **视图模式**：复用 SettingsPanel 的 view state 模式（"home" | "agents" | "models"），而非路由
- **组件结构**：ModelSettings 内部管理 list/edit 视图，与 AgentDefSettings 保持一致
- **状态管理**：useState 管理 providers 数据，不引入额外状态库
- **UI 组件**：复用 @ftre/ui 的 Input、Switch 组件，表单样式参考 AgentDefSettings

## 接口设计

### 类型定义（constants.ts）

```typescript
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
```

### Mock 数据（constants.ts）

```typescript
export const INITIAL_PROVIDERS: ProvidersConfig = {
  dashscope: {
    api_key: "sk-REDACTED",
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
    api_key: "sk-REDACTED",
    base_url: "https://llm-gateway.REDACTED.example.com/v1",
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
```

### ModelSettings 组件结构

```typescript
// 视图状态
type ModelSettingsView = "list" | "edit";

// 组件 Props（无 props，使用内部 state）
export function ModelSettings(): JSX.Element;

// 内部状态
// - providers: ProvidersConfig（从 INITIAL_PROVIDERS 初始化）
// - view: ModelSettingsView
// - editingProvider: string | null（当前编辑的 provider key）
```

### UI 结构

**列表视图（view === "list"）**：
- 标题 + 描述
- Provider 列表（每项显示 name、model 数量、删除按钮）
- "Add Provider" 按钮

**编辑视图（view === "edit"）**：
- 返回按钮
- Provider 表单：Name（只读或可编辑）、API Key、Base URL
- Model 列表（可展开/收起的 accordion 风格）
- 每个 Model：显示名、model_id、3 个开关/输入
- "Add Model" 按钮
- "Save" 按钮

## 与现有逻辑的关系

```
SettingsPanel
  ├── view === "home"  → 分类卡片列表（含新增的 Models 卡片）
  ├── view === "agents" → <AgentDefSettings />
  └── view === "models" → <ModelSettings />（新增）

ModelSettings
  ├── 读取 INITIAL_PROVIDERS 初始化 state
  ├── 内部管理 list/edit 视图切换
  └── 使用 @ftre/ui 的 Input、Switch 组件
```
