# @ftre/electron

> Electron 主进程 — 桌面应用的系统层核心

## 📖 历史

`@ftre/electron` 包是 FTRE Desktop 项目的主进程实现，从项目初期就作为独立包存在。它承载了所有需要 Node.js 和系统级权限的功能：

- **文件系统访问** — 读写文件、目录遍历、文件监听
- **终端模拟** — 通过 node-pty 提供伪终端能力
- **Git 集成** — 调用 git 命令行获取仓库状态
- **全局搜索** — 高性能文件内容搜索
- **窗口管理** — 无边框窗口的控制

随着项目演进，主进程的职责被严格限制在"系统能力提供者"角色，通过 IPC 向渲染进程暴露安全的 API，遵循 Electron 的安全最佳实践。

## 🎯 定位

`@ftre/electron` 是 FTRE Desktop 的**系统层**，设计原则：

- **最小权限** — 只暴露必要的系统能力
- **安全隔离** — 使用 contextBridge 安全暴露 API
- **进程分离** — 计算密集任务使用 Worker 线程
- **平台适配** — 处理 Windows/macOS/Linux 差异

## 🏗 架构

```
@ftre/electron/
├── src/
│   ├── main.ts           # 主进程入口
│   ├── preload.ts        # 预加载脚本 (contextBridge)
│   ├── window.ts         # 窗口创建与管理
│   ├── app-state.ts      # 应用状态管理
│   ├── backend-supervisor.ts # Gateway 生命周期管理
│   ├── backend-readiness.ts  # Gateway ready/health 探测
│   ├── ipc/              # IPC 处理器
│   │   ├── fs.ts         # 文件系统 API
│   │   ├── git.ts        # Git 集成 API
│   │   ├── search.ts     # 搜索 API
│   │   ├── store.ts      # 持久化存储 API
│   │   ├── terminal.ts   # 终端 API
│   │   ├── watcher.ts    # 文件监听 API
│   │   └── worker-manager.ts  # Worker 管理
│   └── workers/          # Worker 线程
│       └── ...
└── dist/                 # 编译输出
    ├── main.js
    └── preload.js
```

### 核心模块

#### `main.ts`

应用入口，负责：

- 创建 BrowserWindow
- 注册所有 IPC 处理器
- 处理应用生命周期事件
- 管理后端进程

```typescript
app.whenReady().then(() => {
  createWindow();
  registerAllIpcHandlers();
  startBackendIfNeeded();
});
```

#### `preload.ts`

预加载脚本，通过 `contextBridge` 安全暴露 API：

```typescript
contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  isElectron: true,
  fs: { readDir, readFile, writeFile, ... },
  git: { info, status, stage, commit, ... },
  terminal: { create, write, resize, kill, ... },
  store: { get, set },
  window: { minimize, maximize, close, ... },
});
```

#### `ipc/fs.ts`

文件系统 IPC 处理器：

```typescript
// 目录读取
ipcMain.handle("fs:readDir", async (_, dirPath) => {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return { entries: entries.map(formatEntry) };
});

// 文件读写
ipcMain.handle("fs:readFile", async (_, filePath) => {
  const content = await readFile(filePath, "utf-8");
  const language = detectLanguage(filePath);
  return { content, language };
});

// 文件监听
ipcMain.handle("fs:watch", async (_, filePath) => {
  watcher.add(filePath);
});
```

#### `ipc/terminal.ts`

终端 IPC 处理器，使用 node-pty：

```typescript
ipcMain.handle("terminal:create", async (_, opts) => {
  const pty = spawn(shell, [], {
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    cwd: opts.cwd ?? homedir(),
  });
  
  pty.onData((data) => {
    mainWindow.webContents.send("terminal:data", id, data);
  });
  
  return { id: pty.pid };
});
```

#### `ipc/git.ts`

Git 集成，调用命令行：

```typescript
ipcMain.handle("git:status", async (_, rootPath) => {
  const result = await exec("git status --porcelain", { cwd: rootPath });
  return { files: parseGitStatus(result.stdout) };
});

ipcMain.handle("git:diff", async (_, rootPath, filePath, staged) => {
  const flag = staged ? "--cached" : "";
  const result = await exec(`git diff ${flag} -- "${filePath}"`, { cwd: rootPath });
  return { diff: result.stdout };
});
```

#### `ipc/search.ts`

高性能文件搜索，使用 Worker 线程：

```typescript
ipcMain.handle("fs:search", async (_, rootPath, query, options) => {
  return workerManager.runSearch({ rootPath, query, options });
});
```

## 🔒 安全模型

### Context Isolation

渲染进程无法直接访问 Node.js API，所有系统能力通过 `window.desktop` 访问：

```typescript
// preload.ts
contextBridge.exposeInMainWorld("desktop", desktopAPI);

// renderer 中使用
const result = await window.desktop.fs.readFile(path);
```

### 路径验证

所有文件操作都验证路径合法性：

```typescript
function validatePath(filePath: string, rootPath: string): boolean {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(rootPath);
}
```

### 权限最小化

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true` (部分场景)

## 📦 依赖

```json
{
  "dependencies": {
    "@ftre/shared": "workspace:*",
    "minimatch": "^9.0.0",
    "node-pty": "^1.1.0"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "typescript": "^5.9.3"
  }
}
```

- **@ftre/shared** — 共享类型定义
- **node-pty** — 伪终端实现
- **minimatch** — Glob 模式匹配

## 🛠 开发

```bash
# 编译
pnpm --filter @ftre/electron build

# 监听模式
pnpm --filter @ftre/electron dev

# 启动应用 (需要先构建 renderer)
pnpm dev
```

### 构建产物

```
dist/
├── main.js      # 主进程入口
├── preload.js   # 预加载脚本
└── workers/     # Worker 线程
```

## 🔧 配置

### 窗口配置 (`window.ts`)

```typescript
const mainWindow = new BrowserWindow({
  width: 1400,
  height: 900,
  frame: false,           // 无边框窗口
  titleBarStyle: "hidden",
  webPreferences: {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
  },
});
```

### 后端进程 (`backend-supervisor.ts`)

打包模式下由 `BackendSupervisor` 管理安装包自带的 Gateway。主进程先读取
`backend/python/runtime.json`，校验平台与架构，再启动 manifest 指定的解释器（Windows
使用无控制台的 `pythonw.exe`）；
不会猜测系统 Python 路径。开发模式仍由开发者手动运行 `ftre gateway`。

输出通过 UTF-8 `StringDecoder` 组装，POSIX 平台用独立进程组回收 Gateway
及其子进程，Windows 保留 `taskkill /t` 进程树清理。

启动通过 stdout/stderr pipe 把日志交给 LoadingScreen，并等待 Gateway `/api/health`
成功后才进入 ready。新增平台不得复制一套启动工厂或自行拼接解释器路径；必须复用
`resolveBackendRuntime()`、`readRuntimeManifest()` 和 `BackendSupervisor` 生命周期入口。

## 📄 许可

私有包，仅供 FTRE Desktop 项目内部使用。
