# Requirements Document

## Introduction

本规格描述 `ftre-desktop`（Electron 桌面客户端）的「主题模式切换 + CSS 颜色 Token 统一与规范化」特性。范围限定在 monorepo 中的渲染端与共享组件包：`packages/renderer`、`packages/ui`、`packages/editor`、`packages/electron`（仅持久化通道）。

特性包含三条主线：

1. **主题模式切换**：在保留现有暗色视觉作为 `dark` 基线的前提下，引入 `light`、`dark`、`system` 三种模式；切换在运行时即时生效，覆盖应用外壳、`@ftre/ui`、Monaco 编辑器、xterm 终端、Sonner Toaster、`highlight.js`、Markdown 视图、滚动条与文本选区。
2. **Token 统一**：消除 `--color-*`、`--bg-*`、`--text-*`、`--ftre-*`、`--accent*`、`--success/warning/error/info` 等多套并行 palette，建立唯一的语义化 Token 层（明/暗双值），由 Tailwind v4 `@theme` 与 `@ftre/ui` tailwind preset 共同引用。
3. **CSS 规范化**：迁移 `reset.css`、`global.css`、`terminal-config.ts`、Sonner 覆盖样式以及任何硬编码颜色字面量到 Token；提供机制（lint 或文档化规则 + 校验）防止再次引入。

本规格定义验收标准和可测属性，具体实现路径与 UI 形态留给后续 Design 阶段。

## Glossary

- **Renderer_App**：渲染进程主应用，对应 `packages/renderer`，入口 `packages/renderer/src/app/main.tsx`。
- **UI_Library**：共享组件库 `@ftre/ui`，对应 `packages/ui`，导出 `styles.css` 与 `tailwind-preset.ts`。
- **Editor_Package**：Monaco 封装包 `@ftre/editor`，对应 `packages/editor`，包含 `theme-registry.ts`、`themes/{darcula,ftre-neon}.ts`。
- **Electron_Main**：Electron 主进程，对应 `packages/electron`，提供 `window.desktop.store` 持久化通道。
- **Theme_Manager**：本特性新增的模块，统一负责模式状态、应用 DOM 标记、广播变更、与 Monaco/xterm/Sonner/highlight.js 同步、与持久化通道交互。
- **Token_System**：唯一来源的语义化 CSS 自定义属性集合，定义于单一规范文件，按 `light` 与 `dark` 两套值组织。
- **Mode**：取值为 `light`、`dark`、`system` 之一的字符串。`system` 表示跟随操作系统 `prefers-color-scheme`。
- **Resolved_Mode**：将 `system` 解析后得到的具体模式，取值为 `light` 或 `dark`。
- **Semantic_Token**：Token_System 中的命名条目，例如 `background.surface`、`text.primary`、`accent.default`、`status.error`。每个 Semantic_Token 在 `light` 与 `dark` 下各有一个值。
- **Color_Literal**：CSS 或 TS/TSX 源码中以 `#rgb`、`#rrggbb`、`#rrggbbaa`、`rgb(...)`、`rgba(...)`、`hsl(...)`、`hsla(...)`、`oklch(...)`、`color(...)` 形式直接出现的颜色值。
- **Token_File**：Token_System 的唯一定义文件（具体路径在 Design 阶段确定），是允许声明 Color_Literal 的源头位置。
- **Allowlist**：用于豁免 Color_Literal 检查的源文件集合（如 `highlight.js` 第三方主题样式表），需在仓库内显式声明。
- **Theme_Mode_Storage_Key**：持久化主题模式所用的存储键名，写入 `window.desktop.store`。

## Requirements

### Requirement 1：模式三态与默认值

**User Story:** 作为桌面端用户，我希望可以在 light、dark、system 之间切换主题，以便贴合自己的偏好与系统环境。

#### Acceptance Criteria

