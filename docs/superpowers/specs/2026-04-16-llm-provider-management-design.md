# LLM Provider Management - 设计文档

> 接入后端 LLM 供应商配置 API，实现供应商的增删改查功能

## 背景

后端已上线 LLM 供应商配置管理接口，前端需要接入以替代现有的本地 mock 数据。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/llm/providers` | 获取所有供应商列表 |
| POST | `/llm/providers?vendor={vendor}` | 新增供应商 |
| PUT | `/llm/providers/{vendor}` | 更新供应商 |
| DELETE | `/llm/providers/{vendor}` | 删除供应商 |

### 数据结构

**GET 响应**：
```json
{
  "providers": [
    {
      "vendor": "openai",
      "base_url": "https://api.openai.com/v1",
      "models": { "gpt4": "gpt-4", "gpt35": "gpt-3.5-turbo" }
    }
  ]
}
```

**POST/PUT 请求体**：
```json
{
  "api_key": "sk-xxx",
  "base_url": "https://api.openai.com/v1",
  "models": { "gpt4": "gpt-4", "gpt35": "gpt-3.5-turbo" },
  "api_type": "completions"
}
```

## 设计决策

1. **models 格式简化**：前端移除 `parallel_tool_calls`, `vision`, `max_context_length` 字段，改为简单的 `{ alias: model_name }` 映射，与后端一致

2. **api_key 处理**：后端会新增字段支持脱敏显示，编辑时显示占位符，留空保持原值，输入新值则更新

3. **UI 入口**：融合到现有 Settings > Models 页面，直接改造 `ModelSettings.tsx`

4. **api_type 字段**：作为普通表单字段始终显示，默认值 "completions"

## 技术方案

### API 层

在 `services/api.ts` 新增：

```typescript
// ─── LLM Provider API ────────────────────────────────────────────

export interface LLMProvider {
  vendor: string;
  base_url: string;
  api_key?: string;
  models: Record<string, string>;
  api_type?: string;
}

export interface LLMProviderPayload {
  api_key: string;
  base_url: string;
  models: Record<string, string>;
  api_type?: string;
}

/** 获取所有供应商 */
export async function fetchLLMProviders(): Promise<LLMProvider[]>

/** 新增供应商 */
export async function createLLMProvider(vendor: string, data: LLMProviderPayload): Promise<LLMProvider | null>

/** 更新供应商 */
export async function updateLLMProvider(vendor: string, data: LLMProviderPayload): Promise<LLMProvider | null>

/** 删除供应商 */
export async function deleteLLMProvider(vendor: string): Promise<boolean>
```

### UI 组件

重构 `ModelSettings.tsx`，保持现有 list/edit 双视图模式：

**表单数据结构**：
```typescript
interface ProviderFormData {
  vendor: string;
  api_key: string;
  base_url: string;
  api_type: string;
  models: Array<{ alias: string; model_name: string }>;
}
```

**视图流程**：
```
List View                          Edit View
┌────────────────────┐            ┌────────────────────┐
│ Models             │            │ ← Back             │
│                    │            │                    │
│ ┌────────────────┐ │   click    │ New/Edit Provider  │
│ │ openai      →  │ │ ────────►  │                    │
│ │ 3 models       │ │            │ Vendor: [______]   │
│ └────────────────┘ │            │ API Key: [______]  │
│ ┌────────────────┐ │            │ Base URL: [______] │
│ │ dashscope   →  │ │            │ API Type: [______] │
│ │ 2 models       │ │            │                    │
│ └────────────────┘ │            │ Models:            │
│                    │            │ ┌────────────────┐ │
│ + Add provider     │            │ │ gpt4 → gpt-4   │ │
└────────────────────┘            │ └────────────────┘ │
                                  │ + Add model        │
                                  │                    │
                                  │ [Save Provider]    │
                                  └────────────────────┘
```

### 数据流

**加载流程**：
```
组件挂载 → useEffect → fetchLLMProviders() → setProviders(data) → 渲染 List View
```

**保存流程**：
```
点击 Save Provider
    ↓
表单验证（vendor/api_key/base_url 必填，编辑时 api_key 可选）
    ↓
models 数组转 Record: [{ alias, model_name }] → { alias: model_name }
    ↓
isEditing ? updateLLMProvider() : createLLMProvider()
    ↓
成功 → 重新 fetchLLMProviders() + 返回 List View
失败 → 显示错误信息
```

**删除流程**：
```
点击删除按钮 → confirm() 确认 → deleteLLMProvider(vendor) → 重新 fetchLLMProviders()
```

### 错误处理

- API 失败时在表单顶部显示错误信息（复用现有 `error` state 模式）
- 网络错误使用 try/catch 捕获

## 文件改动清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `services/api.ts` | 新增 | 添加 4 个 LLM Provider API 函数 + 类型定义 |
| `features/settings/ModelSettings.tsx` | 重构 | 接入 API，简化 models 数据结构，新增 api_type 字段 |
| `features/settings/constants.ts` | 删除部分 | 移除 `INITIAL_PROVIDERS` mock 数据和相关类型 |

**不改动**：
- `SettingsPanel.tsx` - 入口保持不变
- UI 组件库 - 复用现有 `Input` 组件

## 代码量预估

- API 层：~50 行
- 组件重构：~300 行（基于现有 ~440 行简化）
