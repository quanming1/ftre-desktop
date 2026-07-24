import { app, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

let pythonProcess: ChildProcess | null = null;
let isQuitting = false;
let isRestarting = false;
let crashRetryCount = 0;
const MAX_CRASH_RETRIES = 3;
const CRASH_RETRY_DELAY = 2000;

function getBackendPaths() {
  if (!app.isPackaged) return null;

  const resourcesDir = process.resourcesPath;
  const backendDir = path.join(resourcesDir, 'backend');
  const pythonExe = path.join(backendDir, 'python', 'python.exe');
  const serverDir = path.join(backendDir, 'server');

  return { backendDir, pythonExe, serverDir };
}

const sendLog = (line: string) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('backend:log', line);
  }
};

function spawnBackend(): void {
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
    '-m', 'ftre.main', 'gateway',
  ], {
    cwd: serverDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });

  pythonProcess.stdout?.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    if (text) {
      console.log(`[python] ${text}`);
      sendLog(text);
    }
  });

  pythonProcess.stderr?.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    if (text) {
      console.log(`[python:err] ${text}`);
      sendLog(text);
    }
  });

  pythonProcess.on('close', (code: number | null) => {
    console.log(`[python] 进程退出，code=${code}`);
    pythonProcess = null;

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('backend:exit', code);
    }

    if (isRestarting) return;

    if (isQuitting) return;

    if (crashRetryCount < MAX_CRASH_RETRIES) {
      crashRetryCount++;
      console.log(`[desktop] 后端意外退出，${CRASH_RETRY_DELAY}ms 后自动重启 (第 ${crashRetryCount}/${MAX_CRASH_RETRIES} 次)`);
      sendLog(`[desktop] 后端意外退出，自动重启中 (${crashRetryCount}/${MAX_CRASH_RETRIES})...`);
      setTimeout(() => spawnBackend(), CRASH_RETRY_DELAY);
    } else {
      console.error('[desktop] 后端连续崩溃超过上限，不再自动重启');
      sendLog('[desktop] 后端连续崩溃超过上限，不再自动重启。请检查配置后手动重启。');
    }
  });

  pythonProcess.on('error', (err: Error) => {
    console.error(`[python] 启动失败:`, err.message);
    sendLog(`[启动失败] ${err.message}`);
  });
}

export function startPythonBackend(): void {
  crashRetryCount = 0;
  spawnBackend();
}

export function stopPythonBackend(): void {
  isQuitting = true;
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

export async function restartPythonBackend(): Promise<{ ok: boolean; error?: string }> {
  if (!app.isPackaged) {
    return { ok: false, error: '开发模式下不支持重启后端，请手动重启 ftre gateway' };
  }

  isRestarting = true;
  crashRetryCount = 0;

  if (pythonProcess) {
    console.log('[desktop] 重启后端：停止旧进程...');
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pythonProcess.pid), '/f', '/t'], { stdio: 'ignore' });
      } else {
        pythonProcess.kill('SIGTERM');
      }
    } catch (e: any) {
      console.error('[desktop] 杀旧进程失败:', e.message);
    }
    pythonProcess = null;

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  isRestarting = false;
  console.log('[desktop] 重启后端：启动新进程...');
  spawnBackend();

  return { ok: true };
}
