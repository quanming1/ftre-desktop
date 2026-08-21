# PRD-A5-Inspector 终端 Tab

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | A5 |
| 名称 | Inspector 终端 Tab |
| 状态 | 开发中 |
| 创建日期 | 2026-08-21 |
| 定稿日期 | 2026-08-21 |
| 验收日期 | — |
| 关联文档 | docs/TODO.yaml；AGENTS.md；docs/PROCESS.md |

## 1. 背景与目标

- **背景**：当前终端入口位于客户端 Header，打开后以独立浮动窗口展示，与右侧文件预览的 Tab 工作流割裂；用户需要在同一组 Inspector Tab 中切换文件、日志和终端。
- **目标**：将 Header 的终端入口迁移到 Inspector Tab 栏右侧的 `+` 菜单，选择后创建一个独立终端 Tab，并在该 Tab 页面内展示对应的可交互终端内容。
- **非目标**：本阶段 `+` 菜单只提供“终端”一项；不新增浏览器、文件、侧边聊天等菜单项；不修改后端终端协议、PTY 生命周期协议或文件树其他入口；不做终端历史持久化。

## 2. 需求范围

### 2.1 功能需求

- [ ] FR1：Inspector Tab 栏最右侧提供 `+` 按钮，点击后通过定位浮层打开新增面板菜单；菜单当前只展示“终端”项，并保留现有终端快捷键提示。
- [ ] FR2：每次选择“终端”都创建一个独立 PTY 和 Inspector `terminal` Tab；Tab 标题显示所属工作区名称，同名工作区实例依次追加 `(1)`、`(2)`，并将新 Tab 设为 active。
- [ ] FR3：终端 Tab 使用现有 `TerminalManager`、PTY service、xterm 渲染和当前 session/workspace cwd；终端内容支持输入、输出、滚动、复制和现有终端交互能力。
- [ ] FR4：移除 Header 上原有的终端按钮，避免同一功能出现两个入口；现有 Header 其他按钮和窗口控制保持不变。
- [ ] FR5：终端 Tab 纳入现有 Tab 的激活、关闭、右键菜单、拖拽排序和 keep-alive 生命周期；每个 Tab 只渲染并管理自己绑定的 PTY 实例，关闭 Tab 同步关闭该 PTY。
- [ ] FR6：终端 Tab 的右键菜单不展示文件预览专属的自动换行操作，提供清除终端内容，并保留终端 Tab 的关闭类操作；菜单使用中性 hover 高亮。

### 2.2 非功能需求

- 交互：`+` 菜单使用 portal/定位浮层，不撑大 Inspector 容器；点击菜单项后立即关闭菜单。
- 兼容性：复用既有 xterm 和 terminalManager，不改变现有终端浮动窗口与文件树“在终端打开”事件的底层能力。
- 可访问性：按钮和菜单项提供可读的 `aria-label`/title，键盘可以聚焦和选择“终端”。
- 性能：终端 Tab 不激活时保持现有 Inspector 的可见性隔离策略，不重复创建 PTY。

## 3. 技术方案

- `stores/inspector.ts`：扩展 `InspectorTabType` 和 discriminated union，新增带 `terminalId` 的 `TerminalTab` 与 `openTerminalTab`，同一 PTY 重复绑定时激活已有 Tab，不同 PTY 创建新 Tab。
- `InspectorPanel.tsx`：在动态 Tab 栏右侧增加 `DropdownMenu` 的 `+` 触发器和“终端”菜单项；调用 `openTerminalTab`，必要时打开 Inspector 面板。
- `tabRegistry.ts`：注册 `terminal` 的图标、标题和渲染器。
- `features/inspector/renderers/TerminalRenderer.tsx`：以 Inspector 内容区尺寸承载现有 `TerminalManager`；嵌入模式隐藏原浮动终端专用的内部 Tab 栏，保留终端内容区和搜索能力。
- `TerminalManager.tsx`：增加嵌入模式和 `terminalId` 参数；嵌入 Tab 只挂载对应 PTY，复用容器挂载和 refit 逻辑，不复制 PTY 管理代码。
- `terminal-manager.ts`：终端标签使用根工作区名称，按当前打开实例生成稳定的重名后缀。
- `packages/electron/src/ipc/terminal.ts`：Windows PowerShell / CMD 启动时统一设置 UTF-8；PowerShell 同时设置 `Get-Content` 等 cmdlet 的默认编码，避免终端执行 `cat` 读取中文文件时出现乱码。
- `TitleBar.tsx`：删除 Header 终端按钮及其专用状态读取，保留其他 Header 操作。

## 4. 接口定义

### 4.1 Inspector store

```ts
type InspectorTabType = "file" | "diff" | "image" | "terminal";

interface TerminalTab extends TabBase {
  type: "terminal";
  terminalId: string;
}

openTerminalTab(terminalId: string, title: string): void;
```

### 4.2 组件接口

```ts
interface TerminalManagerProps {
  embedded?: boolean;
  terminalId?: string;
}
```

`embedded=true` 时仅改变 Inspector 内部布局，不改变终端 service、事件和输入输出接口。

## 5. 验收标准

- [ ] AC1：Inspector Tab 栏最右侧显示 `+`；点击后浮层只出现“终端”一项，浮层不撑大面板。
- [ ] AC2：每次点击“终端”都会创建并激活新的终端 Tab；Tab 显示工作区名，同名实例按 `工作区`、`工作区 (1)`、`工作区 (2)` 展示。
- [ ] AC3：终端页面可看到 shell 输出，点击内容区可以输入命令并看到输出，窗口尺寸变化后内容布局正常。
- [ ] AC4：Header 不再显示原终端按钮；其他 Header 操作、文件预览 Tab、固定面板 Tab 不回归。
- [ ] AC5：终端 Tab 可按现有规则关闭、拖拽排序和通过右键菜单管理；右键菜单不出现自动换行，文件/差异/图片 Tab 行为不受影响。
- [ ] AC6：`pnpm --filter @ftre/renderer exec vitest run` 通过；`pnpm --filter @ftre/renderer build` 通过；`git diff --check` 无输出。

## 6. 测试计划

- Store：验证多个 PTY 对应多个终端 Tab、同一 PTY 重复激活、关闭后再次创建的状态变化。
- Inspector：验证 `+` 菜单只有终端项、选择项后打开终端 Tab，现有固定 Tab 和文件 Tab 不受影响。
- Terminal：验证嵌入模式渲染终端内容容器，已有 TerminalManager 测试保持通过。
- 手动：启动客户端，打开/关闭 Inspector，点击 `+` →“终端”，输入 `pwd`/`Get-Location`，拖动 Inspector 宽度并关闭 Tab。

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-21 | 初始定稿：将 Header 终端入口迁移至 Inspector `+` 菜单，本期只实现终端项 | 用户需求 |
| 2026-08-21 | Windows 终端启动时初始化 UTF-8 编码，PowerShell 默认文件读取改为 UTF-8，CMD 切换到 code page 65001 | 用户反馈终端中文疑似乱码 |
| 2026-08-21 | 终端 Tab 重开/Inspector 重显时按当前 Tab 精确重测量，并补充延迟和双帧 fit，避免 xterm 按隐藏容器尺寸绘制导致内容被裁切 | 用户反馈终端重新打开后内容显示不完整 |
