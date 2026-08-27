# PRD-D4 品牌 Logo 与应用壳视觉

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | D4 |
| 名称 | 品牌 Logo 与应用壳视觉 |
| 状态 | 开发中 |
| 创建日期 | 2026-08-27 |
| 定稿日期 | 2026-08-27 |
| 验收日期 | — |
| 关联文档 | docs/TODO.yaml D4；AGENTS.md |

## 1. 背景与目标

### 背景

当前客户端通过 `PixelLogo` 以像素字母拼出 `Ftre`。该实现是早期占位视觉，无法表达当前产品的
Agent、开发工具和可扩展能力，也不能作为稳定的品牌资产复用。LogoGenic 已生成
`ftre-fox-logo.svg`：绿色狐狸闭环轮廓、透明背景、SVG 矢量格式，适合作为应用图标。

### 目标

将绿色狐狸 SVG 作为客户端应用壳的统一 Logo，替换 TitleBar 和 LoadingScreen 中的像素文字 Logo，
保持现有菜单、窗口控制、启动错误和后端连接行为不变，并生成可供手动试用的 Windows 解包客户端。

### 非目标

- 不修改 ftre 后端、Agent Core、WebSocket/HTTP 协议或会话数据。
- 不改变 TitleBar Logo 点击后的菜单内容和行为。
- 本阶段不制作 macOS `.icns` 或应用商店品牌物料；macOS 图标作为后续独立阶段。
- 不调整全局颜色 Token、字体、布局或聊天业务组件。

## 2. 需求范围

### 2.1 功能需求

- [ ] FR1：将 `outputs/ftre-fox-logo.svg` 纳入 `packages/renderer/src/assets/`，构建时由 Vite 打包，
  禁止通过网络 URL 加载。
- [ ] FR2：新增 `FtreLogo` 组件，接受现有调用方使用的 `size` 参数，按 SVG 原始比例渲染，提供可访问的
  `alt` 文本，不引入新的运行时状态。
- [ ] FR3：`TitleBar` 使用 `FtreLogo`，保留 Logo 菜单的点击、外部点击关闭和拖拽区域边界。
- [ ] FR4：`LoadingScreen` 使用 `FtreLogo`，错误状态仍显示错误图标，启动/重连/日志展开行为保持不变。
- [ ] FR5：删除不再使用的 `PixelLogo` 实现和引用，避免两套品牌 Logo 并存。
- [x] FR6：Windows 自包含包必须把 ftre `packages/*/src` 中带有 `pyproject.toml` 的本地 Package
  源码复制到 `resources/backend/server`，至少包含 `ftre_llm`、`ftre_agent_runtime`、`ftre_inbox`
  和 `ftre_compaction`；复制过程跳过 `__pycache__`、`.pyc`、`.git` 和 `.egg-info`，不依赖这些包已发布到 PyPI。
- [x] FR7：将狐狸 Logo 导出为多尺寸 `packages/electron/assets/ftre.ico`，并同时配置 BrowserWindow
  `icon` 与 electron-builder 的 `build.win.icon`，确保 Windows 窗口、任务栏和生成的 exe 使用同一图标。

### 2.2 非功能需求

- 视觉：透明背景、绿色狐狸图形，不附加文字、不改变页面背景。
- 可用性：在 TitleBar 小尺寸和 LoadingScreen 大尺寸均清晰可辨；Logo 不阻塞按钮点击。
- 构建：资源可进入 renderer dist 和 Electron 解包目录；不引入外部网络依赖。
- 工程卫生：新增资源与组件有清晰命名；不产生缓存、临时文件或未追踪构建中间物。

## 3. 技术方案

### 3.1 文件与职责

```text
packages/renderer/src/
├─ assets/ftre-fox-logo.svg       # 品牌源文件，透明 SVG
├─ components/FtreLogo.tsx        # 统一渲染组件，处理尺寸与可访问属性
├─ app/TitleBar.tsx                # 应用壳顶部 Logo 菜单
└─ app/LoadingScreen.tsx            # 后端启动/重连 Logo

packages/electron/
├─ assets/ftre.ico                  # Windows 窗口/任务栏/EXE 图标
└─ src/window.ts                    # BrowserWindow icon 接线

scripts/
└─ bundle-backend.js                # 自包含包的本地 Package 源码收集
```

组件通过静态 import 获取 Vite 资源 URL，不在组件中复制 SVG path，也不保留旧像素字母矩阵。
`size` 继续使用现有调用方的数值约定，仅映射到组件的显示尺寸；SVG 的 `viewBox` 负责保持比例。

