# PRD-D3-运行详情弹窗

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | D3 |
| 名称 | 运行详情弹窗 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-20 |
| 定稿日期 | 2026-08-20 |
| 验收日期 | 2026-08-20 |
| 关联文档 | docs/TODO.yaml 阶段 D3；AGENTS.md |

## 1. 背景与目标

- **背景**：输入框上方运行横幅同时承载运行状态、模型、任务、文件变更和 pending messages，执行时占用较高垂直空间，打断消息阅读和输入。
- **目标**：保留 pending messages 在输入框上方，其余运行上下文收纳到 Header 右上角的紧凑按钮与弹窗中，参考 Codex 的环境信息弹窗。
- **非目标**：不改变 WebSocket 会话状态、pending message 的可靠队列协议、任务协议或 Diff 打开逻辑；不新增后端接口。

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：会话存在时，Header 右上角常驻“运行详情”按钮，并以状态色或轻量动画表示运行中；空闲时仍可打开详情。
- [x] FR2：点击按钮在其下方展开或关闭紧凑弹窗，展示状态文案、运行时长、实际模型；弹窗不因失焦、点击外部或 Escape 而关闭。
- [x] FR3：弹窗展示任务进度和文件变更摘要；任务可展开步骤，文件变更可展开明细并继续打开原有 Diff 预览。
- [x] FR3.1：工作区为 Git 仓库时，弹窗展示当前 Git 分支以及复用侧面板 `Changes` 数据源的“Git 变更”项；可展开查看暂存/未暂存文件并打开既有 Git Diff。
- [x] FR3.2：Git 变更项复用侧面板 `Changes` 的图标、工作区状态和 Inspector 预览行为；本轮工具修改与工作区 Changes 分组明确区分。
- [x] FR3.3：运行详情弹窗的开关作为全局偏好持久化，不按 session 隔离；切换会话后保持同一开关状态。
- [x] FR4：输入框上方只保留 `QueuedMessagesBanner`；pending message 的数量、展开、编辑与移除行为保持不变。
- [x] FR5：运行状态与 pending messages 独立：没有 pending messages 的运行不会在输入框上方留下空横幅；存在 pending messages 时不依赖运行详情弹窗是否展开。

### 2.2 非功能需求

- 性能：每秒更新时长仅在有运行上下文时执行；弹窗关闭时不渲染展开内容。
- 可访问性：按钮具备状态化 `aria-label` / `aria-expanded`；弹窗仅由该按钮切换，避免查看详情时被失焦关闭。
- 兼容性：复用既有 Zustand 状态、任务、文件变更和 Inspector Diff 打开逻辑。

## 3. 技术方案

- 新增 `RunContextPopover.tsx`，直接订阅 `useChat` 并计算状态、模型、时长、当前轮文件变更，避免 `ChatView → ChatHeader` 的 props 链。
- `ChatHeader.tsx` 在更多操作左侧挂载弹窗触发器；弹窗以 Header 局部定位，呈现紧凑卡片。
- `ChatView.tsx` 删除运行详情横幅，仅在 `pendingMessages.length > 0` 时渲染保留队列横幅；消息列表底部留白随 pending 横幅状态调整。
- Git 状态按当前 session workspace 轮询，点击 Changes 项复用 Inspector 的文件预览 / Diff 预览；弹窗开关写入全局 localStorage 偏好。

## 4. 接口定义

- 不新增后端 API、IPC、WebSocket 事件或共享协议字段。
- 组件内部使用 `useChat`（运行状态、计划、消息、模型、队列）、`useInspector` / `useLayout`（工具 Diff 预览）与 `gitService` / `useGitService`（复用侧面板 Git 状态及 Git Diff）；分支沿用原输入框的 session workspace 查询，避免与 Explorer 根目录不一致。

## 5. 验收标准

- [x] AC1：运行中且无 pending messages 时，输入框上方不出现运行横幅，Header 右上角显示运行详情按钮。
- [x] AC2：点击按钮后，弹窗带入场动画并显示状态、时长、模型、任务和文件变更；仅再次点击该按钮后关闭，点击外部或 Escape 不关闭。
- [x] AC3：任务步骤可展开；文件变更明细可展开并打开 Inspector Diff。
- [x] AC3.1：Git 工作区显示当前分支及“Git 变更”项，计数与侧面板一致；展开文件后可打开既有 Git Diff；输入框不再重复展示分支。
- [x] AC4：发送多条消息形成 pending queue 后，输入框上方仍可查看、编辑、移除队列消息，运行详情不混入该横幅。
- [x] AC5：相关单元测试与 Renderer 生产构建通过。
- [x] AC6：空闲状态仍显示 Header 按钮；弹窗开关跨 session 保持；Changes 条目可打开 Inspector；弹窗无横向分割线且分组间距、字体和图标统一。

## 6. 测试计划

- 单元测试：运行状态按钮可见性、按钮展开/关闭、任务/文件行、pending 横幅独立渲染。
- 手动验证：运行普通会话、压缩会话、存在任务/文件变更的会话以及多条 pending messages；检查窄窗口下弹窗不越界。

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-20 | 初始定稿 | 将输入区运行上下文迁移至 Header 右上角弹窗 |
| 2026-08-20 | 交互与视觉校准 | 弹窗改为按钮唯一开关，并按环境信息卡优化入场、圆角、阴影、分组和图标 |
| 2026-08-20 | Git 变更项 | 复用侧面板 Changes 的 GitService 数据与 Git Diff 打开逻辑 |
| 2026-08-20 | Git 分支迁移 | 移除输入框工作区徽章中的分支，改由运行详情卡统一展示 |
| 2026-08-20 | 验收完成 | 单元测试、相关类型检查与 Renderer 生产构建通过 |
| 2026-08-20 | 后续交互与视觉校准 | 按用户反馈使按钮常驻并持久化全局开关；Git 状态改为按 session workspace 读取，Changes 点击复用 Inspector；本轮修改 / Changes 分组更名并统一图标、间距、字体与颜色，移除弹窗边框和横向分割线；相关测试 7/7 通过 |
| 2026-08-20 | 标题会话切换入口 | 移除标题右侧箭头与列表统计，点击标题直接展开最近 WebSocket 会话列表；重命名继续保留在更多操作菜单中 |