1. THE Theme_Manager SHALL 支持取值集合 `{ "light", "dark", "system" }` 作为唯一合法的 Mode 值。
2. WHEN Renderer_App 启动且没有任何持久化偏好，THE Theme_Manager SHALL 将默认 Mode 设为 `system`。
3. WHEN Mode 为 `system`，THE Theme_Manager SHALL 通过 `window.matchMedia("(prefers-color-scheme: dark)")` 推导 Resolved_Mode。
4. WHEN Mode 为 `light` 或 `dark`，THE Theme_Manager SHALL 将 Resolved_Mode 设为该值，忽略系统偏好。
5. IF 持久化层读出的值不属于合法集合，THEN THE Theme_Manager SHALL 回退到 `system`，并以警告级日志记录被拒绝的值。

### Requirement 2：运行时切换与全栈联动

**User Story:** 作为用户，我希望切换模式后整个应用立即统一变化，不留下旧主题的「孤岛」。

#### Acceptance Criteria

1. WHEN 用户触发模式切换，THE Theme_Manager SHALL 在同一帧内更新 `<html>` 上的模式标记属性（具体属性名在 Design 阶段确定）。
2. WHEN Resolved_Mode 发生变更，THE Renderer_App SHALL 使应用外壳、滚动条、文本选区颜色均反映新的 Resolved_Mode。
3. WHEN Resolved_Mode 发生变更，THE UI_Library SHALL 使所有基于 `--ftre-*` 系列变量渲染的组件立即反映新的 Resolved_Mode。
4. WHEN Resolved_Mode 发生变更，THE Editor_Package SHALL 调用 `registerFtreTheme` 与 `monaco.editor.setTheme` 将活动主题切换为对应 Resolved_Mode 的 Monaco 主题。
5. WHEN Resolved_Mode 发生变更，THE Renderer_App SHALL 将 xterm 实例的 theme 更新为对应 Resolved_Mode 的终端配色。
6. WHEN Resolved_Mode 发生变更，THE Renderer_App SHALL 将 Sonner `<Toaster>` 的 `theme` 属性更新为 Resolved_Mode。
7. WHEN Resolved_Mode 发生变更，THE Renderer_App SHALL 切换 `highlight.js` 的明/暗样式表（dark 模式使用 `github-dark`，light 模式使用 `github`，或等效配对）。
8. WHEN Mode 为 `system` 且操作系统 `prefers-color-scheme` 发生改变，THE Theme_Manager SHALL 在不需要用户交互的前提下重新派发与上述各子系统对应的更新。
9. IF Monaco 已实例化的 DiffEditor 在主题切换过程中尚存活，THEN THE Editor_Package SHALL 保证切换不抛出异常且不破坏 DiffEditor 状态。

### Requirement 3：持久化与首屏无闪烁

**User Story:** 作为用户，我希望我选择的模式在重启应用后保留，并且启动时不会先闪一下错误的颜色。

#### Acceptance Criteria

1. WHEN 用户将 Mode 设为非默认值，THE Theme_Manager SHALL 通过 `window.desktop.store` 以 Theme_Mode_Storage_Key 持久化该值。
2. WHEN Renderer_App 启动，THE Theme_Manager SHALL 在 React 渲染之前读取持久化的 Mode 并完成首次 Resolved_Mode 计算。
3. WHEN Renderer_App 启动，THE Theme_Manager SHALL 在挂载第一个像素之前将对应 Resolved_Mode 的模式标记写入 `<html>`。
4. THE Renderer_App SHALL 保证首次绘制使用的背景与文字颜色与 Resolved_Mode 一致，不出现「先白后黑」或「先黑后白」的闪烁。
5. WHEN Renderer_App 启动且 Resolved_Mode 已确定，THE Editor_Package SHALL 在 `createRoot(...).render(...)` 之前完成与 Resolved_Mode 一致的 Monaco 主题注册与激活，沿用现有「`registerFtreTheme` + `setTheme` 早于 React 渲染」的策略。
6. IF 持久化读取失败（IPC 异常或键不存在），THEN THE Theme_Manager SHALL 静默回退到 `system`，并继续完成首屏初始化。

