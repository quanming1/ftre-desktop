# PRD-B7 会话列表信息 Tooltip 化

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | B7 |
| 名称 | 会话列表信息 Tooltip 化 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-25 |
| 定稿日期 | 2026-08-25 |
| 验收日期 | 2026-08-25 |
| 关联文档 | `docs/TODO.yaml` B7；`AGENTS.md` |

## 1. 背景与目标

会话列表当前在每一行直接展示最后一条用户消息摘要，导致行高随内容状态变化，列表密度不稳定，
也无法同时清楚表达工作区和会话更新时间。本阶段将列表行收敛为单行标题，完整会话上下文改为
悬停 Tooltip 展示。

目标：用户可以在紧凑、固定高度的 sessionList 中快速识别会话，并在悬停时看到标题、最后一条
消息、所在工作区和相对更新时间。

非目标：不修改后端 SessionSummary、WebSocket/HTTP 协议、会话排序、分页、持久化和消息内容。

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：SessionRow 只展示单行标题和已有的运行/未读/时间/菜单控件，不在正文展示
  `last_user_text` 摘要。
- [x] FR2：SessionRow 使用 Tooltip 包裹整行；Tooltip 展示会话标题、最后一条用户消息、
  工作区名称（并保留完整路径作为可访问的 title）和相对更新时间。
- [x] FR3：有无最后消息、标题长短、是否置顶、是否运行中、是否属于其他 channel，均不改变
  SessionRow 的固定高度和布局；现有点击、右键菜单、置顶色点和 hover 菜单行为保持不变。
- [x] FR4：没有最后消息或工作区时，Tooltip 展示明确的空值文案，不渲染空白块。

### 2.2 非功能需求

- Tooltip 使用现有 `@ftre/ui` 组件，不引入新的依赖或第二套浮层实现。
- 列表行信息不依赖额外请求，继续使用后端已返回的 `SessionSummary` 字段。
- Tooltip 不影响 sessionList 的滚动、拖拽排序和折叠态浮层。

## 3. 技术方案

- `packages/renderer/src/features/session/SessionPanel.tsx`
  - 删除 `SessionRow` 的第二行 preview 渲染；行高度固定为 `h-10`。
  - 新增紧凑 Tooltip 内容，复用 `workspaceLabel()`、`timeAgo()` 和 `last_user_text`。
  - Tooltip 触发器覆盖整条 SessionRow，保持现有事件处理器和 action button。
- `packages/renderer/src/features/session/SessionPanel.test.tsx`
  - 添加最后消息不出现在列表正文、悬停后出现在 Tooltip 的回归测试。
  - 添加无消息/无工作区的空值展示断言（如组件测试夹具覆盖）。

## 4. 接口定义

不新增接口。Tooltip 数据映射如下：

| Tooltip 字段 | 来源 |
|---|---|
| 标题 | `SessionSummary.title` |
| 最后一条消息 | `SessionSummary.last_user_text` |
| 工作区 | `SessionSummary.workspace`，显示 basename，完整值置于 title |
| 更新时间 | `SessionSummary.updated_at` → `timeAgo()` |

## 5. 验收标准

- [x] AC1：有无 `last_user_text` 的会话行均为相同固定高度，列表正文不显示 desc 第二行。
- [x] AC2：鼠标悬停整行后，Tooltip 同时显示标题、最后消息、工作区和相对时间。
- [x] AC3：Tooltip 不阻断点击切换、右键菜单、置顶色点、运行 spinner、未读点和拖拽排序。
- [x] AC4：`pnpm --filter @ftre/renderer test`、renderer `tsc --noEmit`、renderer build 和
  `git diff --check` 全部通过。

## 6. 测试计划

- SessionPanel 组件测试：验证正文没有 preview，悬停后 Tooltip 出现完整信息。
- 手动验证：长标题、长消息、空消息、无工作区、运行中、置顶和折叠侧栏浮层。

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-25 | 新建 B7，定义会话列表固定单行与 Tooltip 信息面板 | sessionList 需要更紧凑且不丢失上下文 |
| 2026-08-25 | 完成 B7；行高收敛为 `h-9`，Tooltip 使用白底、无边框、轻阴影并取消进出场动画 | 按 UI 评审意见收紧列表密度并即时展示信息 |
| 2026-08-25 | Tooltip 标题、时间、工作区和最后消息字号整体上调一级 | 提升悬停信息的可读性 |
| 2026-08-25 | Tooltip 圆角从 xl 收窄为 lg | 让弹窗轮廓更利落 |