### 3.2 兼容边界

- Logo 菜单仍由 `TitleBar` 拥有，`FtreLogo` 只负责图形渲染。
- LoadingScreen 的错误态不复用 Logo，避免错误颜色掩盖错误含义。
- Windows 使用独立 ICO 是因为操作系统任务栏和 exe 图标不读取 renderer 内的 SVG；macOS `.icns` 不在本阶段范围内。
- 自包含包的后端源码来自构建机上已验证的 ftre 仓库路径；运行时不联网安装 ftre 自有 Package，避免
  `ftre_llm` 等内部模块因未发布或缓存命中而缺失。

## 4. 接口定义

```tsx
type FtreLogoProps = {
  /** 与旧 PixelLogo 调用保持一致；数值越大，图标越大。 */
  size?: number;
  className?: string;
};

export function FtreLogo({ size = 2, className }: FtreLogoProps): JSX.Element;
```

组件输出一个带 `role="img"`、`aria-label="Ftre"` 的静态图片元素。资源加载失败时由浏览器的
替代文本保证可识别，不添加额外的 fallback 图形。

## 5. 验收标准

- [ ] AC1：`rg "PixelLogo" packages/renderer/src` 无生产代码引用，只有本阶段删除记录（若有）。
- [ ] AC2：TitleBar Logo 菜单可正常打开、悬停子菜单、点击外部关闭，窗口控制不回归。
- [ ] AC3：LoadingScreen 在启动、重连、错误三种状态下均显示正确内容，错误图标不被 Logo 替换。
- [ ] AC4：`pnpm --filter @ftre/renderer test` 通过，新增 FtreLogo 测试覆盖尺寸、alt 和资源渲染。
- [ ] AC5：`pnpm build`、`pnpm run pack:full` 通过，`release/ftre-logo-test-v3/win-unpacked/` 中客户端可以启动并看到狐狸 Logo。
- [ ] AC6：`pnpm exec tsc --noEmit`（或仓库等价类型检查）和 `git diff --check` 通过。
- [x] AC7：使用 full 配置构建后，`release/ftre-logo-test-v2/win-unpacked/resources/backend/server/`
  中存在 `ftre_llm`、`ftre_agent_runtime`、`ftre_inbox` 和 `ftre_compaction`，并且内置 Python 可导入
  `ftre_llm`；启动日志不再出现 `ModuleNotFoundError: No module named 'ftre_llm'`。
- [x] AC8：`release/ftre-logo-test-v3/win-unpacked/ftre.exe` 的 Windows 图标来自 `ftre.ico`，
  `packages/electron/dist` 构建成功且未设置无效图标路径；运行时窗口 icon 指向同一资源。

## 6. 测试计划

- 单元测试：渲染默认/自定义尺寸，断言 `role`、`aria-label` 和静态资源 src；确认 TitleBar/LoadingScreen
  仍可挂载。
- 构建测试：先构建 renderer，再构建 Electron，检查 dist 中包含 SVG 资源。
- 手动测试：启动解包客户端，确认 TitleBar 左上角和 LoadingScreen 中显示绿色狐狸；点击 Logo 菜单，
  验证原有菜单交互不变。

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-27 | 初始 PRD 定稿；采用 `outputs/ftre-fox-logo.svg` 作为客户端 Logo，暂不变更安装器图标 | 先验证应用壳视觉，避免把品牌资源和安装器平台物料混在同一阶段 |
| 2026-08-27 | 根据 full 包启动失败补充 FR6/AC7：打包时复制仓内 Package 源码 | ftre 自有 Package 尚未全部作为 PyPI 发行物，不能只依赖 pip 依赖解析 |
| 2026-08-27 | 修复 `bundle-backend.js`，并通过嵌入式 Python 导入测试与 11 项 Electron 平台测试 | 原 full 包缺少 `ftre_llm` 等仓内 Package，导致 Gateway 启动后连续崩溃 |
| 2026-08-27 | 根据 Windows 状态栏反馈补充 FR7/AC8：加入 ICO 并接入 BrowserWindow/electron-builder | renderer SVG 不会自动改变 Windows 任务栏和 exe 图标 |
| 2026-08-27 | 按仓库门禁整理提交：FtreLogo 组件、ICO 接线与 PRD/TODO 一并落地 | 提交分组符合 feat 必须同步 PRD 变更记录的 hook 要求 |
