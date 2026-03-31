# 技术设计：Monorepo 架构重构

> **架构概要：** 采用 pnpm workspaces 管理 3 个包（shared、electron、renderer）。shared 包集中定义 IPC 接口类型，electron 包实现主进程和 IPC 处理器，renderer 包专注 React UI。各包独立编译，通过 workspace 协议互相引用。

## 涉及文件

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| 新建 | `pnpm-workspace.yaml` | pnpm workspace 配置 |
| 新建 | `packages/shared/package.json` | shared 包配置 |
| 新建 | `packages/shared/tsconfig.json` | shared 包编译配置 |
| 新建 | `packages/shared/src/index.ts` | shared 包入口，导出所有 IPC 类型 |
| 新建 | `packages/shared/src/types.ts` | IPC 接口类型定义（从 desktop.d.ts 迁移） |
| 新建 | `packages/electron/package.json` | electron 包配置 |
| 新建 | `packages/electron/tsconfig.json` | electron 包编译配置 |
| 新建 | `packages/electron/src/main.ts` | 主进程入口（从 main.js 迁移） |
| 新建 | `packages/electron/src/preload.ts` | preload 脚本（从 preload.js 迁移） |
| 新建 | `packages/electron/src/backend.ts` | Python 后端生命周期管理 |
| 新建 | `packages/electron/src/window.ts` | 窗口管理 |
| 新建 | `packages/electron/src/ipc/fs.ts` | 文件系统 IPC（从 main.js 提取） |
| 新建 | `packages/electron/src/ipc/terminal.ts` | 终端 PTY IPC（从 main.js 提取） |
| 新建 | `packages/electron/src/ipc/store.ts` | 状态持久化 IPC（从 main.js 提取） |
| 新建 | `packages/electron/src/ipc/watcher.ts` | 文件监听 IPC（从 main.js 提取） |
| 迁移/修改 | `packages/electron/src/ipc/git.ts` | Git IPC（从 ipc/git.js 迁移为 TS） |
| 迁移/修改 | `packages/electron/src/ipc/search.ts` | 搜索 IPC（从 ipc/search.js 迁移为 TS） |
| 迁移/修改 | `packages/electron/src/ipc/worker-manager.ts` | Worker 管理（从 ipc/worker-manager.js 迁移为 TS） |
| 迁移/修改 | `packages/electron/src/workers/search.ts` | 搜索 Worker（从 ipc/workers/search.js 迁移为 TS） |
| 新建 | `packages/renderer/package.json` | renderer 包配置 |
| 迁移/修改 | `packages/renderer/vite.config.ts` | Vite 配置（从根目录迁移，调整路径） |
| 迁移/修改 | `packages/renderer/vitest.config.ts` | Vitest 配置（从根目录迁移，调整路径） |
| 迁移/修改 | `packages/renderer/tsconfig.json` | TypeScript 配置（从根目录迁移，调整路径） |
| 迁移 | `packages/renderer/src/**/*` | 所有 React 前端代码（从 src/ 整体迁移） |
| 迁移/修改 | `packages/renderer/index.html` | HTML 入口（从根目录迁移） |
| 修改 | `package.json` | 根 package.json，定义 workspace 和统一脚本 |
| 修改 | `electron-builder-full.json` | electron-builder 配置，调整文件路径 |
| 删除 | `main.js` | 迁移到 packages/electron/src/main.ts |
| 删除 | `preload.js` | 迁移到 packages/electron/src/preload.ts |
| 删除 | `ipc/` 目录 | 迁移到 packages/electron/src/ipc/ |
| 删除 | `src/` 目录 | 迁移到 packages/renderer/src/ |

## 现有代码意图分析

### main.js

**当前意图：** Electron 主进程的单一入口，承担了过多职责。

**承载的隐式约束：**
- Python 后端启动逻辑依赖 `isDev` 判断（`!app.isPackaged`）
- WorkerManager 实例需要在应用退出时 dispose
- IPC handler 注册顺序：先 WorkerManager，再各 IPC 模块
- 窗口创建时 preload.js 路径是硬编码的 `path.join(__dirname, 'preload.js')`

**为什么改动是安全的：**
- 拆分后的模块保持相同的 IPC channel 名称和参数结构
- 窗口创建逻辑保持不变，只是从函数调用改为模块导出
- Python 后端生命周期管理逻辑保持不变

