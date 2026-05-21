# 实施计划：主题模式切换 + Token 统一

## 概述

本计划将设计文档中的架构分解为可增量执行的编码任务。按照依赖顺序组织：先建立 Token 基础层，再实现 Theme Manager 状态管理，然后逐步迁移各子系统（CSS、Monaco、xterm、Sonner、highlight.js），最后添加 UI 入口与 lint 脚本。每个任务构建在前一步之上，确保无孤立代码。

## Tasks

- [x] 1. 创建语义化 Token 文件与向后兼容别名
  - [x] 1.1 创建 `packages/renderer/src/styles/tokens.css`
    - 按设计文档定义 `html[data-theme="dark"]` 与 `html[data-theme="light"]` 两套完整语义 Token
    - 包含 `--ftre-bg-*`、`--ftre-border-*`、`--ftre-text-*`、`--ftre-accent-*`、`--ftre-status-*`、`--ftre-selection-*`、`--ftre-scrollbar-*` 全部变量
    - dark 模式值必须与现有 `tailwind.css`、`styles.css`、`reset.css`、`global.css`、`terminal-config.ts` 中的硬编码值字节级相等
    - 文件顶部添加命名约定注释
    - _Requirements: 4.1, 4.2, 4.3, 5.1_

  - [x] 1.2 在 `tokens.css` 末尾追加向后兼容别名块
    - 以 `:root` 选择器定义所有旧变量名（`--bg-*`、`--accent`、`--ftre-accent`、`--text-*`、`--success` 等）指向新 Token
    - 每个别名标注 `/* @deprecated 使用 --ftre-xxx，将在 v0.3.0 移除 */` 注释
    - 保留非颜色变量（`--gap-*`、`--font-*`、`--radius-*`、`--titlebar-height`）不变
    - _Requirements: 4.7, 5.1_

  - [ ]* 1.3 编写 Token 完整性 property test
    - **Property P1: Token 完整性**
    - 对所有 Semantic_Token，验证 `light` 与 `dark` 下均解析为合法 CSS 颜色值
    - 使用 fast-check 生成 token 名称枚举，vitest 断言 `getComputedStyle` 返回非空
    - **Validates: Requirements 4.1, 4.2**

  - [ ]* 1.4 编写别名一致性 property test
    - **Property P9: 别名一致性**
    - 对每个旧变量别名，验证在 `light` 与 `dark` 下 `getComputedStyle` 值等于其指向的新 Token 值
    - **Validates: Requirements 4.7**

- [x] 2. 实现 Theme Manager (Zustand Store)
  - [x] 2.1 创建 `packages/renderer/src/stores/theme.ts`
    - 实现 `useTheme` Zustand store，包含 `mode`、`resolvedMode`、`setMode`、`_onSystemChange`、`init` 接口
    - `setMode` 验证合法值集合 `{ light, dark, system }`，非法值回退 `system` 并 `console.warn`
    - `setMode` 同时写入 `window.desktop.store`（异步）与 `localStorage`（`ftre-theme-mode-cache`，同步）
    - `init` 读取 IPC store → 确认/修正 mode → `applyToDOM` → 注册 `matchMedia` 监听
    - `applyToDOM` 设置 `document.documentElement.setAttribute('data-theme', resolved)`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2, 12.1, 12.2, 12.3_

  - [ ]* 2.2 编写 Mode 切换幂等与往返 property test
    - **Property P2: Mode 切换的幂等与往返**
    - 使用 fast-check 生成任意 Mode 序列，验证切回初始 Mode 后状态完全恢复
    - **Validates: Requirements 1.1, 1.3, 1.4**

  - [ ]* 2.3 编写持久化往返 property test
    - **Property P4: 持久化往返**
    - 对任意合法 Mode 写入后读取结果相等；对非法值读取后解析为 `system`
    - **Validates: Requirements 1.5, 3.1, 3.6**

  - [ ]* 2.4 编写 Theme Manager 单元测试
    - 测试默认值为 `system`
    - 测试 `setMode('light')` / `setMode('dark')` 正确更新 `resolvedMode`
    - 测试非法值回退
    - 测试 `_onSystemChange` 仅在 `mode === 'system'` 时响应
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 3. Checkpoint — 确保 Token 与 Theme Manager 测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. 首屏防闪脚本与 index.html 改造
  - [x] 4.1 修改 `packages/renderer/index.html`
    - 在 `<head>` 中 `<script type="module">` 之前插入同步内联 `<script>`
    - 脚本从 `localStorage` 读取 `ftre-theme-mode-cache`，计算 resolved mode，设置 `data-theme` 属性
    - 设置 `document.documentElement.style.backgroundColor` 为对应模式的 base 色（dark: `#1a1b1d`，light: `#ffffff`）
    - _Requirements: 3.3, 3.4_