### Requirement 4：语义化 Token 唯一来源

**User Story:** 作为开发者，我希望颜色定义只有一处来源，不必在多个文件之间猜测「应该用哪个变量」。

#### Acceptance Criteria

1. THE Token_System SHALL 在 Token_File 中以语义角色组织 Semantic_Token，至少覆盖以下角色族：
   - `background`：`base`、`surface`、`elevated`、`panel`、`menu`
   - `border`：`default`、`subtle`
   - `text`：`primary`、`secondary`、`muted`、`dim`、`ghost`、`faint`
   - `accent`：`default`、`hover`、`dim`、`ghost`
   - `status`：`success`、`warning`、`error`、`info`、`danger`
   - `selection`：`background`、`foreground`
   - `scrollbar`：`thumb`、`thumb-hover`、`track`
2. THE Token_System SHALL 为每个 Semantic_Token 同时定义 `light` 与 `dark` 两个值。
3. THE Token_System SHALL 采用统一的命名约定（具体语法在 Design 阶段确定，例如 `--ftre-bg-surface` 或 `--ftre-color-bg-surface`），并将该约定写入 Token_File 顶部注释。
4. THE Renderer_App 的 Tailwind v4 `@theme` 块 SHALL 仅引用 Token_System 的 Semantic_Token，不再直接出现 Color_Literal。
5. THE UI_Library 的 `tailwind-preset.ts` SHALL 仅引用 Token_System 的 Semantic_Token，不再以 Color_Literal 作为 `var(..., fallback)` 的回退值。
6. THE UI_Library 的 `styles.css` SHALL 不再独立维护 `--ftre-*` 的具体颜色值，而是从 Token_System 取值或被 Token_System 覆盖。
7. WHERE 出于过渡兼容需要保留旧变量名（如 `--bg-*`、`--accent`、`--ftre-accent` 等），THE Token_System SHALL 以「指向新 Token 的别名」形式提供，且每个别名 SHALL 标注弃用注释与移除时机。

### Requirement 5：暗色基线视觉等价

**User Story:** 作为现有用户，我希望升级到新版本后暗色模式看起来和现在完全一样。

#### Acceptance Criteria

1. WHEN Resolved_Mode 为 `dark`，THE Token_System SHALL 使每一个旧 palette 中存在对应项的 Semantic_Token 解析为与升级前在 `tailwind.css`、`packages/ui/src/styles.css`、`reset.css`、`global.css`、`terminal-config.ts` 中实际生效的值一致的颜色（按 sRGB 字节级相等或视觉等价的等效写法）。
2. WHEN Resolved_Mode 为 `dark`，THE Renderer_App SHALL 在主要界面（标题栏、活动栏、侧边栏、编辑器外壳、终端、Toast）上不出现新增的颜色差异。
3. THE Editor_Package 的 `darcula` 与 `ftre-neon` 主题 SHALL 继续作为 `dark` 模式下可选的 Monaco 主题，且在 Token 重构后行为不变。

### Requirement 6：明色模式可用性与对比度

**User Story:** 作为白天工作的用户，我希望 light 模式下文字清晰、强调色不刺眼。

#### Acceptance Criteria

1. THE Token_System SHALL 为 `light` 模式定义与 `dark` 模式一一对应的全部 Semantic_Token 值。
2. WHEN Resolved_Mode 为 `light`，THE Token_System SHALL 使 `text.primary` 在 `background.base`、`background.surface`、`background.elevated`、`background.panel` 之上的 WCAG 对比度均 ≥ 4.5:1。
3. WHEN Resolved_Mode 为 `light`，THE Token_System SHALL 使 `text.secondary` 与 `text.muted` 在上述背景之上的对比度均 ≥ 3:1。
4. WHEN Resolved_Mode 为 `dark`，THE Token_System SHALL 满足与 6.2、6.3 相同的对比度阈值。
5. WHEN Resolved_Mode 为 `light`，THE Token_System SHALL 使 `accent.default` 不与 `background.surface` 形成可触发用户视觉不适的高饱和高反差组合（具体度量在 Design 阶段以可计算指标定义，例如限制饱和度上限或要求对比度处于 [3:1, 12:1] 区间）。

