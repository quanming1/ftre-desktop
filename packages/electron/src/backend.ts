import { app, BrowserWindow } from "electron";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { StringDecoder } from "string_decoder";
import {
  assertExecutable,
  assertRuntimeMatchesProcess,
  readRuntimeManifest,
  resolveBackendRuntime,
  resolveManifestExecutable,
  type BackendRuntimePaths,
} from "./backend-runtime";

let pythonProcess: ChildProcess | null = null;
let isQuitting = false;
let isRestarting = false;
let crashRetryCount = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

const MAX_CRASH_RETRIES = 3;
const CRASH_RETRY_DELAY = 2000;
const STOP_GRACE_PERIOD = 1500;

function sendLog(line: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("backend:log", line);
  }
}

function emitExit(code: number | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("backend:exit", code);
  }
}

function describe(paths: BackendRuntimePaths): string {
  return [
    `platform=${process.platform}`,
    `arch=${process.arch}`,
    `python=${paths.pythonExecutable}`,
    `server=${paths.serverDir}`,
    `cwd=${paths.serverDir}`,
  ].join(" ");
}

function emitOutput(prefix: string, text: string): void {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (const line of normalized.split("\n")) {
    if (!line) continue;
    const output = `${prefix}${line}`;
    console.log(output);
    sendLog(output);
  }
}

/** 使用 StringDecoder 避免中文 UTF-8 字符跨 chunk 时被拆坏。 */
function pipeOutput(stream: NodeJS.ReadableStream | null, prefix: string): void {
  if (!stream) return;
  const decoder = new StringDecoder("utf8");
  let pending = "";
  stream.on("data", (chunk: Buffer | string) => {
    pending += typeof chunk === "string" ? chunk : decoder.write(chunk);
    const lines = pending.split(/\r?\n|\r/);
    pending = lines.pop() ?? "";
    emitOutput(prefix, lines.join("\n"));
  });
  stream.on("end", () => {
    pending += decoder.end();
    emitOutput(prefix, pending);
    pending = "";
  });
}

function getBackendPaths(): BackendRuntimePaths | null {
  if (!app.isPackaged) return null;
  return resolveBackendRuntime(process.resourcesPath);
}

function readExecutable(paths: BackendRuntimePaths): string {
  const manifest = readRuntimeManifest(paths.runtimeManifest);
  assertRuntimeMatchesProcess(manifest);
  const executable = resolveManifestExecutable(paths, manifest);
  assertExecutable(executable);
  if (!fs.existsSync(paths.serverDir)) {
    throw new Error(`找不到内置 Gateway 源码目录：${paths.serverDir}`);
  }
  return executable;
}

function createBackendEnvironment(paths: BackendRuntimePaths): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const pythonPath = [paths.serverDir, env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  env.PYTHONPATH = pythonPath;
  // 强制 Python 使用 UTF-8，避免用户机器的 locale 将中文日志解码成乱码。
  env.PYTHONUTF8 = "1";
  env.PYTHONIOENCODING = "utf-8";
  env.PYTHONUNBUFFERED = "1";
  env.PYTHONNOUSERSITE = "1";
  return env;
}

function requestStop(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      // detached=true 让 Gateway 与其子进程处于独立进程组；负 pid 可以一次
      // 回收整个进程组，避免 macOS 关闭客户端后留下 Python 子进程。
      process.kill(-pid, "SIGTERM");
    }
  } catch (error) {
    try {
      child.kill(process.platform === "win32" ? undefined : "SIGTERM");
    } catch (fallbackError) {
      console.error("[desktop] 停止 Gateway 失败", { error, fallbackError });
    }
  }
}

function spawnBackend(): void {
  const paths = getBackendPaths();
  if (!paths) {
    console.log("[desktop] 开发模式，跳过自动启动后端；请手动运行 ftre gateway");
    return;
  }

  let pythonExecutable: string;
  try {
    pythonExecutable = readExecutable(paths);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = `[desktop] 内置 Gateway 运行时不可用：${message}（${describe(paths)}）`;
    console.error(diagnostic);
    sendLog(diagnostic);
    return;
  }

  console.log(`[desktop] 启动内置 Python Gateway（${describe(paths)}）`);
  const env = createBackendEnvironment(paths);
  const child = spawn(pythonExecutable, ["-m", "ftre.main", "gateway"], {
    cwd: paths.serverDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  pythonProcess = child;

  pipeOutput(child.stdout, "[python] ");
  pipeOutput(child.stderr, "[python:err] ");

  child.on("close", (code: number | null) => {
    console.log(`[python] 进程退出，code=${code}`);
    // 重启时旧进程的 close 事件可能晚于新进程 spawn，不能清空新句柄。
    const isCurrentProcess = pythonProcess === child;
    if (isCurrentProcess) pythonProcess = null;
    emitExit(code);

    if (!isCurrentProcess || isRestarting || isQuitting) return;
    if (crashRetryCount < MAX_CRASH_RETRIES) {
      crashRetryCount += 1;
      const message = `[desktop] 后端意外退出，${CRASH_RETRY_DELAY}ms 后自动重启 ` +
        `(第 ${crashRetryCount}/${MAX_CRASH_RETRIES} 次)`;
      console.warn(message);
      sendLog(message);
      restartTimer = setTimeout(() => {
        restartTimer = null;
        spawnBackend();
      }, CRASH_RETRY_DELAY);
    } else {
      const message = "[desktop] 后端连续崩溃超过上限，不再自动重启。请检查安装包运行时。";
      console.error(message);
      sendLog(message);
    }
  });

  child.on("error", (error: Error) => {
    const message = `[desktop] Gateway 启动失败：${error.message}（${describe(paths)}）`;
    console.error(message);
    sendLog(message);
  });
}

export function startPythonBackend(): void {
  isQuitting = false;
  isRestarting = false;
  crashRetryCount = 0;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  spawnBackend();
}

export function stopPythonBackend(): void {
  isQuitting = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (!pythonProcess) return;
  console.log("[desktop] 关闭 Python Gateway...");
  requestStop(pythonProcess);
  pythonProcess = null;
}

export async function restartPythonBackend(): Promise<{ ok: boolean; error?: string }> {
  if (!app.isPackaged) {
    return { ok: false, error: "开发模式下不支持重启后端，请手动重启 ftre gateway" };
  }

  isRestarting = true;
  isQuitting = false;
  crashRetryCount = 0;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  if (pythonProcess) {
    console.log("[desktop] 重启后端：停止旧进程...");
    requestStop(pythonProcess);
    pythonProcess = null;
    await new Promise((resolve) => setTimeout(resolve, STOP_GRACE_PERIOD));
  }

  isRestarting = false;
  console.log("[desktop] 重启后端：启动新进程...");
  spawnBackend();
  return { ok: true };
}
