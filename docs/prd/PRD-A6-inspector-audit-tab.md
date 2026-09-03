# PRD-A6-Inspector 审计 Tab

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | A6 |
| 名称 | Inspector 审计 Tab |
| 状态 | 开发中 |
| 创建日期 | 2026-08-21 |
| 定稿日期 | — |
| 验收日期 | — |
| 关联文档 | docs/TODO.yaml 阶段 A6；AGENTS.md |

## 1. 背景与目标

- **背景**：运行详情中的 Changes 目前只能在弹窗内展开文件列表并逐个打开 Diff，无法集中审阅当前工作区的变更。
- **目标**：提供按工作区和轮次隔离的 Inspector 审阅 Tab：既能集中展示工作区当前变更，也能固定审阅某一轮工具修改，并从运行详情或消息卡片直接进入。
- **非目标**：本阶段不实现 Git 分支/提交历史选择、不编辑文件、不新增后端审计协议；复用现有 Git 状态与 Diff IPC。

## 2. 需求范围

### 2.1 功能需求

- [ ] FR1：Inspector 新增 `audit` Tab 类型；工作区审阅按规范化工作区路径唯一，重复点击该工作区的 Changes 只激活并刷新原 Tab，不覆盖其他工作区。
- [ ] FR2：运行详情中的 `Changes` 行常驻显示（Git 仓库无文件变更时仍显示 0），点击后进入当前会话工作区的工作区审阅 Tab。
- [ ] FR3：消息列表的“本轮修改/审查”和运行详情的“本轮修改”进入轮次审阅；轮次审阅按“工作区 + 稳定轮次 ID”唯一，不同轮次可以并存，并展示该轮次的完整工具修改快照。
- [ ] FR4：从另一个工作区执行“新建”时，如果目标工作区已有工作区审阅 Tab，则只跳转到该 Tab；没有时保持普通新建会话行为，不创建空审阅页。
- [ ] FR5：审阅 Tab 标题包含工作区名称；工作区审阅和轮次审阅使用同一工作区时也保持可区分，不因切换工作区而改写已有 Tab。
- [ ] FR6：工作区审阅页提供对比范围下拉框，支持“未提交”（工作区全部变更）、“未暂存”（工作区相对暂存区）、“已暂存”（暂存区相对 HEAD）和“未跟踪”（仅新建且未纳入 Git 的文件）；轮次审阅默认选择“上一轮”，也可切换查看当前 Git 范围。
- [ ] FR7：审阅页展示当前范围的文件列表和增删统计；无变更时展示空状态，不隐藏页面结构。
- [ ] FR8：文件 item 可展开/收起 Diff；Diff 使用现有只读 Diff 渲染能力，按需加载单个文件内容。
- [ ] FR9：文件 item header 提供复制 Diff 和打开源文件按钮；打开源文件复用现有 file preview tab，复制成功提供轻量反馈。
- [ ] FR10：审阅 Tab 纳入现有 Inspector tab 的激活、关闭、拖拽排序、右键菜单和 keep-alive 机制。

### 2.2 非功能需求

- 性能：首次只读取 Git 状态和统计，文件 Diff 在展开时加载；多个文件不因进入审计页而并发读取全部内容。
- 兼容性：复用现有 `git:poll` / `git:diff-file`、Inspector store 和 `DiffRenderer` 的视觉规范。
- 可访问性：下拉框、文件 item、复制和打开源文件按钮提供可读的 aria-label/title。

## 3. 技术方案

- `stores/inspector.ts`：扩展 `InspectorTabType` 和 discriminated union；`AuditTab` 保存 `workspacePath`、`scope`、`auditKey`、可选 `turnId` 和轮次快照。`openAuditTab` 按工作区/轮次 key 复用，`activateWorkspaceAudit` 只激活已有工作区审阅。
- `features/chat/RunContextPopover.tsx`：Changes 行保留常驻入口并打开 workspace scope；本轮修改使用 session + 当前轮最后一条 user message ID 作为稳定轮次身份；不再依赖弹窗内的 Git 文件列表作为主要审阅入口。
- `features/chat/TurnFileChanges.tsx` / `ChatMessageList.tsx`：消息卡片使用 assistant message ID 作为历史轮次身份，打开 turn scope 审阅。
- `features/session/SessionPanel.tsx`：工作区新建动作先检查已有 workspace audit，存在时激活并显示 Inspector，不创建空 Tab。
- `features/inspector/AuditRenderer.tsx`：轮次 scope 使用快照；workspace scope 按 workspace 调用 Git poll，按选中的对比范围筛选文件；维护展开文件、Diff 内容和复制反馈状态。
- `features/inspector/InspectorPanel.tsx`：注册 `audit` tab 图标、动态工作区标题和渲染器；审阅 Tab 沿用动态 tab 的关闭与排序行为。
- `features/inspector/renderers/AuditDiff.tsx`（如需要）：封装单文件只读 Diff 展示，复用 `CodeDiff` 配置；优先在审计渲染器内部保持数据加载边界清晰。