### preload.js

**当前意图：** 通过 contextBridge 安全暴露原生能力给渲染进程。

**承载的隐式约束：**
- 所有 IPC 调用都通过 `ipcRenderer.invoke` 和 `ipcRenderer.on`
- 返回的 unsubscribe 函数需要正确清理 listener
- `window.desktop` 是全局暴露的 API 对象

**为什么改动是安全的：**
- preload.ts 保持相同的 API 结构和类型定义
- contextBridge.exposeInMainWorld 的调用方式不变
- 只是从 JS 改为 TS，增加类型注解

### src/types/desktop.d.ts

**当前意图：** 为 `window.desktop` API 提供 TypeScript 类型定义。

**承载的隐式约束：**
- 这个文件是全局类型声明（`declare global`）
- 被前端代码广泛引用

**为什么改动是安全的：**
- 类型定义迁移到 shared 包后，通过 import 引用
- 保持相同的接口结构，前端代码无需修改
- 根目录可以保留一个 re-export 文件保持向后兼容（可选）

### vite.config.ts

**当前意图：** Vite 构建配置，支持 React、Tailwind、路径别名。

**承载的隐式约束：**
- `@/` 别名指向 `src/` 目录
- HMR 已禁用（`hmr: false`），原因待确认
- base 为 `'./'` 用于相对路径打包
- Monaco Editor worker 需要独立打包（`worker: { format: 'es' }`）

**为什么改动是安全的：**
- 配置内容基本不变，只是调整路径指向新的位置
- 路径别名 `@/` 改为指向 `packages/renderer/src/`

## 架构决策

### 决策 1：使用 pnpm workspaces 而非 Turborepo/Nx

**选择：** pnpm workspaces

**原因：**
- 项目规模小（3 个包），Turborepo/Nx 的增量构建和任务编排收益有限
- pnpm 的 workspace 协议简单直观，学习成本低
- 硬链接机制节省磁盘空间，安装速度快
- 未来如需构建缓存，可以平滑迁移到 Turborepo（兼容 pnpm）

### 决策 2：shared 包编译为 dist，不直接导出源码

**选择：** tsc 编译为 dist 目录

**原因：**
- 更正规的包结构，被引用方不需要处理 TypeScript
- 类型声明文件（.d.ts）独立生成，IDE 体验更好
- 符合 npm 包的发布规范（虽然本项目可能不发布）
- 缺点：需要额外 watch 进程，HMR 降级为 full reload（可接受）

### 决策 3：electron 包也使用 TypeScript