### Requirement 7：Monaco 明暗主题配对

**User Story:** 作为编辑器用户，我希望在 light 模式下编辑器也是浅色，且代码高亮与外壳风格协调。

#### Acceptance Criteria

1. THE Editor_Package SHALL 至少注册一个 `dark` 模式 Monaco 主题与一个 `light` 模式 Monaco 主题。
2. WHEN Resolved_Mode 切换，THE Editor_Package SHALL 通过 `getActiveThemeId()` 与 `setActiveThemeId()` 暴露当前激活的 Monaco 主题 id，以便 Theme_Manager 同步。
3. THE Editor_Package SHALL 使 `editor.background` 等仍依赖 CSS 变量的 Monaco 颜色项继续从 Token_System 读取，而非硬编码。
4. WHEN Resolved_Mode 为 `light`，THE Editor_Package SHALL 使 Monaco 编辑区背景与 `background.base` 在 light 下的取值一致。

### Requirement 8：终端主题 Token 化

**User Story:** 作为终端使用者，我希望终端配色随主题模式联动，并且不要硬编码。

#### Acceptance Criteria

1. THE Renderer_App 的 `terminal-config.ts` SHALL 不再以 Color_Literal 直接定义 `TERM_THEME` 各字段。
2. THE Renderer_App SHALL 提供一个从 Token_System 派生 xterm 主题对象的工厂函数（具体签名在 Design 阶段确定）。
3. WHEN Resolved_Mode 切换，THE Renderer_App SHALL 对所有已存活的 xterm 实例应用新 Resolved_Mode 对应的主题对象。
4. WHEN 创建新的 xterm 实例，THE Renderer_App SHALL 使用当前 Resolved_Mode 对应的主题对象。

### Requirement 9：Toaster、滚动条、选区与高亮联动

**User Story:** 作为用户，我希望 Toast、滚动条、选中文字与代码高亮在切换模式后立刻一致。

#### Acceptance Criteria

1. THE Renderer_App SHALL 使 `<Toaster>` 的 `theme` prop 由 Theme_Manager 提供，且取值为当前 Resolved_Mode（`light` 或 `dark`），不再硬编码 `"dark"`。
2. THE Renderer_App SHALL 使 `reset.css` 中的滚动条与 `::selection` 颜色全部通过 Token_System 取值。
3. THE Renderer_App SHALL 使 `global.css` 中 sonner 覆盖样式涉及的颜色（背景、关闭按钮等）全部通过 Token_System 取值。
4. WHEN Resolved_Mode 切换，THE Renderer_App SHALL 使 `highlight.js` 加载的样式表与 Resolved_Mode 一致：`dark` → `github-dark`（或等价深色），`light` → `github`（或等价浅色）。
5. THE Renderer_App SHALL 使 Markdown 视图（`markdown.css`）中涉及的颜色全部通过 Token_System 取值。

### Requirement 10：禁止硬编码颜色（含校验）

**User Story:** 作为维护者，我希望仓库不会再因为「随手写了个 `#fff`」而破坏主题。

#### Acceptance Criteria