- [x] 5. 重构 Tailwind CSS 与样式文件迁移
  - [x] 5.1 重构 `packages/renderer/src/styles/tailwind.css`
    - `@theme` 块中所有颜色值替换为 `var(--ftre-*)` Token 引用，不再包含 Color Literal
    - 移除 `:root` 块中的颜色变量定义（已由 `tokens.css` 别名覆盖）
    - 在文件顶部添加 `@import "./tokens.css";`（确保在 `@import "tailwindcss"` 之前）
    - _Requirements: 4.4, 10.1_

  - [x] 5.2 迁移 `packages/renderer/src/styles/reset.css`
    - `html, body, #root` 的 `background` 和 `color` 改用 `var(--ftre-bg-base)` / `var(--ftre-text-primary)`
    - `::selection` 改用 `var(--ftre-selection-bg)` / `var(--ftre-selection-fg)`
    - `::-webkit-scrollbar-thumb` 改用 `var(--ftre-scrollbar-thumb)` / `var(--ftre-scrollbar-thumb-hover)`
    - `a` 标签颜色改用 `var(--ftre-accent-default)`
    - _Requirements: 9.2, 10.1_

  - [x] 5.3 迁移 `packages/renderer/src/styles/global.css`
    - `.spinner` 的 `border` 和 `border-top-color` 改用 Token
    - TabBar OverlayScrollbars 的 `os-scrollbar-handle` 颜色改用 Token
    - Sonner Toast 覆盖样式中 `background`、`color` 改用 `var(--ftre-bg-elevated)` / `var(--ftre-text-*)` 等 Token
    - _Requirements: 9.3, 10.1_

  - [x] 5.4 重构 `packages/ui/src/styles.css`
    - 移除 `:root` 中所有硬编码颜色值
    - 改为从 Token 取值（通过 `var(--ftre-*)` 引用），或完全删除（由 `tokens.css` 别名覆盖）
    - _Requirements: 4.6, 10.1_

  - [x] 5.5 重构 `packages/ui/src/tailwind-preset.ts`
    - 移除所有 `var(..., #fallback)` 中的 Color Literal fallback 值
    - 仅保留 `var(--ftre-*)` 引用（无回退值，因 Token 文件保证定义）
    - _Requirements: 4.5, 10.1_