### 关键数据结构

```ts
type AuditScope = "workspace" | "turn";
type AuditCompareMode = "turn" | "uncommitted" | "unstaged" | "staged";

interface AuditTab extends TabBase {
  type: "audit";
  workspacePath: string;
  scope: AuditScope;
  auditKey: string;
  turnId?: string;
  turnChanges?: AuditFileChange[];
}
```

## 4. 接口定义

- `openAuditTab(workspacePath: string, options?: { scope?: "workspace" | "turn"; turnId?: string; turnChanges?: AuditFileChange[] }): void`：工作区 scope 使用 `workspace:<normalizedWorkspace>`，轮次 scope 使用 `turn:<normalizedWorkspace>:<turnId>`；命中 key 时激活并更新，不命中时创建带工作区名称的 Tab。
- `activateWorkspaceAudit(workspacePath: string): boolean`：只查找并激活目标工作区已有的 workspace scope 审阅，不创建新 Tab，供工作区“新建”动作使用。
- `window.desktop.git.poll(workspacePath, "", true)`：读取文件状态与 numstat；前端按对比范围筛选。
- `window.desktop.git.diffFile(workspacePath, path, status, staged, oldPath)`：按文件展开时读取 before/after 内容。

## 5. 验收标准

- [ ] AC1：同一工作区连续点击 Changes 只保留一个 workspace scope 审阅 Tab；切换到另一个工作区后创建/激活另一个工作区 Tab，原 Tab 的路径和内容不被改写。
- [ ] AC2：同一工作区同一轮次重复点击“本轮修改/审查”只激活原 turn scope Tab；不同轮次或不同工作区创建新的 turn scope Tab；workspace 与 turn scope 可以并存。
- [ ] AC3：工作区“新建”在已有审阅时激活该工作区 Tab，没有审阅时不创建空审阅页；Tab 标题始终包含对应工作区名称。
- [ ] AC4：审阅页下拉框可以切换“上一轮”（轮次审阅）、未提交、未暂存、已暂存、未跟踪，列表和增删统计随选择更新；“未跟踪”只展示 Git status 为 untracked 的文件。
- [ ] AC5：点击文件 item 展开 Diff，再次点击收起；未展开文件不预加载 Diff 内容。
- [ ] AC6：文件 header 的复制按钮可以复制该文件 Diff，打开源文件按钮可以激活现有文件预览 Tab。
- [ ] AC7：审阅 Tab 的关闭、拖拽排序、右键菜单不影响既有 file/diff/terminal Tab；切换 Tab 不会因为 keep-alive 被销毁而丢失已展开内容。

## 6. 测试计划

- Store：验证按 workspace scope 复用、按 workspace + turn scope 复用、跨工作区不覆盖、只激活已有工作区审阅和关闭后重建。
- Renderer：验证对比范围筛选、空状态、文件展开按需加载、复制/源文件操作。
- 手动：在 Git 仓库中打开运行详情 → Changes，切换三个 Git 对比选项，展开多个文件，复制 Diff 并打开源文件；再从消息卡片打开两个不同轮次，确认两张轮次审阅可并存；切换工作区后确认标题、数据和已有 Tab 不串；确认无变更时仍可进入审阅页。

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-28 | MessageList 性能优化：删除无效 turnTexts 传参、turnFileChanges 与搜索/摘要文本按消息引用缓存、ChatInput memo、流式 markdown 节流 10ms→40ms、增量切块（createBlockSplitter）、离屏消息 content-visibility: auto、dev 压测入口 `__ftrePerf` | 长会话 + 流式场景下每次 WS 批触发全列表无效渲染与全文重解析，收敛到仅 streaming 消息本身 |
| 2026-08-28 | MessageList 新增 Ctrl+F 搜索：右上角浮窗（上下导航 + x/N 计数）、用户消息关键字 mark 高亮、匹配消息定位 ring | 审阅与会话列表内快速查找内容，不影响流式性能 |
| 2026-08-21 | 初始定稿：新增唯一 Inspector 审计 Tab，Changes 常驻并支持未提交/未暂存/已暂存三种对比范围；文件 Diff 按需展开，提供复制和打开源文件操作 | 用户需求与 Codex 参考图 |
| 2026-08-21 | Changes 行右侧增加工作区增删统计，统一展示为 `+xxx -xxx`，无变更时显示 `+0 -0` | 用户视觉调整需求 |
| 2026-08-21 | 将“全局唯一”改为“工作区/轮次范围唯一”：Changes 进入 workspace scope；本轮修改/消息审查进入 workspace + turn scope；工作区新建只激活已有审阅；Tab 标题带工作区名称 | 用户补充的唯一性和轮次审阅需求 |
| 2026-08-21 | 增加“未跟踪”对比范围；修正审阅 SelectItem 覆盖组件库默认 `pl-8` 的问题，避免选中对号与文字重叠 | 用户反馈缺少未跟踪选项及下拉对号错位 |
