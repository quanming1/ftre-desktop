const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

// GPU 加速 + 滚动性能优化
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');

// --- 配置 ---
const BACKEND_PORT = 9988;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const VITE_DEV_URL = 'http://localhost:5173';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const isDev = !app.isPackaged;

let mainWindow = null;
let pythonProcess = null;

// --- Python 后端管理 ---

/**
 * 获取内嵌 Python 和后端代码的路径
 * 生产模式: resources/backend/python/python.exe + resources/backend/server/
 * 开发模式: 不使用（手动启动）
 */
function getBackendPaths() {
    if (isDev) return null;

    // electron-builder extraResources 会把 backend/ 放到 resources/backend/
    const resourcesDir = process.resourcesPath;
    const backendDir = path.join(resourcesDir, 'backend');
    const pythonExe = path.join(backendDir, 'python', 'python.exe');
    const serverDir = path.join(backendDir, 'server');

    return { backendDir, pythonExe, serverDir };
}

function startPythonBackend() {
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

    // 设置环境变量，让 .env 从 server 目录加载
    const env = { ...process.env };
    // 确保 PYTHONPATH 包含 server 目录
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

    pythonProcess.stdout.on('data', (data) => {
        console.log(`[python] ${data.toString().trim()}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.log(`[python:err] ${data.toString().trim()}`);
    });

    pythonProcess.on('close', (code) => {
        console.log(`[python] 进程退出，code=${code}`);
        pythonProcess = null;
    });

    pythonProcess.on('error', (err) => {
        console.error(`[python] 启动失败:`, err.message);
    });
}

function stopPythonBackend() {
    if (pythonProcess) {
        console.log('[desktop] 关闭 Python 后端...');
        try {
            // Windows 上需要 taskkill 强杀进程树
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', String(pythonProcess.pid), '/f', '/t'], { stdio: 'ignore' });
            } else {
                pythonProcess.kill('SIGTERM');
            }
        } catch (e) {
            console.error('[desktop] 杀进程失败:', e.message);
        }
        pythonProcess = null;
    }
}

// --- 等待后端就绪 ---

function waitForBackend(retries = 30, interval = 1000) {
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

// --- 窗口 ---

function createWindow() {
    mainWindow = new BrowserWindow({
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
        mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// --- 生命周期 ---

app.whenReady().then(async () => {
    if (!isDev) {
        // 生产模式：启动内嵌 Python 后端并等待就绪
        startPythonBackend();
        try {
            await waitForBackend();
        } catch (err) {
            dialog.showErrorBox('启动失败',
                `Python 后端未能启动：\n${err.message}\n\n` +
                '请确认打包是否完整，或手动启动后端后重试。'
            );
            app.quit();
            return;
        }
    }
    // 开发模式：后端需手动启动（py -m uvicorn app.main:app --port 9988）

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
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

// --- Worker 线程管理 ---
const { WorkerManager } = require('./ipc/worker-manager');
const workerManager = new WorkerManager();

// --- 文件系统 IPC ---

/** 文件树 readDir 过滤：仅隐藏 .git 内部目录 */
const TREE_SKIP_DIRS = new Set(['.git']);



/**
 * 读取目录下一层内容（懒加载）
 * 参数: { dirPath: string }
 * 返回: { entries: Array<{ name, path, isDir, ext? }> }
 */
ipcMain.handle('fs:readDir', async (_event, { dirPath }) => {
    try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        const entries = [];

        for (const item of items) {
            if (item.isDirectory() && TREE_SKIP_DIRS.has(item.name)) continue;

            entries.push({
                name: item.name,
                path: path.join(dirPath, item.name).replace(/\\/g, '/'),
                isDir: item.isDirectory(),
                ext: item.isDirectory() ? null : path.extname(item.name).slice(1),
            });
        }

        // 文件夹在前，文件在后，各自按名称排序
        entries.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });

        return { entries };
    } catch (err) {
        return { entries: [], error: err.message };
    }
});

/**
 * 读取文件内容
 * 参数: { filePath: string }
 * 返回: { content: string, language: string }
 */
ipcMain.handle('fs:readFile', async (_event, { filePath }) => {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const ext = path.extname(filePath).slice(1);
        return { content, language: extToLanguage(ext) };
    } catch (err) {
        return { content: '', error: err.message };
    }
});

/**
 * 写入文件
 * 参数: { filePath: string, content: string }
 */
ipcMain.handle('fs:writeFile', async (_event, { filePath, content }) => {
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

/**
 * 打开文件夹选择对话框
 */
ipcMain.handle('fs:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0].replace(/\\/g, '/') };
});

/**
 * 另存为对话框
 * 参数: { defaultName?: string }
 * 返回: { path: string | null }
 */
ipcMain.handle('fs:showSaveDialog', async (_event, { defaultName } = {}) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: defaultName || 'Untitled',
    });
    if (result.canceled || !result.filePath) return { path: null };
    return { path: result.filePath.replace(/\\/g, '/') };
});

/**
 * 创建空文件
 * 参数: { filePath: string }
 * 返回: { success: boolean, error?: string }
 */
ipcMain.handle('fs:createFile', async (_event, { filePath }) => {
    try {
        if (fs.existsSync(filePath)) {
            return { success: false, error: 'File already exists' };
        }
        // Ensure parent directory exists
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '', 'utf-8');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

/**
 * 创建目录
 * 参数: { dirPath: string }
 * 返回: { success: boolean, error?: string }
 */
ipcMain.handle('fs:createFolder', async (_event, { dirPath }) => {
    try {
        fs.mkdirSync(dirPath, { recursive: true });
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

/**
 * 重命名文件或目录
 * 参数: { oldPath: string, newPath: string }
 * 返回: { success: boolean, error?: string }
 */
ipcMain.handle('fs:rename', async (_event, { oldPath, newPath }) => {
    try {
        fs.renameSync(oldPath, newPath);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

/**
 * 删除文件或目录
 * 参数: { targetPath: string, isDir: boolean }
 * 返回: { success: boolean, error?: string }
 */
ipcMain.handle('fs:delete', async (_event, { targetPath, isDir }) => {
    try {
        if (isDir) {
            fs.rmSync(targetPath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(targetPath);
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

/**
 * 在系统资源管理器中显示文件/文件夹
 */
ipcMain.handle('fs:revealInExplorer', async (_event, { targetPath }) => {
    shell.showItemInFolder(targetPath);
});

// --- 窗口控制 IPC ---

ipcMain.handle('window:minimize', () => { mainWindow?.minimize(); });
ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
});
ipcMain.handle('window:close', () => { mainWindow?.close(); });
ipcMain.handle('window:getPosition', () => mainWindow ? mainWindow.getPosition() : [0, 0]);
ipcMain.handle('window:setPosition', (_event, { x, y }) => { mainWindow?.setPosition(x, y); });
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
// --- Shell ---

ipcMain.handle('shell:openExternal', (_event, url) => {
    return shell.openExternal(url);
});

// --- 终端 PTY ---

const pty = require('node-pty');
const terminals = new Map();
let termIdCounter = 0;

ipcMain.handle('pty:create', (_event, { cols, rows, cwd, shell: requestedShell }) => {
    const id = ++termIdCounter;
    const shell = requestedShell || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash');
    const term = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: cwd || require('os').homedir(),
        env: process.env,
    });

    terminals.set(id, term);

    term.onData((data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('pty:data', { id, data });
        }
    });

    term.onExit(({ exitCode }) => {
        terminals.delete(id);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('pty:exit', { id, exitCode });
        }
    });

    return { id };
});

ipcMain.handle('pty:write', (_event, { id, data }) => {
    const term = terminals.get(id);
    if (term) term.write(data);
});

ipcMain.handle('pty:resize', (_event, { id, cols, rows }) => {
    const term = terminals.get(id);
    if (term) term.resize(cols, rows);
});

ipcMain.handle('pty:kill', (_event, { id }) => {
    const term = terminals.get(id);
    if (term) {
        term.kill();
        terminals.delete(id);
    }
});

// --- 搜索 IPC — 模块化封装在 ipc/search.js（Worker 线程执行，不阻塞主进程）---
const { registerSearchIPC } = require('./ipc/search');
registerSearchIPC(workerManager);

// --- Git IPC ---

const { execSync } = require('child_process');

/**
 * 获取 Git 仓库信息（分支名 + 变更文件数）
 * 参数: { rootPath: string }
 * 返回: { branch: string | null, changedFiles: number, isGitRepo: boolean }
 */
// Git IPC — 模块化封装在 ipc/git.js
const { registerGitIPC } = require('./ipc/git');
registerGitIPC();

// 注意：git:status, git:stage, git:unstage, git:commit, git:show, git:diff-file
// 已全部迁移到 ipc/git.js（上方 registerGitIPC 注册）

// --- File Watcher IPC ---

const watchers = new Map();

ipcMain.handle('fs:watch', async (_event, { filePath }) => {
    if (watchers.has(filePath)) return;
    try {
        let debounceTimer = null;
        const pendingPaths = new Set();

        const watcher = fs.watch(filePath, { recursive: true }, (_eventType, filename) => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            const changedPath = filename
                ? path.join(filePath, filename).replace(/\\/g, '/')
                : filePath;

            pendingPaths.add(changedPath);
            if (!debounceTimer) {
                debounceTimer = setTimeout(() => {
                    for (const p of pendingPaths) {
                        mainWindow.webContents.send('fs:fileChanged', { filePath: p });
                    }
                    pendingPaths.clear();
                    debounceTimer = null;
                }, 150);
            }
        });
        watchers.set(filePath, watcher);
    } catch (err) {
        // Silently ignore watcher errors
    }
});

ipcMain.handle('fs:unwatch', async (_event, { filePath }) => {
    const watcher = watchers.get(filePath);
    if (watcher) {
        watcher.close();
        watchers.delete(filePath);
    }
});

// --- 应用状态持久化 ---

const STATE_FILE = path.join(app.getPath('userData'), 'ftre-state.json');

function loadAppState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        }
    } catch { }
    return {};
}

function saveAppState(state) {
    try {
        const current = loadAppState();
        const merged = { ...current, ...state };
        fs.writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2), 'utf-8');
    } catch (err) {
        console.error('[desktop] 保存状态失败:', err.message);
    }
}

ipcMain.handle('store:get', async (_event, { key }) => {
    const state = loadAppState();
    return { value: state[key] ?? null };
});

ipcMain.handle('store:set', async (_event, { key, value }) => {
    saveAppState({ [key]: value });
    return { success: true };
});

// --- 工具函数 ---

function extToLanguage(ext) {
    const map = {
        js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
        py: 'python', rs: 'rust', go: 'go', java: 'java',
        json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
        md: 'markdown', html: 'html', css: 'css', scss: 'scss',
        sql: 'sql', sh: 'shell', bash: 'shell', zsh: 'shell',
        xml: 'xml', svg: 'xml', c: 'c', cpp: 'cpp', h: 'c',
        txt: 'plaintext', log: 'plaintext', env: 'plaintext',
        gitignore: 'plaintext', dockerfile: 'dockerfile',
    };
    return map[ext.toLowerCase()] || 'plaintext';
}
