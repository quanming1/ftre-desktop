# PRD-C2 MCP 上下文目录与三层管理 UI

> 状态生命周期：草稿 → 评审 → approved（定稿）→ 开发中 → 已验收

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | C2 |
| 名称 | MCP 上下文目录与三层管理 UI |
| 状态 | approved |
| 创建日期 | 2026-09-02 |
| 定稿日期 | 2026-09-02 |
| 验收日期 | — |
| 关联文档 | `docs/TODO.yaml` C2；配对后端 F40 |

## 1. 背景与目标

- **背景**：现有 MCP 浮窗没有传递当前 Session 的 Agent/工作区，使用的类型和 CRUD 路由也已落后于后端，导致列表空白、状态误判以及编辑请求失败。
- **目标**：MCP 浮窗和设置页都基于当前 Session 的 `agent_id + workspace` 查询同一份后端 Catalog，清楚展示全局、Agent、项目三层来源、覆盖关系和连接状态，并能向指定来源安全写入配置。
- **非目标**：不在客户端解析 MCP 配置文件、不保管凭据、不自行推断连接状态、不提供 MCP 工具调用页面。

## 2. 需求范围

### 2.1 功能需求

- [ ] FR1：MCP API 类型改为 `global | agent | project` 和后端 CatalogItem；移除旧 `private`、`connected/disconnected`、无上下文默认 Agent 的契约。
- [ ] FR2：浮窗解析当前 Session 的 `agent_id` 和 `workspace`，默认请求 `view=effective`；未连接服务器也显示为“已配置”。
- [ ] FR3：设置页使用 `view=sources`，按全局、Agent、项目分组；被覆盖项显示来源与覆盖标识，不能误称为断开。
- [ ] FR4：新增/编辑/启用/删除操作明确目标 scope；Agent 操作使用当前 Agent，项目操作使用当前工作区；请求成功后立即按当前上下文刷新。
- [ ] FR5：禁用、无效、连接失败状态和错误提示可见；页面不会渲染环境变量或 headers 的秘密值。
- [ ] FR6：会话/Agent/工作区切换、请求竞态与组件卸载时取消旧请求，避免旧结果覆盖新上下文。

### 2.2 非功能需求

- 一致性：浮窗与设置页共用请求模型和上下文解析。
- 可用性：空状态区分“没有配置”与“加载失败”；状态颜色有文字辅助，不能只依赖颜色。
- 兼容性：不修改聊天 WebSocket、会话数据格式、Inspector 或 Electron IPC。

## 3. 技术方案

```text
current Session
   ├─ agent_id
   └─ workspace
         ↓
  useMcpContext / fetchMcpCatalog
         ↓
  McpPopover (effective) ── McpSettings (sources)
         ↓
       /api/mcp
```

| 模块 | 职责 |
|---|---|
| `services/api.ts` | CatalogItem 类型、带上下文的 GET/CRUD、HTTP 错误统一处理 |
| `features/mcp/` | 浮窗显示当前 effective 配置与状态 |
| `features/settings/McpSettings.tsx` | 三层来源管理和写入表单 |
| 共享 hook/selector | 从 chat/session store 获取当前 Agent 与 workspace，取消过期请求 |

## 4. 接口定义

```ts
fetchMcpCatalog({ agentId, workspace, view: "effective" | "sources" })
createMcpServer({ scope, agentId?, workspace?, config })
updateMcpServer({ name, scope, agentId?, workspace?, patch })
deleteMcpServer({ name, scope, agentId?, workspace? })
```

客户端只显示后端脱敏字段；`scope` 是配置 Owner，不是运行时 Tool scope。

## 5. 验收标准

- [ ] AC1：当前 Agent 有私有 MCP、当前工作区有项目 MCP 时，标题栏浮窗能立即显示 effective 项。
- [ ] AC2：设置页同时显示 global/agent/project 三层，并正确标记同名覆盖。
- [ ] AC3：切换 Session/Agent/工作区不会闪回前一会话的 MCP 列表。
- [ ] AC4：四种 CRUD 操作请求带正确 scope 与上下文，操作后页面刷新且错误可读。
- [ ] AC5：Renderer MCP 回归测试、`pnpm test`、类型检查、构建和 `git diff --check` 通过。

## 6. 测试计划

- API 单测：URL 参数、错误响应、Catalog 反序列化。
- 组件：当前上下文解析、effective/source 渲染、状态/覆盖标识、操作后的刷新和请求竞态。
- 手动：在两个工作区切换同一 Agent，确认项目 MCP 列表与后端 effective 结果一致。

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-09-02 | 初始定稿 | 旧 C1 MCP UI 与后端 F40 的三层 Catalog 契约同步重建。 |
