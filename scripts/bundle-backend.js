/**
 * 将 ftre、ftre-agent-core 以及架构匹配的 Python runtime 打包到 backend/。
 *
 * 发布模式的核心约束是：安装包不能依赖用户机器上的 Python、Node、Homebrew
 * 或仓库源码。Windows 使用官方 embedded Python；macOS 使用按 x64/arm64
 * 分发的 python-build-standalone install_only runtime。
 *
 * 用法：
 *   node scripts/bundle-backend.js --clean --platform darwin --arch arm64
 *   node scripts/bundle-backend.js --clean --platform win32 --arch x64
 *   node scripts/bundle-backend.js --clean --skip-deps --platform darwin --arch x64
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const https = require("https");
const http = require("http");
const crypto = require("crypto");

const DESKTOP_DIR = path.resolve(__dirname, "..");
const PROJECT_ROOT = process.env.FTRE_ROOT || path.resolve(__dirname, "..", "..", "..", "ftre");
const AGENT_CORE_ROOT = process.env.FTRE_AGENT_CORE_ROOT ||
  path.resolve(__dirname, "..", "..", "..", "ftre-agent-core");
const CORDIS_ROOT = process.env.CORDIS_ROOT ||
  path.resolve(__dirname, "..", "..", "..", "cordis-py");
const BACKEND_DIR = path.join(DESKTOP_DIR, "backend");
const CACHE_DIR = path.join(DESKTOP_DIR, ".cache");
const STATE_FILE = path.join(CACHE_DIR, "bundle-state.json");

const WINDOWS_PYTHON_VERSION = "3.12.3";
const STANDALONE_RELEASE = process.env.PYTHON_STANDALONE_RELEASE || "20260814";
const STANDALONE_VERSION = process.env.PYTHON_STANDALONE_VERSION || "3.12.14";
const STANDALONE_BASE_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${STANDALONE_RELEASE}`;
const STANDALONE_DIGESTS = {
  "x64": "1a94c83264731e9603fbea78e57e7ca8f20e7d91eb866627ac2304621b0f6f1f",
  "arm64": "4572133a5542f306b9bdb155da5800f9e38950cd0a98d469b832ce256fe299ea",
};

function log(message) {
  console.log(`[bundle] ${message}`);
}

function rmrf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function mkdirp(target) {
  fs.mkdirSync(target, { recursive: true });
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function fileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return sha256File(filePath);
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  mkdirp(CACHE_DIR);
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function parseArg(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function normalizeArch(value) {
  if (value === "amd64") return "x64";
  if (value === "aarch64") return "arm64";
  return value;
}

function targetFromArgs(args) {
  const platform = parseArg(args, "--platform") || process.env.FTRE_TARGET_PLATFORM || process.platform;
  const arch = normalizeArch(parseArg(args, "--arch") || process.env.FTRE_TARGET_ARCH || process.arch);
  if (platform !== "win32" && platform !== "darwin") {
    throw new Error(`暂不支持为 ${platform} 打包内置 Gateway；目标必须是 win32 或 darwin`);
  }
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`不支持的目标架构：${arch}；目标必须是 x64 或 arm64`);
  }
  if (platform === "win32" && arch !== "x64") {
    throw new Error("Windows 当前只发布 x64 包");
  }
  return { platform, arch };
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    // GitHub release资产在部分 Windows 代理下会让 Node HTTPS 流在收到部分
    // 内容后迟迟不触发 finish；系统 curl 在 macOS、Windows runner 都可用，
    // 优先使用它并保留 Node fallback。
    try {
      execFileSync(process.platform === "win32" ? "curl.exe" : "curl", [
        "--location",
        "--fail",
        "--silent",
        "--show-error",
        "--retry", "3",
        "--retry-all-errors",
        "--connect-timeout", "30",
        "--max-time", "600",
        "--output", destination,
        url,
      ], { stdio: "inherit" });
      resolve();
      return;
    } catch (curlError) {
      log(`curl 下载失败，回退 Node HTTPS：${curlError instanceof Error ? curlError.message : String(curlError)}`);
    }
    const request = (currentUrl, redirects = 0) => {
      if (redirects > 5) return reject(new Error(`下载重定向次数过多：${currentUrl}`));
      const client = currentUrl.startsWith("https:") ? https : http;
      client.get(currentUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          request(new URL(response.headers.location, currentUrl).toString(), redirects + 1);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`下载失败 HTTP ${response.statusCode}：${currentUrl}`));
          return;
        }
        mkdirp(path.dirname(destination));
        const file = fs.createWriteStream(destination);
        response.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", (error) => {
          file.close(() => {});
          rmrf(destination);
          reject(error);
        });
      }).on("error", (error) => {
        rmrf(destination);
        reject(error);
      });
    };
    request(url);
  });
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function extractWindowsZip(archive, destination) {
  execFileSync("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Expand-Archive -LiteralPath ${powershellQuote(archive)} -DestinationPath ${powershellQuote(destination)} -Force`,
  ], { stdio: "inherit" });
}

function extractMacTar(archive, destination) {
  execFileSync("tar", ["-xzf", archive, "-C", destination], { stdio: "inherit" });
}

function findFile(root, predicate) {
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, item.name);
      if (item.isDirectory()) {
        queue.push(fullPath);
      } else if (predicate(fullPath, item.name)) {
        return fullPath;
      }
    }
  }
  return null;
}

function copyExtractedRuntime(extractedRoot, pythonDir, platform) {
  const executable = platform === "win32"
    ? findFile(extractedRoot, (_fullPath, name) => name === "python.exe")
    : findFile(extractedRoot, (fullPath, name) => name === "python3.12" && fullPath.includes(`${path.sep}bin${path.sep}`));
  if (!executable) throw new Error(`解压后的 Python runtime 中找不到解释器：${extractedRoot}`);

  const runtimeRoot = platform === "win32"
    ? path.dirname(executable)
    : path.dirname(path.dirname(executable));
  fs.cpSync(runtimeRoot, pythonDir, { recursive: true, dereference: false });
  const relativeExecutable = path.relative(pythonDir, path.join(
    pythonDir,
    path.relative(runtimeRoot, executable),
  ));
  if (platform !== "win32") fs.chmodSync(path.join(pythonDir, relativeExecutable), 0o755);
  return { executable: path.join(pythonDir, relativeExecutable), relativeExecutable };
}

async function installPythonRuntime(target, pythonDir, forceClean) {
  const runtimeManifestPath = path.join(pythonDir, "runtime.json");
  let existing = null;
  if (!forceClean && fs.existsSync(runtimeManifestPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8"));
    } catch {
      existing = null;
    }
  }
  const expectedExecutable = target.platform === "win32"
    ? path.join(pythonDir, "python.exe")
    : path.join(pythonDir, "bin", "python3.12");
  if (
    existing &&
    existing.platform === target.platform &&
    existing.arch === target.arch &&
    fs.existsSync(expectedExecutable)
  ) {
    log(`✓ 已存在 ${target.platform}/${target.arch} Python runtime，跳过下载`);
    return { executable: expectedExecutable, manifest: existing };
  }

  rmrf(pythonDir);
  mkdirp(pythonDir);
  const cacheKey = target.platform === "win32"
    ? `python-${WINDOWS_PYTHON_VERSION}-embed-amd64.zip`
    : `cpython-${STANDALONE_VERSION}-${STANDALONE_RELEASE}-${target.arch}-apple-darwin-install_only.tar.gz`;
  const archive = path.join(BACKEND_DIR, cacheKey);
  const cached = path.join(CACHE_DIR, cacheKey);
  let sourceUrl;
  let expectedDigest;
  if (target.platform === "win32") {
    sourceUrl = `https://www.python.org/ftp/python/${WINDOWS_PYTHON_VERSION}/python-${WINDOWS_PYTHON_VERSION}-embed-amd64.zip`;
  } else {
    const triple = target.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
    const name = `cpython-${STANDALONE_VERSION}+${STANDALONE_RELEASE}-${triple}-install_only.tar.gz`;
    sourceUrl = `${STANDALONE_BASE_URL}/${encodeURIComponent(name).replace(/%2B/g, "%2B")}`;
    expectedDigest = process.env.PYTHON_STANDALONE_SHA256 || STANDALONE_DIGESTS[target.arch];
  }
  if (fs.existsSync(cached)) {
    fs.copyFileSync(cached, archive);
    log(`使用缓存的 Python runtime：${cacheKey}`);
  } else {
    log(`下载 ${sourceUrl}`);
    await downloadFile(sourceUrl, archive);
    mkdirp(CACHE_DIR);
    fs.copyFileSync(archive, cached);
  }
  const archiveSha256 = sha256File(archive);
  if (expectedDigest && archiveSha256 !== expectedDigest) {
    throw new Error(`Python runtime 校验和不匹配：expected=${expectedDigest}, actual=${archiveSha256}`);
  }

  const extracted = path.join(BACKEND_DIR, `.python-extract-${target.platform}-${target.arch}`);
  rmrf(extracted);
  mkdirp(extracted);
  if (target.platform === "win32") extractWindowsZip(archive, extracted);
  else extractMacTar(archive, extracted);
  const copied = copyExtractedRuntime(extracted, pythonDir, target.platform);
  rmrf(extracted);
  rmrf(archive);

  if (target.platform === "win32") {
    const pthFile = path.join(pythonDir, `python${WINDOWS_PYTHON_VERSION.split(".").slice(0, 2).join("")}._pth`);
    if (fs.existsSync(pthFile)) {
      let content = fs.readFileSync(pthFile, "utf8").replace(/^#\s*import site/m, "import site");
      const serverRelative = path.relative(pythonDir, path.join(BACKEND_DIR, "server"));
      if (!content.split(/\r?\n/).includes(serverRelative)) content += `\n${serverRelative}\n`;
      fs.writeFileSync(pthFile, content, "utf8");
    }
  }

  const manifest = {
    formatVersion: 1,
    platform: target.platform,
    arch: target.arch,
    pythonVersion: target.platform === "win32" ? WINDOWS_PYTHON_VERSION : STANDALONE_VERSION,
    pythonExecutable: copied.relativeExecutable.split(path.sep).join("/"),
    source: target.platform === "win32" ? "python.org-embedded" : "python-build-standalone",
    sourceUrl,
    archiveSha256,
    runtimeSha256: sha256File(copied.executable),
  };
  fs.writeFileSync(runtimeManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  log(`Python runtime 已安装：${manifest.platform}/${manifest.arch} ${manifest.pythonVersion}`);
  return { executable: copied.executable, manifest };
}

function syncDirIncremental(source, destination) {
  mkdirp(destination);
  const sourceItems = new Set();
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    if (item.name === "__pycache__" || item.name.endsWith(".pyc") || item.name === ".git") continue;
    sourceItems.add(item.name);
    const sourcePath = path.join(source, item.name);
    const destinationPath = path.join(destination, item.name);
    if (item.isDirectory()) syncDirIncremental(sourcePath, destinationPath);
    else {
      const sourceStat = fs.statSync(sourcePath);
      let unchanged = false;
      try {
        const destinationStat = fs.statSync(destinationPath);
        unchanged = sourceStat.size === destinationStat.size && sourceStat.mtimeMs <= destinationStat.mtimeMs;
      } catch {
        unchanged = false;
      }
      if (!unchanged) fs.copyFileSync(sourcePath, destinationPath);
    }
  }
  for (const item of fs.readdirSync(destination, { withFileTypes: true })) {
    if (!sourceItems.has(item.name)) rmrf(path.join(destination, item.name));
  }
}

/**
 * 复制 ftre 仓内 Package 的源码到自包含 Gateway。
 *
 * 这些 Package 在开发仓库里通过 workspace 的 package-dir 提供，未必已经
 * 发布到 PyPI；运行时只安装第三方依赖，因此必须把本地源码一起带入包。
 * 只收集带 pyproject.toml 的正式 Package，并过滤 egg-info/缓存目录，避免
 * 把开发环境元数据和生成文件带进最终客户端。
 */
