# 任务清单：Monorepo 架构重构 - CR 修复

> **目标：** 修复 Code Review 发现的问题，确保 Monorepo 架构正常工作
> **技术栈：** pnpm workspaces, TypeScript, Electron, Vite

---

### Task 1: 修复循环依赖 - 新建 app-state.ts

**文件：**
- 新建: `packages/electron/src/app-state.ts`
- 修改: `packages/electron/src/main.ts`
- 修改: `packages/electron/src/window.ts`
- 修改: `packages/electron/src/ipc/fs.ts`
- 修改: `packages/electron/src/ipc/terminal.ts`
- 修改: `packages/electron/src/ipc/watcher.ts`

- [ ] **Step 1: 创建 app-state.ts**

```typescript
// packages/electron/src/app-state.ts
import { app, BrowserWindow } from 'electron';

let mainWindow: BrowserWindow | null = null;

export const isDev = !app.isPackaged;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
```

- [ ] **Step 2: 修改 main.ts - 移除 mainWindow 相关代码，从 app-state 导入**

```typescript
// packages/electron/src/main.ts
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { isDev, setMainWindow, getMainWindow } from './app-state';
import { createWindow } from './window';
import { startPythonBackend, stopPythonBackend, waitForBackend } from './backend';
import { registerFsIPC } from './ipc/fs';
import { registerGitIPC } from './ipc/git';
import { registerTerminalIPC } from './ipc/terminal';
import { registerStoreIPC } from './ipc/store';
import { registerSearchIPC } from './ipc/search';
import { registerWatcherIPC } from './ipc/watcher';
import { WorkerManager } from './ipc/worker-manager';

// GPU 加速 + 滚动性能优化
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');

// Worker 线程管理
const workerManager = new WorkerManager();

// --- 窗口控制 IPC ---
ipcMain.handle('window:minimize', () => { getMainWindow()?.minimize(); });
ipcMain.handle('window:maximize', () => {
  const win = getMainWindow();
  if (win?.isMaximized()) win.unmaximize();
  else win?.maximize();
});
ipcMain.handle('window:close', () => { getMainWindow()?.close(); });
ipcMain.handle('window:getPosition', () => {
  const win = getMainWindow();
  return win ? win.getPosition() : [0, 0];
});
ipcMain.handle('window:setPosition', (_event, { x, y }: { x: number; y: number }) => {
  getMainWindow()?.setPosition(x, y);
});
ipcMain.handle('window:isMaximized', () => getMainWindow()?.isMaximized() ?? false);

// --- Shell ---
ipcMain.handle('shell:openExternal', (_event, url: string) => {
  return shell.openExternal(url);
});

// --- 生命周期 ---

app.whenReady().then(async () => {
  if (!isDev) {
    // 生产模式：启动内嵌 Python 后端并等待就绪
    startPythonBackend();
    try {
      await waitForBackend();
    } catch (err: any) {
      dialog.showErrorBox('启动失败',
        `Python 后端未能启动：\n${err.message}\n\n` +
        '请确认打包是否完整，或手动启动后端后重试。'
      );
      app.quit();
      return;
    }
  }
  // 开发模式：后端需手动启动（py -m uvicorn app.main:app --port 9988）

  // 注册 IPC handlers
  registerFsIPC();
  registerGitIPC();
  registerTerminalIPC();
  registerStoreIPC();
  registerSearchIPC(workerManager);
  registerWatcherIPC();

  // 创建窗口
  const win = createWindow();
  setMainWindow(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow();
      setMainWindow(newWin);
    }
  });
});

app.on('window-all-closed', () => {
  stopPythonBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopPythonBackend();
  workerManager.dispose();
});
```

- [ ] **Step 3: 修改 window.ts - 从 app-state 导入 isDev，移除 setMainWindow 调用**

