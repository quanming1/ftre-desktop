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