function copyLocalPackageSources(projectRoot, serverDir) {
  const packagesRoot = path.join(projectRoot, "packages");
  if (!fs.existsSync(packagesRoot)) return [];

  const copied = [];
  for (const packageEntry of fs.readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!packageEntry.isDirectory()) continue;
    const packageRoot = path.join(packagesRoot, packageEntry.name);
    if (!fs.existsSync(path.join(packageRoot, "pyproject.toml"))) continue;

    const sourceRoot = path.join(packageRoot, "src");
    if (!fs.existsSync(sourceRoot)) continue;
    for (const sourceEntry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
      if (
        sourceEntry.name === "__pycache__" ||
        sourceEntry.name === ".git" ||
        sourceEntry.name.endsWith(".pyc") ||
        sourceEntry.name.endsWith(".egg-info")
      ) continue;

      const sourcePath = path.join(sourceRoot, sourceEntry.name);
      const destinationPath = path.join(serverDir, sourceEntry.name);
      if (sourceEntry.isDirectory()) syncDirIncremental(sourcePath, destinationPath);
      else fs.copyFileSync(sourcePath, destinationPath);
      copied.push(path.relative(serverDir, destinationPath).split(path.sep).join("/"));
    }
  }
  return copied;
}

function cleanPycache(root) {
  if (!fs.existsSync(root)) return;
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, item.name);
    if (item.isDirectory() && item.name === "__pycache__") rmrf(fullPath);
    else if (item.isDirectory()) cleanPycache(fullPath);
    else if (item.name.endsWith(".pyc")) fs.rmSync(fullPath, { force: true });
  }
}