1. THE Renderer_App 与 UI_Library 的源码 SHALL 不出现 Color_Literal，仅 Token_File 与 Allowlist 中显式声明的文件除外。
2. THE Renderer_App SHALL 提供一个可在 CI 与本地手动运行的检查脚本，扫描 `packages/renderer/src/**` 与 `packages/ui/src/**`，对违反 10.1 的文件输出失败结果。
3. THE Allowlist SHALL 以仓库内的可读文件形式存在（具体格式在 Design 阶段确定），并在 PR 审查中可见。
4. WHEN 检查脚本运行于 Token 重构完成后的代码库，THE Allowlist SHALL 仅包含确有正当理由的条目（例如 `highlight.js` 第三方主题样式表、`darcula`/`ftre-neon` Monaco token 规则中按 Monaco 协议必须使用的字面量）。
5. IF 检查脚本检测到非 Allowlist 文件包含 Color_Literal，THEN THE 检查脚本 SHALL 以非零退出码结束并打印每个匹配的文件路径与行号。

### Requirement 11：模式切换入口

**User Story:** 作为用户，我希望能够在客户端内方便地找到切换主题的开关。

#### Acceptance Criteria

1. THE Renderer_App SHALL 提供一个用户可见的控件用于在 `light`、`dark`、`system` 三种 Mode 之间切换（位置与形态在 Design 阶段确定，候选包括 TitleBar、ActivityBar 或独立设置面板）。
2. WHEN 用户通过该控件提交新 Mode，THE Theme_Manager SHALL 应用新 Mode 并触发 Requirement 2 与 Requirement 3 中描述的更新。
3. THE Renderer_App SHALL 在该控件上以可读形式展示当前 Mode（含 `system` 状态下的 Resolved_Mode 提示）。

### Requirement 12：可观测的运行时状态

**User Story:** 作为开发者与测试，我希望可以从代码层面断言「现在到底是哪个主题在生效」。

#### Acceptance Criteria

1. THE Theme_Manager SHALL 暴露一个只读 API 返回当前 Mode 与 Resolved_Mode（具体形式 — Hook、Store selector 或函数 — 在 Design 阶段确定）。
2. WHEN Resolved_Mode 已确定，THE Renderer_App SHALL 在 `<html>` 上设置一个由 Theme_Manager 拥有的标记属性，其值与 Resolved_Mode 严格一致。
3. THE Theme_Manager SHALL 暴露一个订阅机制，使 Editor_Package、xterm、Sonner 包装层、`highlight.js` 加载器可以在 Resolved_Mode 变更时同步更新。

## Correctness Properties

以下属性为后续 Design 与 Tasks 阶段的「基于属性的测试（PBT）」与集成测试种子。每条性质标注其建议的测试形式（property / example / edge-case / integration）。

### P1 — Token 完整性（property）

对所有 Semantic_Token `t`，`Token_System.resolve(t, "light")` 与 `Token_System.resolve(t, "dark")` 均返回非空字符串，且字符串可被浏览器解析为合法 CSS 颜色（例如通过临时 `CSSStyleValue.parse('color', value)` 或 `getComputedStyle` 验证）。

### P2 — Mode 切换的幂等与往返（property）

对任意 Mode 序列 `m1, m2, ..., mn`（取自 `{ light, dark, system }`），从初始 Mode `m0` 出发依次切换并最终切回 `m0`，Theme_Manager 暴露的 Mode、Resolved_Mode、`<html>` 标记属性、Monaco 活动主题 id、xterm 主题对象、Sonner `theme` 值、`highlight.js` 当前样式表名 SHALL 与起始状态相等。

### P3 — 全栈一致性（property）

在任意时刻，下列六个观测点的「当前模式」必须互相一致（取值集合 `{ light, dark }`）：
1. Theme_Manager.getResolvedMode()
2. `<html>` 上的模式标记属性
3. `monaco.editor` 当前主题 id 所属的明/暗类别
4. 已存活 xterm 实例的主题对象类别
5. Sonner `<Toaster>` 当前 `theme` prop
6. 当前已加载的 `highlight.js` 样式表所属类别

### P4 — 持久化往返（property）

对任意合法 Mode `m`，写入持久化层后再读取，结果 SHALL 等于 `m`。对任意非法值，读取后 Theme_Manager 解析得到的 Mode SHALL 等于 `system`。

### P5 — 系统偏好响应（example + integration）

