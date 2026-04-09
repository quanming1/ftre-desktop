# Model Provider Settings

> **目标：** 在 Settings 面板中提供 AI Provider 和 Model 的两级 CRUD 配置管理界面

## 简介

用户需要配置多个 AI Provider（如 dashscope、deepminer）的连接信息和可用模型列表。每个 Provider 有 API 密钥、服务端点，以及一组模型配置。每个模型除了 ID 映射外，还有能力标记（是否支持工具并发、是否支持视觉、最大上下文长度）。

当前阶段后端未就绪，前端先行实现完整 CRUD UI，数据 hardcode 在代码中，用 React state 管理编辑状态，刷新页面重置。

## 术语表

- **Provider**: AI 服务提供商（如 dashscope、deepminer），包含 api_key、base_url 和一组 models
- **Model**: 某个 Provider 下的具体模型，有显示名（别名）和实际 model_id
- **显示名**: 用户在 UI 中看到的模型名称（如 "qwen3-max"）
- **model_id**: 实际调用 API 时使用的模型标识符（如 "qwen3-max-2026-01-23"）

## 需求

### 需求 1：Settings 首页新增 Models 入口

**用户故事：** 作为用户，我希望在 Settings 首页看到 "Models" 配置入口，以便管理 AI Provider 和模型配置。

#### 验收标准
1. WHEN 用户打开 Settings 面板，THEN 首页显示 "Models" 分类卡片，包含图标、标题和描述
2. WHEN 用户点击 "Models" 卡片，THEN 进入 Models 配置页面

---

### 需求 2：Provider 列表管理

**用户故事：** 作为用户，我希望查看、添加、删除 AI Provider，以便管理不同的 AI 服务商配置。

#### 验收标准
1. WHEN 用户进入 Models 配置页面，THEN 显示所有 Provider 列表，每项展示 Provider 名称和简要信息
2. WHEN 用户点击 "Add Provider" 按钮，THEN 进入新建 Provider 表单
3. WHEN 用户点击某个 Provider 项，THEN 进入该 Provider 的编辑视图
4. WHEN 用户点击 Provider 项的删除按钮并确认，THEN 该 Provider 从列表中移除
5. IF Provider 列表为空，THEN 显示空状态提示和新建入口

---

### 需求 3：Provider 编辑

**用户故事：** 作为用户，我希望编辑 Provider 的基本信息（名称、api_key、base_url），以便配置服务连接。

#### 验收标准
1. WHEN 用户进入 Provider 编辑视图，THEN 显示表单包含：Provider 名称、API Key、Base URL
2. WHEN 用户修改字段并点击保存，THEN 更新 Provider 配置并返回列表视图
3. WHEN 用户点击取消/返回，THEN 放弃修改并返回列表视图
4. IF Provider 名称为空，THEN 显示错误提示，禁止保存

---

### 需求 4：Model 列表管理

**用户故事：** 作为用户，我希望在 Provider 编辑视图中管理该 Provider 下的模型列表。

#### 验收标准
1. WHEN 用户在 Provider 编辑视图，THEN 下方显示该 Provider 的 Model 列表
2. WHEN 用户点击 "Add Model" 按钮，THEN 展开/显示新建 Model 的内联表单
3. WHEN 用户点击某个 Model 项，THEN 展开该 Model 的编辑表单
4. WHEN 用户点击 Model 项的删除按钮并确认，THEN 该 Model 从列表中移除

---

### 需求 5：Model 编辑

**用户故事：** 作为用户，我希望编辑模型的详细配置，包括 ID 映射和能力标记。

#### 验收标准
1. WHEN 用户编辑 Model，THEN 表单包含以下字段：
   - 显示名（Display Name）：文本输入
   - Model ID：文本输入
   - Parallel Tool Calls：开关（boolean）
   - Vision：开关（boolean）
   - Max Context Length：数字输入
2. WHEN 用户修改字段并保存，THEN 更新 Model 配置
3. IF 显示名或 Model ID 为空，THEN 显示错误提示，禁止保存

---

### 需求 6：Mock 数据初始化

**用户故事：** 作为开发者，我希望页面加载时有预置的示例数据，以便开发和测试 UI。

#### 验收标准
1. WHEN 页面首次加载，THEN 使用 hardcoded 初始数据填充 Provider 列表
2. WHEN 用户进行 CRUD 操作，THEN 仅更新内存中的 state
3. WHEN 用户刷新页面，THEN 数据重置为初始 hardcoded 值

---

## 边界情况

- **Provider 名称重复**：允许（暂不校验唯一性，后端接入时再处理）
- **Model 显示名重复**：同一 Provider 下不允许，不同 Provider 下允许
- **空列表**：Provider 列表为空时显示空状态；Model 列表为空时显示提示
- **特殊字符**：Provider 名称和 Model 显示名允许任意字符
- **数值边界**：max_context_length 最小为 1，无上限校验
