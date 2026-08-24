# PRD-A1-Electron 脚手架

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | A1 |
| 名称 | Electron 脚手架 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-12 |
| 定稿日期 | 2026-08-12 |
| 验收日期 | 2026-08-21 |
| 关联文档 | docs/TODO.yaml 阶段 A1；AGENTS.md |

## 1. 背景与目标

- **背景**：ftre 需要一个桌面客户端来承载 agent 会话交互，基于 Electron + React 构建，需要在一开始搭好 pnpm workspace 多包结构与主进程/渲染进程分离的骨架。
- **目标**：`pnpm dev` 一条命令拉起 Electron 窗口 + React 渲染进程，IPC bridge 可用，开发与打包两种模式下内嵌 Python 后端 spawn 逻辑均可用。
- **非目标**：不实现具体业务界面（聊天、文件树等后续阶段再做）；不做安装包分发。

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：Electron 主进程窗口管理（创建 BrowserWindow、加载 Vite dev server 或打包产物、窗口生命周期处理）
- [x] FR2：preload IPC bridge（contextBridge 暴露受控 API 给渲染进程）
- [x] FR3：React + Vite 开发与构建链路（dev server、HMR、生产构建）
- [x] FR4：pnpm workspace 多包结构（packages/electron、packages/renderer、packages/shared、packages/ui）
- [x] FR5：内嵌 Python 后端 spawn（开发模式与打包模式分别定位后端入口并拉起进程）
- [x] FR6：renderer 入口声明不含 `unsafe-eval` 的 Content-Security-Policy，开发模式与打包模式均覆盖脚本、样式、图片、字体、HTTP/API 与 WebSocket 连接。

### 2.2 非功能需求

- 性能：启动时间可接受，窗口秒开
- 安全：渲染进程通过 preload 白名单访问 IPC，不直接暴露 Node API
- 兼容性：Windows / macOS / Linux 均可运行

## 3. 技术方案

- 模块设计：
  - `packages/electron/src/main.ts`：应用入口，创建窗口与后端进程
  - `packages/electron/src/preload.ts`：contextBridge 暴露 IPC API
  - `packages/electron/src/window.ts`：BrowserWindow 创建与生命周期管理
  - `packages/electron/src/backend.ts`：内嵌 Python 后端 spawn（dev / 打包双模式）
  - `packages/renderer/`：Vite + React 应用
  - `packages/shared/`：主进程与渲染进程共享的类型定义
  - `packages/ui/`：基础 UI 组件库
- 依赖选型：electron、vite、react、pnpm workspace

## 4. 接口定义

- preload 暴露 `window.api`（具体 IPC channel 在 B1 阶段扩展）
- 后端 spawn 统一返回端口/地址供渲染进程连接

## 5. 验收标准

- [x] AC1：执行 `pnpm dev` 可启动，Electron 窗口正常显示
- [x] AC2：渲染进程到主进程的 IPC 通信正常（ping/pong 验证）
- [x] AC3：打包模式下后端 spawn 正常，后端服务可用
- [x] AC4：开发模式和打包模式加载 renderer 后，HTML/响应策略含有效 CSP；CSP 不含 `unsafe-eval`，页面可正常执行主题初始化、静态资源加载与 Gateway HTTP/WebSocket 连接。

## 6. 测试计划

- 手动验证：`pnpm dev` 启动、窗口显示、IPC 往返、打包模式后端拉起

## 8. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-12 | 初始定稿 | — |
| 2026-08-21 | 状态回到开发中；补充开发环境/打包 renderer CSP 的安全验收要求，关联 PRD-A2-console-warnings.md 的 FR3-FR4 与 AC4-AC5 | Electron renderer 开发模式出现 Insecure Content-Security-Policy 警告，需要补齐窗口安全基线并重新验收 A1 |
| 2026-08-21 | 已验收（AC1-AC4 重跑通过）：renderer index.html 声明 CSP meta（无 unsafe-eval）；开发模式主进程为 Vite 主文档响应注入 CSP 头；vite preview + 浏览器验证页面可加载、主题 inline 脚本可执行、无 CSP 违规；electron/renderer 构建通过，全量测试失败集合与改动前基线一致（无回归）。仅真实 `pnpm dev` 的 Electron 控制台观察需在用户环境确认 | 对照 AC 验收留痕 |
| 2026-08-23 | 修复 Windows Vite 依赖优化缓存被锁导致 renderer 进程退出：开发脚本使用 `--force` 重优化，并在 Electron 启动前等待 renderer/electron 产物就绪 | Vite 退出后 Electron 仍保留旧页面，所有模块请求变为 `ERR_CONNECTION_REFUSED`，LoadingScreen 无法恢复 | AC1、AC4 |