模拟 `prefers-color-scheme` 在 dark/light 之间切换至少一次，当且仅当 Mode 为 `system` 时，Resolved_Mode 与 P3 中六个观测点 SHALL 随之改变；当 Mode 为 `light` 或 `dark` 时，所有观测点 SHALL 保持不变。

### P6 — 无颜色字面量（property）

扫描 `packages/renderer/src/**` 与 `packages/ui/src/**` 的全部源文件，排除 Token_File 与 Allowlist，匹配 Color_Literal 正则集合（覆盖 `#3/4/6/8 位 hex`、`rgb`、`rgba`、`hsl`、`hsla`、`oklch`、`color()`），命中数 SHALL 为 0。

### P7 — 明暗对比度（property）

对所有 `(text_role, bg_role)` 组合，其中 `text_role ∈ { primary, secondary, muted }`、`bg_role ∈ { base, surface, elevated, panel }`：
- `primary` 对所有 `bg_role` 在 `light` 与 `dark` 下 WCAG 对比度均 ≥ 4.5:1。
- `secondary` 与 `muted` 对所有 `bg_role` 在 `light` 与 `dark` 下 WCAG 对比度均 ≥ 3:1。

### P8 — 暗色等价（example）

对升级前实际生效的、在 `tailwind.css` / `packages/ui/src/styles.css` / `reset.css` / `global.css` / `terminal-config.ts` 中可枚举的硬编码颜色，存在到 Semantic_Token 的映射，且在 `dark` 下解析回的颜色与原值在 sRGB 字节级相等（或经透明度归一后相等）。

### P9 — 别名一致性（property）

对 Requirement 4.7 中保留的每个旧变量别名 `a`（例如 `--bg-base`、`--accent`、`--ftre-accent`），在任意 Resolved_Mode 下 `getComputedStyle(document.documentElement).getPropertyValue(a)` SHALL 等于其指向的 Semantic_Token 在该 Mode 下的解析值。

### P10 — 首屏无闪烁（example / edge-case）

在自动化场景下：
- 设置持久化 Mode 为 `light`，重启应用，截取首帧背景平均亮度 ≥ 阈值 L（在 Design 阶段确定）。
- 设置持久化 Mode 为 `dark`，重启应用，截取首帧背景平均亮度 ≤ 阈值 D。
- 设置 Mode 为 `system` 且 OS 为 light，重启应用，首帧亮度 ≥ L。

### P11 — DiffEditor 健壮性（edge-case）

在 Monaco DiffEditor 已挂载的状态下连续触发 N（≥ 5）次 Mode 切换，控制台 SHALL 不出现新的未处理异常（不计入 main.tsx 中已抑制的 `TextModel got disposed before DiffEditorWidget model got reset` 已知问题）。

### P12 — Editor 主题注册幂等（property）

对任意 Mode 切换序列，`registerFtreTheme(monaco, themeIdForMode(resolved))` 调用次数与 Mode 变更次数同阶；连续两次相同 themeId 的 `registerFtreTheme` 调用 SHALL 不重复执行 `defineTheme`（沿用现有 `registeredThemeId` 短路逻辑），且最终 `monaco.editor` 活动主题 id 与最后一次切换目标一致。

## Out of Scope

- `ftre/` 与 `ftre-agent-core/` 中的 Python 后端：本特性不修改其代码、配置或行为。
- 高对比度主题、护眼主题、自定义主题导入等扩展形态：留作后续特性，本特性仅交付 `light`/`dark`/`system` 三态。
- 视觉重设计：现有暗色界面是 `dark` 模式的视觉基线，本特性不改变品牌色（霓虹绿）与版式。
- 通过 Electron 原生菜单/系统托盘暴露切换入口：可选，由 Design 阶段决定，不作为强制要求。
- 对 `node_modules` 内第三方样式表（`overlayscrollbars`、`sonner`、`highlight.js` 自带主题等）的源代码改造：仅通过覆盖样式或样式表替换实现联动。