- [x] 6. Checkpoint — 确保样式迁移后应用正常渲染
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Monaco 明暗主题配对
  - [x] 7.1 创建 `packages/editor/src/ui/themes/ftre-light.ts`
    - 定义 `FtreThemeDefinition`，`base: 'vs'`，`mode: 'light'`
    - `editor.background` 从 CSS 变量 `--ftre-bg-base` 读取
    - token 规则基于 VS Code Light+ 色板，确保代码高亮与浅色外壳协调
    - _Requirements: 7.1, 7.4_

  - [x] 7.2 扩展 `FtreThemeDefinition` 类型添加 `mode` 字段
    - 在 `packages/editor/src/ui/themes/types.ts` 中添加 `mode: 'light' | 'dark'` 字段
    - 为现有 `darcula` 和 `ftre-neon` 主题添加 `mode: 'dark'`
    - _Requirements: 7.1_

  - [x] 7.3 修改 `packages/editor/src/ui/themes/index.ts`
    - 导入并注册 `ftre-light` 到 `builtinThemes`
    - 新增 `getThemeIdForMode(resolved: 'light' | 'dark'): string` 函数
    - 导出 `getThemeIdForMode`
    - _Requirements: 7.2_

  - [x] 7.4 修改 `packages/editor/src/ui/theme-registry.ts`
    - `registerFtreTheme` 支持接收 `themeId` 参数
    - 重置 `registeredThemeId` 逻辑：当传入不同 themeId 时允许重新注册
    - `cssVar` 读取 `--ftre-bg-base` 替代 `--color-base`
    - _Requirements: 7.3, 7.4_

  - [ ]* 7.5 编写 Editor 主题注册幂等 property test
    - **Property P12: Editor 主题注册幂等**
    - 连续相同 themeId 的 `registerFtreTheme` 不重复执行 `defineTheme`
    - 最终活动主题 id 与最后一次切换目标一致
    - **Validates: Requirements 7.2, 7.3**

- [x] 8. xterm 终端主题 Token 化
  - [x] 8.1 创建 `packages/renderer/src/services/terminal/terminal-theme.ts`
    - 实现 `getTerminalTheme(resolved: 'light' | 'dark'): ITheme` 工厂函数
    - 从 `getComputedStyle` 读取 `--ftre-bg-base`、`--ftre-text-primary`、`--ftre-accent-default`、`--ftre-selection-bg` 等 Token
    - ANSI 16 色按 resolved mode 返回预设映射表（dark 保持现有值，light 提供对应浅色值）
    - _Requirements: 8.1, 8.2_

  - [x] 8.2 修改 `packages/renderer/src/services/terminal/terminal-config.ts`
    - 移除硬编码 `TERM_THEME` 对象
    - `TERM_OPTIONS.theme` 改为动态调用 `getTerminalTheme`
    - _Requirements: 8.1_

  - [x] 8.3 实现 xterm 实例主题热更新
    - 在终端管理模块中订阅 `useTheme` store 的 `resolvedMode` 变化
    - 变化时遍历所有存活 xterm 实例调用 `term.options.theme = getTerminalTheme(resolved)`
    - 新建终端时使用当前 `resolvedMode` 对应主题
    - _Requirements: 8.3, 8.4, 2.5_

- [x] 9. Sonner / highlight.js / Markdown 联动
  - [x] 9.1 修改 `packages/renderer/src/app/Workbench.tsx` 中 Toaster
    - `<Toaster theme="dark">` 改为 `<Toaster theme={resolvedMode}>`
    - 从 `useTheme` store 读取 `resolvedMode`
    - _Requirements: 9.1, 2.6_

  - [x] 9.2 创建 `packages/renderer/src/lib/hljs-theme-loader.ts`
    - 实现 `setHljsTheme(resolved: 'light' | 'dark'): void`
    - 动态创建/替换 `<link id="hljs-theme-link">` 元素
    - dark → `highlight.js/styles/github-dark.min.css`，light → `highlight.js/styles/github.min.css`
    - _Requirements: 9.4, 2.7_

  - [x] 9.3 修改 `packages/renderer/src/app/main.tsx` 集成 highlight.js 切换
    - 移除静态 `import "highlight.js/styles/github-dark.min.css"`
    - 在 `useTheme.init()` 完成后调用 `setHljsTheme(resolvedMode)`
    - 订阅 `useTheme` store 变化，后续切换时调用 `setHljsTheme`
    - _Requirements: 9.4, 2.7_

  - [x] 9.4 迁移 `packages/renderer/src/styles/markdown.css` 中的颜色
    - 将所有硬编码颜色替换为 `var(--ftre-*)` Token 引用
    - _Requirements: 9.5, 10.1_