```typescript
// packages/electron/src/window.ts
import { BrowserWindow } from 'electron';
import * as path from 'path';
import { isDev } from './app-state';

const VITE_DEV_URL = 'http://localhost:5173';

export function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'AI IDE',
    backgroundColor: '#1e1e1e',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 去掉默认菜单栏
  mainWindow.setMenuBarVisibility(false);

  // 开发模式加载 Vite dev server，生产模式加载打包后的文件
  if (isDev) {
    mainWindow.loadURL(VITE_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'dist', 'index.html'));
  }

  return mainWindow;
}
```

- [ ] **Step 4: 修改 ipc/fs.ts - 从 app-state 导入**

将第 4 行：
```typescript
import { getMainWindow } from '../main';
```
改为：
```typescript
import { getMainWindow } from '../app-state';
```

- [ ] **Step 5: 修改 ipc/terminal.ts - 从 app-state 导入**

将第 4 行：
```typescript
import { getMainWindow } from '../main';
```
改为：
```typescript
import { getMainWindow } from '../app-state';
```

- [ ] **Step 6: 修改 ipc/watcher.ts - 从 app-state 导入**

将第 4 行：
```typescript
import { getMainWindow } from '../main';
```
改为：
```typescript
import { getMainWindow } from '../app-state';
```

- [ ] **Step 7: 验证**

运行:
```bash
cd packages/electron && pnpm build
```
预期: 编译成功，无循环依赖警告

---

### Task 2: 修复 backend.ts 的 isDev 判断

**文件：**
- 修改: `packages/electron/src/backend.ts`

- [ ] **Step 1: 修改 backend.ts - 使用 app.isPackaged**

```typescript
// packages/electron/src/backend.ts
import { app } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

const BACKEND_PORT = 9988;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

let pythonProcess: ChildProcess | null = null;

function getBackendPaths() {
  // 使用 app.isPackaged 判断是否为打包模式
  if (!app.isPackaged) return null;

  const resourcesDir = process.resourcesPath;
  const backendDir = path.join(resourcesDir, 'backend');
  const pythonExe = path.join(backendDir, 'python', 'python.exe');
  const serverDir = path.join(backendDir, 'server');

  return { backendDir, pythonExe, serverDir };
}

export function startPythonBackend(): void {
  const paths = getBackendPaths();
  if (!paths) {
    console.log('[desktop] 开发模式，跳过自动启动后端');
    return;
  }

  const { pythonExe, serverDir } = paths;

  if (!fs.existsSync(pythonExe)) {
    console.error(`[desktop] 找不到内嵌 Python: ${pythonExe}`);
    return;
  }

  console.log('[desktop] 启动内嵌 Python 后端...');
  console.log(`[desktop]   Python: ${pythonExe}`);
  console.log(`[desktop]   Server: ${serverDir}`);

  const env = { ...process.env };
  env.PYTHONPATH = serverDir;

  pythonProcess = spawn(pythonExe, [
    '-m', 'uvicorn', 'app.main:app',
    '--host', '127.0.0.1',
    '--port', String(BACKEND_PORT),
  ], {
    cwd: serverDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });

  pythonProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[python] ${data.toString().trim()}`);
  });

  pythonProcess.stderr?.on('data', (data: Buffer) => {
    console.log(`[python:err] ${data.toString().trim()}`);
  });

  pythonProcess.on('close', (code: number | null) => {
    console.log(`[python] 进程退出，code=${code}`);
    pythonProcess = null;
  });

  pythonProcess.on('error', (err: Error) => {
    console.error(`[python] 启动失败:`, err.message);
  });
}

export function stopPythonBackend(): void {
  if (pythonProcess) {
    console.log('[desktop] 关闭 Python 后端...');
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pythonProcess.pid), '/f', '/t'], { stdio: 'ignore' });
      } else {
        pythonProcess.kill('SIGTERM');
      }
    } catch (e: any) {
      console.error('[desktop] 杀进程失败:', e.message);
    }
    pythonProcess = null;
  }
}

