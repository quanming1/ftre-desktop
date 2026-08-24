import * as fs from "fs";
import * as path from "path";

/**
 * 内置 Gateway 的运行时契约。
 *
 * 主进程只消费这个契约，不猜测 Python 安装位置，也不把 Windows 的
 * `.exe`、反斜杠或 PowerShell 逻辑泄漏到其他平台。
 */
export interface BackendRuntimePaths {
  backendDir: string;
  pythonDir: string;
  pythonExecutable: string;
  runtimeManifest: string;
  serverDir: string;
  launcherScript: string;
}

export interface RuntimeManifest {
  formatVersion: number;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  pythonVersion: string;
  pythonExecutable: string;
  source: string;
  sourceUrl?: string;
  archiveSha256?: string;
  runtimeSha256?: string;
}

const PYTHON_BASENAME = "python3.12";

function defaultPythonExecutable(pythonDir: string, platform: NodeJS.Platform): string {
  if (platform === "win32") return path.join(pythonDir, "python.exe");
  return path.join(pythonDir, "bin", PYTHON_BASENAME);
}

/** 根据当前 Electron 目标平台返回资源路径。 */
export function resolveBackendRuntime(
  resourcesDir: string,
  platform: NodeJS.Platform = process.platform,
): BackendRuntimePaths {
  const backendDir = path.resolve(resourcesDir, "backend");
  const pythonDir = path.join(backendDir, "python");
  const runtimeManifest = path.join(pythonDir, "runtime.json");
  return {
    backendDir,
    pythonDir,
    pythonExecutable: defaultPythonExecutable(pythonDir, platform),
    runtimeManifest,
    serverDir: path.join(backendDir, "server"),
    launcherScript: path.join(
      resourcesDir,
      platform === "win32" ? "start-gateway.bat" : "start-gateway.sh",
    ),
  };
}

/**
 * 读取并校验 runtime manifest。
 *
 * 这一步故意在启动前完成：架构错配要直接给出诊断，不能让用户看到
 * 一个含糊的“Gateway 启动失败”。
 */
export function readRuntimeManifest(filePath: string): RuntimeManifest {
  const raw = fs.readFileSync(filePath, "utf8");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") {
    throw new Error("Python runtime manifest 不是 JSON 对象");
  }
  const manifest = value as Partial<RuntimeManifest>;
  if (
    manifest.formatVersion !== 1 ||
    typeof manifest.platform !== "string" ||
    typeof manifest.arch !== "string" ||
    typeof manifest.pythonVersion !== "string" ||
    typeof manifest.pythonExecutable !== "string"
  ) {
    throw new Error("Python runtime manifest 缺少必需字段");
  }
  return manifest as RuntimeManifest;
}

export function assertRuntimeMatchesProcess(
  manifest: RuntimeManifest,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): void {
  if (manifest.platform !== platform || manifest.arch !== arch) {
    throw new Error(
      `Python runtime 架构不匹配：manifest=${manifest.platform}/${manifest.arch}, ` +
        `Electron=${platform}/${arch}`,
    );
  }
}

export function resolveManifestExecutable(
  paths: BackendRuntimePaths,
  manifest: RuntimeManifest,
): string {
  // manifest 中只能使用相对路径，避免构建机绝对路径泄漏到发布包。
  if (path.isAbsolute(manifest.pythonExecutable)) {
    throw new Error("Python runtime manifest 不允许包含绝对路径");
  }
  const executable = path.resolve(paths.pythonDir, manifest.pythonExecutable);
  const runtimeRoot = path.resolve(paths.pythonDir);
  if (executable !== runtimeRoot && !executable.startsWith(`${runtimeRoot}${path.sep}`)) {
    throw new Error("Python runtime executable 越过了 runtime 目录");
  }
  return executable;
}

export function assertExecutable(filePath: string, platform: NodeJS.Platform = process.platform): void {
  const mode = platform === "win32" ? fs.constants.F_OK : fs.constants.F_OK | fs.constants.X_OK;
  fs.accessSync(filePath, mode);
}
