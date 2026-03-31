# Monorepo 架构重构

> **目标：** 将单体项目重构为 pnpm workspaces Monorepo，拆分为 3 个独立包（shared、electron、renderer），降低耦合度，明确模块边界。

## 简介

当前项目是一个 Electron + React 桌面应用（AI IDE），代码组织为单体结构。存在以下问题：

1. **main.js 臃肿**（600+ 行）—— 混合了窗口管理、Python 后端生命周期、文件系统 IPC、终端 PTY、文件监听等逻辑
2. **IPC 层分散** —— 部分在 main.js，部分在 ipc/ 目录，没有统一的组织方式
3. **类型定义重复** —— `src/types/desktop.d.ts` 和 `src/types/index.ts` 存在重复定义
4. **耦合度高** —— 前端和 Electron 主进程代码在同一个 package.json 下，依赖混在一起

通过 Monorepo 重构，实现：

- IPC 层独立设计、独立测试
- React 前端专注 UI 逻辑
- 共享类型集中管理，两端复用

## 术语表

- **shared 包**：`@ftre/shared`，存放 IPC 接口类型定义、共享 DTO
- **electron 包**：`@ftre/electron`，Electron 主进程 + preload + IPC 实现
- **renderer 包**：`@ftre/renderer`，React 前端应用

## 需求

### 需求 1：拆分为 pnpm workspaces Monorepo

**用户故事：** 作为开发者，我希望项目采用 Monorepo 架构，以便各模块独立管理、边界清晰。

#### 验收标准

1. WHEN 执行 `pnpm install`，THE 根目录 SHALL 安装所有 3 个包的依赖
2. WHEN 包 A 依赖包 B（如 `@ftre/electron` 依赖 `@ftre/shared`），THE pnpm SHALL 通过 workspace 协议自动软链接
3. WHEN 修改 `@ftre/shared` 的代码并编译，THE `@ftre/electron` 和 `@ftre/renderer` SHALL 能立即引用到新代码

### 需求 2：shared 包 —— 共享类型

**用户故事：** 作为开发者，我希望 IPC 接口类型集中定义在一个包里，以便前端和主进程共享同一份类型，避免重复和不一致。

#### 验收标准

1. THE `@ftre/shared` 包 SHALL 包含所有 IPC 接口类型定义（DesktopAPI、DesktopFS、DesktopGit、DesktopTerminal 等）
2. THE `@ftre/shared` 包 SHALL 使用 tsc 编译为 dist 目录，产出 `.js` 和 `.d.ts` 文件
3. WHEN 开发模式运行 `pnpm dev`，THE `@ftre/shared` SHALL 以 watch 模式运行 tsc，自动重新编译

### 需求 3：electron 包 —— 主进程 + IPC

**用户故事：** 作为开发者，我希望 Electron 主进程和 IPC 层作为独立包管理，以便单独设计、测试和维护。

#### 验收标准

1. THE `@ftre/electron` 包 SHALL 包含：main.ts、preload.ts、ipc/ 模块
2. THE 现有 main.js 的功能 SHALL 拆分为独立模块：
   - `ipc/fs.ts` —— 文件系统操作
   - `ipc/git.ts` —— Git 操作（已有，迁移并改为 TS）
   - `ipc/terminal.ts` —— 终端 PTY
   - `ipc/search.ts` —— 搜索（已有，迁移并改为 TS）
   - `ipc/worker-manager.ts` —— Worker 管理（已有，迁移并改为 TS）
   - `backend.ts` —— Python 后端生命周期管理
   - `window.ts` —— 窗口管理
3. THE `@ftre/electron` 包 SHALL 使用 tsc 编译为 dist 目录
4. THE `@ftre/electron` 包 SHALL 从 `@ftre/shared` 导入类型定义
5. WHEN 开发模式运行 `pnpm dev`，THE `@ftre/electron` SHALL 以 watch 模式运行 tsc

### 需求 4：renderer 包 —— React 前端

**用户故事：** 作为开发者，我希望 React 前端作为独立包管理，专注 UI 逻辑，与主进程解耦。

#### 验收标准

1. THE `@ftre/renderer` 包 SHALL 包含现有 `src/` 目录下的所有前端代码
2. THE `@ftre/renderer` 包 SHALL 使用 Vite 构建（保持现有配置）
3. THE `@ftre/renderer` 包 SHALL 从 `@ftre/shared` 导入类型定义
4. WHEN 开发模式运行 `pnpm dev`，THE Vite dev server SHALL 在 `http://localhost:5173` 启动

### 需求 5：统一开发命令

**用户故事：** 作为开发者，我希望一条命令启动整个开发环境，以便快速进入开发状态。

#### 验收标准

1. WHEN 在根目录执行 `pnpm dev`，THE 系统 SHALL 并行启动：
   - `@ftre/shared` 的 tsc watch
   - `@ftre/electron` 的 tsc watch
   - `@ftre/renderer` 的 Vite dev server
   - Electron 主进程（等待 Vite 就绪后启动）
2. WHEN 在根目录执行 `pnpm build`，THE 系统 SHALL 按依赖顺序构建所有包
3. WHEN 在根目录执行 `pnpm pack` 或 `pnpm dist`，THE electron-builder SHALL 正确打包应用

## 边界情况

- **循环依赖**：shared 包不依赖任何其他包，electron 和 renderer 只依赖 shared，不互相依赖
- **路径别名**：renderer 包保留 `@/` 别名指向 `src/`，Vite 和 tsconfig 都需要配置
- **node-pty 原生模块**：node-pty 需要 electron-rebuild，保留在 electron 包的依赖中
- **Python 后端**：启动逻辑从 main.js 抽取到 `backend.ts`，打包配置（electron-builder）需要调整路径
