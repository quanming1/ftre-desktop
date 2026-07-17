import { app, ipcMain, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

let pythonProcess: ChildProcess | null = null;

function getBackendPaths() {
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
    '-m', 'ftre.main', 'gateway',
  ], {
    cwd: serverDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });

  const sendLog = (line: string) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('backend:log', line);
    }
  };

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
  });

  pythonProcess.on('error', (err: Error) => {
    console.error(`[python] 启动失败:`, err.message);
    sendLog(`[启动失败] ${err.message}`);
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