**选择：** 将 main.js、preload.js、ipc/*.js 全部改为 TypeScript

**原因：**
- 可以复用 shared 包的类型定义，IPC handler 和 preload 都有类型校验
- 与 renderer 包保持一致的技术栈
- 现代 Electron 项目的主流做法

### 决策 4：保留 electron-builder 作为打包工具

**选择：** 继续使用 electron-builder，调整配置路径

**原因：**
- 现有配置已经成熟，无需更换工具
- 只需调整 `files` 字段指向新的编译产物路径

## 接口设计

### shared 包导出

```typescript
// packages/shared/src/index.ts
export * from './types';

// packages/shared/src/types.ts
export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  ext: string | null;
}

export interface DesktopFS {
  readDir(dirPath: string): Promise<{ entries: FileEntry[]; error?: string }>;
  readFile(filePath: string): Promise<{ content: string; language: string; error?: string }>;
  writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }>;
  // ... 其他方法
}

export interface DesktopAPI {
  platform: string;
  isElectron: boolean;
  openExternal(url: string): Promise<void>;
  fs: DesktopFS;
  git: DesktopGit;
  store: DesktopStore;
  window: DesktopWindow;
  terminal: DesktopTerminal;
}

// 全局声明（可选，保持向后兼容）
declare global {
  interface Window {
    desktop: DesktopAPI;
  }
}
```

### electron 包模块结构

```typescript
// packages/electron/src/main.ts
import { app } from 'electron';
import { createWindow } from './window';
import { startPythonBackend, stopPythonBackend, waitForBackend } from './backend';
import { registerFsIPC } from './ipc/fs';
import { registerGitIPC } from './ipc/git';
import { registerTerminalIPC } from './ipc/terminal';
import { registerStoreIPC } from './ipc/store';
import { registerSearchIPC } from './ipc/search';
import { registerWatcherIPC } from './ipc/watcher';
import { WorkerManager } from './ipc/worker-manager';

const workerManager = new WorkerManager();

app.whenReady().then(async () => {
  // ... 启动逻辑
});

// packages/electron/src/ipc/fs.ts
import { ipcMain } from 'electron';
import { DesktopFS } from '@ftre/shared';

export function registerFsIPC(): void {
  ipcMain.handle('fs:readDir', async (_event, { dirPath }) => {
    // ... 实现
  });
  // ... 其他 handler
}
```

### renderer 包依赖

```json
// packages/renderer/package.json
{
  "dependencies": {
    "@ftre/shared": "workspace:*"
  }
}
```

```typescript
// packages/renderer/src/services/api.ts
import type { DesktopAPI } from '@ftre/shared';

// 使用 window.desktop，类型来自 shared 包
const api: DesktopAPI = window.desktop;
```

## 与现有逻辑的关系

### 依赖关系图

```
┌─────────────────────────────────────────────────────────────┐
│                         根目录                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  package.json (scripts, devDependencies)            │   │
│  │  pnpm-workspace.yaml                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│              ┌─────────────┼─────────────┐                  │
│              ▼             ▼             ▼                  │
│  ┌─────────────────┐ ┌──────────┐ ┌──────────────┐         │
│  │ @ftre/shared    │ │@ftre/    │ │ @ftre/       │         │
│  │ (types only)    │ │electron  │ │ renderer     │         │
│  └─────────────────┘ └──────────┘ └──────────────┘         │
│           ▲                ▲              ▲                │
│           │                │              │                │
│           └────────────────┴──────────────┘                │
│                      (workspace:*)                         │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

1. **开发模式启动：**
   ```
   pnpm dev
   ├── concurrently:
   │   ├── tsc -w -p packages/shared/tsconfig.json
   │   ├── tsc -w -p packages/electron/tsconfig.json
   │   └── vite -c packages/renderer/vite.config.ts
   └── wait-on http://localhost:5173
       └── electron packages/electron/dist/main.js
   ```

2. **IPC 调用：**
   ```
   renderer (window.desktop.fs.readDir)
       ↓
   preload (ipcRenderer.invoke)
       ↓
   electron main (ipcMain.handle)
       ↓
   Node.js fs API
   ```

3. **类型共享：**
   ```
   shared/src/types.ts
       ├── electron/src/ipc/fs.ts (import { DesktopFS })
       └── renderer/src/services/api.ts (import type { DesktopAPI })
   ```

### 关键配置

**pnpm-workspace.yaml:**
```yaml
packages:
  - 'packages/*'
```

**根 package.json scripts:**
```json
{
  "scripts": {
    "dev": "concurrently \"pnpm --filter @ftre/shared dev\" \"pnpm --filter @ftre/electron dev\" \"pnpm --filter @ftre/renderer dev\" \"wait-on http://localhost:5173 && electron packages/electron/dist/main.js\"",
    "build": "pnpm --filter @ftre/shared build && pnpm --filter @ftre/electron build && pnpm --filter @ftre/renderer build",
    "pack": "npm run build && electron-builder --win --dir"
  }
}
```

**electron-builder-full.json 调整:**
```json
{
  "files": [
    "packages/electron/dist/**/*",
    "packages/renderer/dist/**/*",
    "package.json"
  ]
}
```

## 潜在风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| tsc watch 和 Vite dev 启动顺序 | renderer 启动时 shared/electron 还没编译完 | 使用 `wait-on` 等待 Vite 就绪后再启动 Electron |
| 路径别名失效 | 前端代码中 `@/` 无法解析 | vite.config.ts 中正确配置 `resolve.alias` |
| electron-builder 找不到文件 | 打包失败 | 调整 files 字段指向新的 dist 路径 |
| node-pty 原生模块 | electron 启动失败 | 确保 electron 包的依赖包含 node-pty，并配置 asarUnpack |
| Worker 线程路径 | Worker 启动失败 | worker-manager.ts 中使用 `__dirname` 正确解析 worker 路径 |