export function waitForBackend(retries = 30, interval = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      http.get(`${BACKEND_URL}/health`, (res) => {
        if (res.statusCode === 200) {
          console.log(`[desktop] 后端就绪 (第 ${attempts} 次检测)`);
          resolve();
        } else {
          retry();
        }
      }).on('error', retry);
    };

    const retry = () => {
      if (attempts >= retries) {
        reject(new Error(`后端未就绪，已重试 ${retries} 次`));
      } else {
        setTimeout(check, interval);
      }
    };

    check();
  });
}
```

- [ ] **Step 2: 验证**

运行:
```bash
cd packages/electron && pnpm build
```
预期: 编译成功

---

### Task 3: 更新 electron-builder-full.json

**文件：**
- 修改: `electron-builder-full.json`

- [ ] **Step 1: 更新 files 路径**

```json
{
  "appId": "com.ftre.desktop",
  "productName": "AI IDE",
  "directories": {
    "output": "release"
  },
  "files": [
    "packages/electron/dist/**/*",
    "packages/renderer/dist/**/*",
    "package.json"
  ],
  "extraResources": [
    {
      "from": "backend",
      "to": "backend",
      "filter": [
        "**/*",
        "!**/__pycache__/**",
        "!**/*.pyc"
      ]
    }
  ],
  "asarUnpack": [
    "node_modules/node-pty/**/*"
  ],
  "win": {
    "target": [
      {
        "target": "nsis",
        "arch": ["x64"]
      }
    ],
    "icon": null
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "installerIcon": null,
    "uninstallerIcon": null
  },
  "npmRebuild": false,
  "electronDist": "node_modules/electron/dist"
}
```

- [ ] **Step 2: 验证**

运行:
```bash
pnpm build
```
预期: 所有包构建成功

---

### Task 4: 修复 electron 依赖位置

**文件：**
- 修改: `packages/electron/package.json`

- [ ] **Step 1: 将 electron 从 dependencies 移到 devDependencies**

```json
{
  "name": "@ftre/electron",
  "version": "0.1.0",
  "description": "Electron main process and IPC handlers",
  "main": "./dist/main.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@ftre/shared": "workspace:*",
    "minimatch": "^9.0.0",
    "node-pty": "^1.1.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "electron": "^33.0.0",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: 验证**

运行:
```bash
pnpm install
```
预期: 依赖安装成功

---

### Task 5: 验证完整开发流程

- [ ] **Step 1: 构建所有包**

运行:
```bash
pnpm build
```
预期: shared、electron、renderer 依次构建成功

- [ ] **Step 2: 启动开发模式**

运行:
```bash
pnpm dev
```
预期: 
- shared tsc watch 启动
- electron tsc watch 启动  
- renderer Vite dev server 在 5173 端口启动
- Electron 窗口打开，加载前端页面

- [ ] **Step 3: 验证 IPC 功能**

在应用中测试:
- 打开文件夹 → fs:selectFolder 正常
- 展开文件树 → fs:readDir 正常
- 打开文件 → fs:readFile 正常
- 打开终端 → pty:create 正常

---

### Task 6: 清理根目录残留文件（可选，确认正常后执行）

**文件：**
- 删除: `main.js`
- 删除: `preload.js`
- 删除: `ipc/` 目录
- 删除: `src/` 目录
- 删除: `vite.config.ts`
- 删除: `vitest.config.ts`
- 删除: `tsconfig.json`
- 删除: `index.html`
- 删除: `copy-src.js`

- [ ] **Step 1: 确认新结构完全正常后，删除旧文件**

```bash
rm -f main.js preload.js vite.config.ts vitest.config.ts tsconfig.json index.html copy-src.js
rm -rf ipc/ src/
```

- [ ] **Step 2: 提交清理**

```bash
git add -A
git commit -m "chore: remove legacy files after monorepo migration"
```