function getDirSize(root) {
  let total = 0;
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, item.name);
    total += item.isDirectory() ? getDirSize(fullPath) : fs.statSync(fullPath).size;
  }
  return total;
}

function projectVersion(pyprojectPath) {
  try {
    const text = fs.readFileSync(pyprojectPath, "utf8");
    return text.match(/^version\s*=\s*["']([^"']+)["']/m)?.[1] || "unknown";
  } catch {
    return "unknown";
  }
}

function copyLicense(root, label, destination) {
  const candidates = ["LICENSE", "LICENSE.txt", "LICENSE.md", "NOTICE"];
  for (const name of candidates) {
    const source = path.join(root, name);
    if (!fs.existsSync(source)) continue;
    const target = path.join(destination, `${label}-${name}`);
    fs.copyFileSync(source, target);
    return path.relative(BACKEND_DIR, target).split(path.sep).join("/");
  }
  return null;
}

function writeBundleManifest(target, runtime) {
  const licensesDir = path.join(BACKEND_DIR, "licenses");
  mkdirp(licensesDir);
  const licenseFiles = [
    copyLicense(PROJECT_ROOT, "ftre", licensesDir),
    copyLicense(AGENT_CORE_ROOT, "ftre-agent-core", licensesDir),
    copyLicense(CORDIS_ROOT, "cordis-py", licensesDir),
  ].filter(Boolean);
  const manifest = {
    formatVersion: 1,
    platform: target.platform,
    arch: target.arch,
    commit: process.env.GITHUB_SHA || null,
    ftre: {
      version: projectVersion(path.join(PROJECT_ROOT, "pyproject.toml")),
    },
    agentCore: {
      version: projectVersion(path.join(AGENT_CORE_ROOT, "pyproject.toml")),
    },
    cordis: {
      version: projectVersion(path.join(CORDIS_ROOT, "pyproject.toml")),
    },
    python: runtime.manifest,
    licenseFiles,
    signatureStatus: process.env.CSC_LINK ? "configured" : "unsigned",
  };
  fs.writeFileSync(path.join(BACKEND_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function installPipIfNeeded(pythonExecutable, pythonDir) {
  try {
    execFileSync(pythonExecutable, ["-m", "pip", "--version"], { stdio: "ignore", cwd: pythonDir });
    return;
  } catch {
    // 极少数 standalone 发行物可能不含 pip；只在构建阶段补齐，运行时不联网。
  }
  const getPip = path.join(BACKEND_DIR, "get-pip.py");
  const cached = path.join(CACHE_DIR, "get-pip.py");
  return downloadFile(GET_PIP_URL, cached).then(() => {
    fs.copyFileSync(cached, getPip);
    execFileSync(pythonExecutable, [getPip, "--no-warn-script-location"], { stdio: "inherit", cwd: pythonDir });
    rmrf(getPip);
  });
}

const GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";

async function main() {
  const args = process.argv.slice(2);
  const forceClean = args.includes("--clean") || args.includes("-c");
  const skipDeps = args.includes("--skip-deps");
  const target = targetFromArgs(args);
  log(`=== 开始打包后端 ${target.platform}/${target.arch} ===`);
  log(`后端根目录：${PROJECT_ROOT}`);
  log(`agent-core 根目录：${AGENT_CORE_ROOT}`);
  log(`cordis-py 根目录：${CORDIS_ROOT}`);

  if (!fs.existsSync(path.join(PROJECT_ROOT, "pyproject.toml"))) {
    throw new Error(`未找到 ftre 后端：${PROJECT_ROOT}/pyproject.toml，请设置 FTRE_ROOT`);
  }
  if (!fs.existsSync(path.join(AGENT_CORE_ROOT, "pyproject.toml"))) {
    throw new Error(`未找到 ftre-agent-core：${AGENT_CORE_ROOT}/pyproject.toml，请设置 FTRE_AGENT_CORE_ROOT`);
  }
  if (!fs.existsSync(path.join(CORDIS_ROOT, "pyproject.toml"))) {
    throw new Error(`未找到 cordis-py：${CORDIS_ROOT}/pyproject.toml，请设置 CORDIS_ROOT`);
  }
  if (forceClean) log("强制全量重新打包");

  const state = forceClean ? {} : loadState();
  const targetKey = `${target.platform}-${target.arch}`;
  const pythonDir = path.join(BACKEND_DIR, "python");
  const serverDir = path.join(BACKEND_DIR, "server");
  mkdirp(BACKEND_DIR);
  // 上一次在其他平台被中断时可能留下半个 archive 或解压目录；这些文件
  // 不能进入最终 extraResources，也不能影响本次目标架构选择。
  for (const item of fs.readdirSync(BACKEND_DIR)) {
    if (item.startsWith(".python-extract-") || item.endsWith(".tar.gz") || item.endsWith("-embed.zip")) {
      rmrf(path.join(BACKEND_DIR, item));
    }
  }
  const runtime = await installPythonRuntime(target, pythonDir, forceClean);
  if (skipDeps) {
    log("仅准备 runtime，跳过目标平台 Python 依赖安装（用于非目标主机的结构验证）");
  } else {
    await installPipIfNeeded(runtime.executable, pythonDir);
  }

  const { parseTomlDeps } = require("./parse-deps");
  const agentCoreDeps = parseTomlDeps(path.join(AGENT_CORE_ROOT, "pyproject.toml"));
  const ftreDeps = parseTomlDeps(path.join(PROJECT_ROOT, "pyproject.toml"));

  // ftre 主仓 packages/ 下的独立发行物（monorepo Package）：源码随 bundle 复制
  // （见 copyLocalPackageSources），不进 pip 安装（PyPI 上不存在）。
  const monorepoRoot = path.join(PROJECT_ROOT, "packages");
  const monorepoPkgs = fs.existsSync(monorepoRoot)
    ? fs.readdirSync(monorepoRoot)
        .filter((dir) => fs.existsSync(path.join(monorepoRoot, dir, "pyproject.toml")))
    : [];
  // ownPkgs = 以源码复制方式进入 bundle 的包。注意必须精确匹配包名：
  // 前缀匹配会把 "ftre-llm"/"ftre-inbox" 等全部当成 "ftre" 误过滤，
  // 导致这些包既不 pip 安装又不复制源码（2026-08-27 v0.1.15 回归教训）。
  const pkgName = (dependency) => dependency.replace(/[<>=!~].*$/, "").trim();
  const ownPkgs = ["ftre-agent-core", "ftre", "cordis-py", "litellm", ...monorepoPkgs];
  const allDeps = [...new Set([...agentCoreDeps, ...ftreDeps])]
    .filter((dependency) => !ownPkgs.includes(pkgName(dependency)));
  const depsHash = crypto.createHash("sha256").update(`${targetKey}\n${allDeps.join("\n")}`).digest("hex");
  let preparedDepsHash = null;
  if (!skipDeps && (depsHash !== state.depsHash || forceClean)) {
    log(`安装 Python 依赖：${allDeps.join(", ")}`);
    for (const dependency of allDeps) {
      execFileSync(runtime.executable, ["-m", "pip", "install", dependency,
        "--disable-pip-version-check", "--no-warn-script-location", "--no-cache-dir", "-q"], {
        stdio: "inherit",
        cwd: pythonDir,
      });
    }
    preparedDepsHash = depsHash;
  } else if (!skipDeps) {
    log("✓ Python 依赖无变化，跳过安装");
    preparedDepsHash = depsHash;
  }

  if (target.platform === "win32") {
    try {
      execFileSync(runtime.executable, ["-m", "pip", "uninstall", "-y", "pip", "setuptools", "wheel"], {
        stdio: "ignore", cwd: pythonDir,
      });
    } catch {
      // 清理失败不影响已经完成的依赖安装。
    }
    rmrf(path.join(pythonDir, "Scripts"));
  }
  cleanPycache(pythonDir);

  mkdirp(serverDir);
  const ftreSrc = path.join(PROJECT_ROOT, "src", "ftre");
  const ftreDest = path.join(serverDir, "ftre");
  if (fs.existsSync(ftreSrc)) syncDirIncremental(ftreSrc, ftreDest);
  const coreSrc = path.join(AGENT_CORE_ROOT, "src", "ftre_agent_core");
  const coreDest = path.join(serverDir, "ftre_agent_core");
  if (fs.existsSync(coreSrc)) syncDirIncremental(coreSrc, coreDest);
  const cordisSrc = path.join(CORDIS_ROOT, "src", "cordis");
  const cordisDest = path.join(serverDir, "cordis");
  if (fs.existsSync(cordisSrc)) syncDirIncremental(cordisSrc, cordisDest);
  const localPackages = copyLocalPackageSources(PROJECT_ROOT, serverDir);
  log(`本地 Package 源码已复制：${localPackages.length} 项`);
  const pyprojectSrc = path.join(PROJECT_ROOT, "pyproject.toml");
  if (fs.existsSync(pyprojectSrc)) fs.copyFileSync(pyprojectSrc, path.join(serverDir, "pyproject.toml"));
  mkdirp(path.join(serverDir, "data", "logs"));
  if (target.platform === "darwin") {
    // Git 在 Windows checkout 上可能丢失 executable bit；打包前明确恢复，
    // 让安装包中的手工 launcher 在 macOS 上可直接执行。
    fs.chmodSync(path.join(DESKTOP_DIR, "scripts", "start-gateway.sh"), 0o755);
  }
  writeBundleManifest(target, runtime);

  const nextState = { targetKey, depsHash: preparedDepsHash, pythonRuntime: runtime.manifest };
  saveState(nextState);
  log(`=== 后端打包完成：${(getDirSize(BACKEND_DIR) / 1024 / 1024).toFixed(1)} MB ===`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[bundle] 错误：", error);
    process.exit(1);
  });
}

module.exports = { copyLocalPackageSources, syncDirIncremental };