- [x] 10. 修改 main.tsx 启动时序集成 Theme Manager
  - [x] 10.1 重构 `packages/renderer/src/app/main.tsx` 初始化流程
    - 在 CSS import 列表中添加 `import "../styles/tokens.css"`（确保在 `tailwind.css` 之前）
    - 在 `registerFtreTheme` 之前调用 `await useTheme.getState().init()`
    - 使用 `getThemeIdForMode(useTheme.getState().resolvedMode)` 获取正确的 Monaco 主题 id
    - 传递 themeId 给 `registerFtreTheme(monaco, themeId)` 与 `monaco.editor.setTheme(themeId)`
    - 注册 `useTheme.subscribe` 监听后续 resolvedMode 变化，同步 Monaco 主题
    - _Requirements: 3.2, 3.5, 2.4, 2.8_

  - [ ]* 10.2 编写全栈一致性 property test
    - **Property P3: 全栈一致性**
    - 验证 Theme_Manager resolvedMode、`<html>` data-theme、Monaco 主题类别、xterm 主题类别、Sonner theme prop、hljs 样式表类别六点一致
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 12.2**

- [x] 11. Checkpoint — 确保全栈联动正常工作
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. UI 模式切换入口
  - [x] 12.1 创建主题切换下拉组件
    - 在 `packages/renderer/src/components/ThemeSwitcher.tsx` 创建组件
    - 使用 `@radix-ui/react-dropdown-menu` 实现下拉菜单
    - 三个选项：☀️ 浅色模式 / 🌙 深色模式 / 💻 跟随系统
    - 当前激活项带勾选标记
    - 按钮图标根据 `resolvedMode` 动态切换（`lucide-react` 的 `Sun` / `Moon`）
    - Tooltip 显示当前状态（如 "主题：跟随系统 (当前深色)"）
    - _Requirements: 11.1, 11.3_

  - [x] 12.2 集成到 ActivityBar
    - 在 `packages/renderer/src/app/ActivityBar.tsx` 底部区域添加 `ThemeSwitcher` 组件
    - 点击触发 `useTheme.getState().setMode(...)` 完成切换
    - _Requirements: 11.1, 11.2_

- [x] 13. 颜色字面量 Lint 脚本
  - [x] 13.1 创建 allowlist 文件 `scripts/color-literal-allowlist.json`
    - 列出允许包含 Color Literal 的文件路径
    - 包含：`tokens.css`、`darcula.ts`、`ftre-neon.ts`、`ftre-light.ts`
    - _Requirements: 10.3, 10.4_

  - [x] 13.2 创建 `scripts/lint-color-literals.mjs`
    - Node.js ESM 脚本，扫描 `packages/renderer/src/**` 与 `packages/ui/src/**`
    - 排除 `node_modules`、allowlist 中的文件
    - 匹配正则：`/#[0-9a-fA-F]{3,8}\b/`、`/rgba?\(/`、`/hsla?\(/`、`/oklch\(/`、`/color\(/`
    - 违规时输出文件路径与行号，以非零退出码退出
    - _Requirements: 10.1, 10.2, 10.5_

  - [ ]* 13.3 编写无颜色字面量 property test
    - **Property P6: 无颜色字面量**
    - 在 vitest 中调用 lint 脚本逻辑，验证扫描结果命中数为 0
    - **Validates: Requirements 10.1, 10.2**

- [x] 14. 对比度验证
  - [ ]* 14.1 编写明暗对比度 property test
    - **Property P7: 明暗对比度**
    - 对所有 `(text_role, bg_role)` 组合计算 WCAG 对比度
    - `primary` ≥ 4.5:1，`secondary` / `muted` ≥ 3:1，在 light 与 dark 下均满足
    - **Validates: Requirements 6.2, 6.3, 6.4**

- [x] 15. Final checkpoint — 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 交付
- 每个任务引用具体 Requirements 编号以确保可追溯性
- Checkpoints 确保增量验证，避免问题累积
- Property tests 验证设计文档中定义的 Correctness Properties
- dark 模式下所有 Token 值必须与现有硬编码值字节级相等，确保视觉零回归
- `tokens.css` 必须在 `tailwind.css` 之前导入，确保 `@theme` 中的 `var()` 引用可解析
