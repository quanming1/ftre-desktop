import { app, BrowserWindow } from "electron";
import { ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { BackendState, BackendStatus } from "@ftre/shared";
import {
  assertExecutable,
  assertRuntimeMatchesProcess,
  readRuntimeManifest,
  resolveBackendRuntime,
  resolveManifestExecutable,
  type BackendRuntimePaths,
} from "./backend-runtime";
import { waitForBackendReady } from "./backend-readiness";

export type { BackendState, BackendStatus } from "@ftre/shared";

const DEFAULT_GATEWAY_HOST = "127.0.0.1";
const DEFAULT_GATEWAY_PORT = 48650;
const STARTUP_TIMEOUT_MS = 30_000;
const MAX_CRASH_RETRIES = 3;
const CRASH_RETRY_DELAY_MS = 2_000;
const STOP_GRACE_PERIOD_MS = 1_500;
const FORCE_STOP_TIMEOUT_MS = 3_000;
const MAX_RECENT_LOGS = 80;

interface GatewayEndpoint {
  host: string;
  port: number;
}

function sendToWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function normalizeOutput(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
}

export class BackendSupervisor {
  private child: ChildProcess | null = null;
  private generation = 0;
  private state: BackendState = "idle";
  private exitCode: number | null | undefined;
  private error: BackendStatus["error"];
  private recentLogs: string[] = [];
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private crashRetries = 0;
  private stopping = false;
  private restarting = false;
  private lifecycle: Promise<unknown> = Promise.resolve();

  public status(): BackendStatus {
    const status: BackendStatus = {
      state: this.state,
      generation: this.generation,
    };
    if (this.child?.pid) status.pid = this.child.pid;
    if (this.exitCode !== undefined) status.exitCode = this.exitCode;
    if (this.error) status.error = { ...this.error, recentLogs: [...this.recentLogs] };
    return status;
  }

  public async start(): Promise<BackendStatus> {
    return this.enqueue(() => this.startInternal());
  }

  private async startInternal(): Promise<BackendStatus> {
    if (!app.isPackaged) {
      this.setState("idle");
      return this.status();
    }
    if (this.child && (this.state === "starting" || this.state === "ready")) {
      return this.status();
    }

    this.clearRestartTimer();
    this.stopping = false;
    this.restarting = false;
    this.crashRetries = 0;
    return this.spawnGateway();
  }

  public async stop(): Promise<void> {
    return this.enqueue(() => this.stopInternal());
  }

  private async stopInternal(): Promise<void> {
    this.stopping = true;
    this.clearRestartTimer();
    const child = this.child;
    if (!child) {
      this.setState("stopped");
      return;
    }

    this.setState("stopping");
    await this.stopChild(child, false);
    if (this.child === child) this.child = null;
    this.setState("stopped");
  }

  public async restart(): Promise<{ ok: boolean; error?: string }> {
    return this.enqueue(() => this.restartInternal());
  }

  private async restartInternal(): Promise<{ ok: boolean; error?: string }> {
    if (!app.isPackaged) {
      return { ok: false, error: "开发模式下不支持重启后端，请手动重启 ftre gateway" };
    }

    this.restarting = true;
    this.stopping = true;
    this.clearRestartTimer();
    const child = this.child;
    if (child) {
      this.setState("stopping");
      await this.stopChild(child, false);
      if (this.child === child) this.child = null;
    }

    this.stopping = false;
    this.restarting = false;
    this.crashRetries = 0;
    await this.spawnGateway();
    return { ok: this.state === "ready", ...(this.error ? { error: this.error.message } : {}) };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.lifecycle.then(operation, operation);
    this.lifecycle = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private async spawnGateway(): Promise<BackendStatus> {
    const paths = this.getBackendPaths();
    if (!paths) return this.status();

    let executable: string;
    try {
      executable = this.readExecutable(paths);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.fail(
        "runtime_unavailable",
        new Error(`${message}（python=${paths.pythonExecutable}，server=${paths.serverDir}）`),
      );
      return this.status();
    }

    this.generation += 1;
    const generation = this.generation;
    this.exitCode = undefined;
    this.error = undefined;
    this.setState("starting");
    const env = this.createEnvironment(paths);
    const endpoint = this.readGatewayEndpoint();
    const child = spawn(executable, ["-m", "ftre.main", "gateway"], {
      cwd: paths.serverDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    this.child = child;
    this.pipeOutput(child.stdout, "[python] ");
    this.pipeOutput(child.stderr, "[python:err] ");
    child.once("error", (error) => {
      if (this.child !== child || this.generation !== generation) return;
      this.fail("spawn_failed", error);
    });
    child.once("close", (code) => {
      if (this.child !== child || this.generation !== generation) return;
      this.child = null;
      this.exitCode = code;
      sendToWindows("backend:exit", code);
      if (this.stopping || this.restarting || this.state === "stopping") return;
      this.fail("unexpected_exit", new Error(`Gateway 进程退出，code=${code}`));
      this.scheduleCrashRestart();
    });

    try {
      await waitForBackendReady(
        endpoint,
        () => this.child === child && child.exitCode === null,
        { timeoutMs: STARTUP_TIMEOUT_MS },
      );
      if (this.child === child && this.generation === generation) this.setState("ready");
    } catch (error) {
      if (this.child === child && this.generation === generation) {
        this.fail("ready_timeout", error);
        this.stopping = true;
        await this.stopChild(child, true);
        this.stopping = false;
        if (this.child === child) this.child = null;
      }
    }
    return this.status();
  }

  private scheduleCrashRestart(): void {
    if (this.crashRetries >= MAX_CRASH_RETRIES || this.stopping || this.restarting) return;
    this.crashRetries += 1;
    const attempt = this.crashRetries;
    const message = `[desktop] 后端意外退出，${CRASH_RETRY_DELAY_MS}ms 后自动重启（第 ${attempt}/${MAX_CRASH_RETRIES} 次）`;
    this.log(message, "warn");
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.enqueue(() => this.spawnGateway());
    }, CRASH_RETRY_DELAY_MS);
  }

  private async stopChild(child: ChildProcess, force: boolean): Promise<void> {
    if (!child.pid || child.exitCode !== null) return;
    if (process.platform === "win32") {
      this.killWindowsTree(child.pid, force);
    } else if (force) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }

    const exited = await this.waitForExit(child, force ? FORCE_STOP_TIMEOUT_MS : STOP_GRACE_PERIOD_MS);
    if (!exited && !force) await this.stopChild(child, true);
  }

  private killWindowsTree(pid: number, force: boolean): void {
    const args = ["/pid", String(pid), "/t"];
    if (force) args.push("/f");
    const killer = spawn("taskkill", args, {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.unref();
  }

  private waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (value: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(child.exitCode !== null), timeoutMs);
      child.once("close", () => finish(true));
    });
  }

  private pipeOutput(stream: NodeJS.ReadableStream | null, prefix: string): void {
    if (!stream) return;
    const decoder = new StringDecoder("utf8");
    let pending = "";
    stream.on("data", (chunk: Buffer | string) => {
      pending += typeof chunk === "string" ? chunk : decoder.write(chunk);
      const lines = pending.split(/\r?\n|\r/);
      pending = lines.pop() ?? "";
      this.emitOutput(prefix, lines.join("\n"));
    });
    stream.on("end", () => {
      pending += decoder.end();
      this.emitOutput(prefix, pending);
      pending = "";
    });
  }

  private emitOutput(prefix: string, text: string): void {
    for (const line of normalizeOutput(text)) {
      const output = `${prefix}${line}`;
      this.recentLogs.push(output);
      if (this.recentLogs.length > MAX_RECENT_LOGS) this.recentLogs.shift();
      console.log(output);
      sendToWindows("backend:log", output);
    }
  }

  private setState(state: BackendState): void {
    this.state = state;
    sendToWindows("backend:state", this.status());
  }

  private fail(code: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.error = { code, message, recentLogs: [...this.recentLogs] };
    this.log(`[desktop] Gateway ${message}`, "error");
    this.setState("failed");
  }

  private log(message: string, level: "warn" | "error"): void {
    if (level === "warn") console.warn(message);
    else console.error(message);
    this.recentLogs.push(message);
    if (this.recentLogs.length > MAX_RECENT_LOGS) this.recentLogs.shift();
    sendToWindows("backend:log", message);
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private getBackendPaths(): BackendRuntimePaths | null {
    if (!app.isPackaged) return null;
    return resolveBackendRuntime(process.resourcesPath);
  }

  private readExecutable(paths: BackendRuntimePaths): string {
    const manifest = readRuntimeManifest(paths.runtimeManifest);
    assertRuntimeMatchesProcess(manifest);
    const executable = resolveManifestExecutable(paths, manifest);
    assertExecutable(executable);
    if (!fs.existsSync(paths.serverDir)) {
      throw new Error(`找不到内置 Gateway 源码目录：${paths.serverDir}`);
    }
    return executable;
  }

  private createEnvironment(paths: BackendRuntimePaths): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    env.PYTHONPATH = [paths.serverDir, env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    env.PYTHONUTF8 = "1";
    env.PYTHONIOENCODING = "utf-8";
    env.PYTHONUNBUFFERED = "1";
    env.PYTHONNOUSERSITE = "1";
    return env;
  }

  private readGatewayEndpoint(): GatewayEndpoint {
    const configPath = path.join(app.getPath("home"), ".ftre", "config.json");
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (raw && typeof raw === "object") {
        const servers = (raw as Record<string, unknown>).servers;
        const gateway = servers && typeof servers === "object"
          ? (servers as Record<string, unknown>).gateway
          : undefined;
        if (gateway && typeof gateway === "object") {
          const host = (gateway as Record<string, unknown>).host;
          const port = (gateway as Record<string, unknown>).port;
          if (
            typeof host === "string" &&
            host &&
            typeof port === "number" &&
            Number.isInteger(port) &&
            port > 0 &&
            port < 65_536
          ) {
            return { host, port };
          }
        }
      }
    } catch {
      // Gateway itself applies the same defaults when user config is absent or invalid.
    }
    return { host: DEFAULT_GATEWAY_HOST, port: DEFAULT_GATEWAY_PORT };
  }
}

export const backendSupervisor = new BackendSupervisor();
