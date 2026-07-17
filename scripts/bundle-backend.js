/**
 * bundle-backend.js
 *
 * 将 Python 嵌入式运行时 + ftre 后端代码 + ftre-agent-core 打包到 desktop/backend/ 目录
 * 供 electron-builder 一并打包进最终应用。
 *
 * 支持增量打包：
 * - Python 运行时和 pip 依赖只在首次或依赖变化时安装
 * - 后端代码每次都会同步（增量复制）
 *
 * 用法:
 *   node scripts/bundle-backend.js          # 增量打包
 *   node scripts/bundle-backend.js --clean  # 全量重新打包
 *
 * 环境变量:
 *   FTRE_ROOT            — ftre 后端仓库根目录（默认 ../../ftre）
 *   FTRE_AGENT_CORE_ROOT — ftre-agent-core 仓库根目录（默认 ../../ftre-agent-core）
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const https = require("https");
const http = require("http");
const crypto = require("crypto");

const DESKTOP_DIR = path.resolve(__dirname, "..");
// 后端项目路径：环境变量优先，其次相对路径 fallback
const PROJECT_ROOT =
  process.env.FTRE_ROOT || path.resolve(__dirname, "..", "..", "ftre");
const AGENT_CORE_ROOT =
  process.env.FTRE_AGENT_CORE_ROOT ||
  path.resolve(__dirname, "..", "..", "ftre-agent-core");
const BACKEND_DIR = path.join(DESKTOP_DIR, "backend");

const PYTHON_VERSION = "3.12.3";
const PYTHON_EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
const GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";

// Python 嵌入式包的 .pth 文件名（基于主版本号）
const PTH_FILE = `python${PYTHON_VERSION.split(".").slice(0, 2).join("")}._pth`;

// 缓存目录
const CACHE_DIR = path.join(DESKTOP_DIR, ".cache");
// 状态文件，记录上次打包的 hash
const STATE_FILE = path.join(CACHE_DIR, "bundle-state.json");

// --- 工具函数 ---

function log(msg) {
  console.log(`[bundle] ${msg}`);
}

function rmrf(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** 计算文件的 MD5 hash */
function fileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(content).digest("hex");
}

/** 计算目录的 hash（基于文件列表和修改时间） */
function dirHash(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  const hash = crypto.createHash("md5");

  function walkDir(dir) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name === "__pycache__" || item.name === ".pyc") continue;
      if (item.name === "node_modules" || item.name === ".git") continue;
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        walkDir(fullPath);
      } else {
        const stat = fs.statSync(fullPath);
        hash.update(`${fullPath}:${stat.mtimeMs}:${stat.size}`);
      }
    }
  }

  walkDir(dirPath);
  return hash.digest("hex");
}

/** 读取上次打包状态 */
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

/** 保存打包状态 */
function saveState(state) {
  mkdirp(CACHE_DIR);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

/** 增量同步目录：只复制新增或修改的文件，删除多余的文件 */
function syncDirIncremental(src, dest) {
  mkdirp(dest);

  const srcItems = new Set();
  const items = fs.readdirSync(src, { withFileTypes: true });

  for (const item of items) {
    if (item.name === "__pycache__" || item.name === ".pyc") continue;
    if (item.name === "node_modules" || item.name === ".git") continue;

    srcItems.add(item.name);
    const srcPath = path.join(src, item.name);
    const destPath = path.join(dest, item.name);

    if (item.isDirectory()) {
      syncDirIncremental(srcPath, destPath);
    } else {
      if (fs.existsSync(destPath)) {
        const srcStat = fs.statSync(srcPath);
        const destStat = fs.statSync(destPath);
        if (
          srcStat.mtimeMs <= destStat.mtimeMs &&
          srcStat.size === destStat.size
        ) {
          continue;
        }
      }
      fs.copyFileSync(srcPath, destPath);
    }
  }

  // 删除目标目录中多余的文件
  if (fs.existsSync(dest)) {
    const destItems = fs.readdirSync(dest, { withFileTypes: true });
    for (const item of destItems) {
      if (!srcItems.has(item.name)) {
        const destPath = path.join(dest, item.name);
        rmrf(destPath);
      }
    }
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    log(`下载 ${url} ...`);
    const file = fs.createWriteStream(dest);
    const get = url.startsWith("https") ? https.get : http.get;

    const request = (currentUrl) => {
      get(currentUrl, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          file.close();
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          log(`下载完成: ${path.basename(dest)}`);
          resolve();
        });
      }).on("error", (err) => {
        file.close();
        fs.unlinkSync(dest);
        reject(err);
      });
    };

    request(url);
  });
}

// --- 主流程 ---

async function main() {
  const args = process.argv.slice(2);
  const forceClean = args.includes("--clean") || args.includes("-c");

  log("=== 开始打包后端 ===");
  log(`后端根目录: ${PROJECT_ROOT}`);
  log(`agent-core 根目录: ${AGENT_CORE_ROOT}`);

  // 校验路径存在
  if (!fs.existsSync(path.join(PROJECT_ROOT, "pyproject.toml"))) {
    throw new Error(`未找到 ftre 后端: ${PROJECT_ROOT}/pyproject.toml\n请设置 FTRE_ROOT 环境变量`);
  }
  if (!fs.existsSync(path.join(AGENT_CORE_ROOT, "pyproject.toml"))) {
    throw new Error(`未找到 ftre-agent-core: ${AGENT_CORE_ROOT}/pyproject.toml\n请设置 FTRE_AGENT_CORE_ROOT 环境变量`);
  }

  if (forceClean) {
    log("强制全量重新打包（--clean）");
  }

  const state = forceClean ? {} : loadState();
  const newState = {};

  const pythonDir = path.join(BACKEND_DIR, "python");
  const serverDir = path.join(BACKEND_DIR, "server");
  const pythonExe = path.join(pythonDir, "python.exe");

  // =========================================================================
  // 1. Python 运行时（只在首次或强制清理时安装）
  // =========================================================================
  const pythonInstalled = fs.existsSync(pythonExe);

  if (!pythonInstalled || forceClean) {
    log("安装 Python 运行时...");

    // 清理旧目录
    rmrf(pythonDir);
    mkdirp(pythonDir);

    const zipPath = path.join(BACKEND_DIR, "python-embed.zip");
    const cachedZip = path.join(
      CACHE_DIR,
      `python-${PYTHON_VERSION}-embed-amd64.zip`,
    );

    if (fs.existsSync(cachedZip)) {
      log("使用缓存的 Python 嵌入式包");
      fs.copyFileSync(cachedZip, zipPath);
    } else {
      await downloadFile(PYTHON_EMBED_URL, zipPath);
      mkdirp(CACHE_DIR);
      fs.copyFileSync(zipPath, cachedZip);
    }

    // 解压 Python
    log("解压嵌入式 Python...");
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${pythonDir}' -Force"`,
      { stdio: "inherit" },
    );
    fs.unlinkSync(zipPath);

    // 修改 .pth 文件，启用 site 机制并添加 server 目录到 sys.path
    const pthPath = path.join(pythonDir, PTH_FILE);
    if (fs.existsSync(pthPath)) {
      let content = fs.readFileSync(pthPath, "utf-8");
      content = content.replace(/^#\s*import site/m, "import site");
      content += "\n..\\server\n";
      fs.writeFileSync(pthPath, content, "utf-8");
      log(`已修改 ${PTH_FILE}`);
    }

    // 安装 pip
    const getPipPath = path.join(BACKEND_DIR, "get-pip.py");
    const cachedGetPip = path.join(CACHE_DIR, "get-pip.py");
    if (fs.existsSync(cachedGetPip)) {
      log("使用缓存的 get-pip.py");
      fs.copyFileSync(cachedGetPip, getPipPath);
    } else {
      await downloadFile(GET_PIP_URL, getPipPath);
      mkdirp(CACHE_DIR);
      fs.copyFileSync(getPipPath, cachedGetPip);
    }

    log("安装 pip...");
    execSync(`"${pythonExe}" "${getPipPath}" --no-warn-script-location`, {
      stdio: "inherit",
      cwd: pythonDir,
    });
    fs.unlinkSync(getPipPath);

    // 首次安装，强制安装依赖
    state.ftreHash = null;
    state.agentCoreHash = null;
  } else {
    log("✓ Python 运行时已存在，跳过");
  }

  // =========================================================================
  // 2. ftre-agent-core（只在代码变化时重新安装）
  // =========================================================================
  const currentAgentCoreHash = dirHash(path.join(AGENT_CORE_ROOT, "src"));
  newState.agentCoreHash = currentAgentCoreHash;

  if (currentAgentCoreHash !== state.agentCoreHash) {
    log("安装 ftre-agent-core（代码已变化）...");
    execSync(
      `"${pythonExe}" -m pip install "${AGENT_CORE_ROOT}" --no-warn-script-location --no-cache-dir -q`,
      { stdio: "inherit", cwd: pythonDir },
    );
  } else {
    log("✓ ftre-agent-core 无变化，跳过");
  }

  // =========================================================================
  // 3. ftre 后端（只在代码变化时重新安装）
  // =========================================================================
  const currentFtreHash = dirHash(path.join(PROJECT_ROOT, "src"));
  newState.ftreHash = currentFtreHash;

  if (currentFtreHash !== state.ftreHash) {
    log("安装 ftre（代码已变化）...");
    execSync(
      `"${pythonExe}" -m pip install "${PROJECT_ROOT}" --no-warn-script-location --no-cache-dir -q`,
      { stdio: "inherit", cwd: pythonDir },
    );
  } else {
    log("✓ ftre 无变化，跳过");
  }

  // =========================================================================
  // 4. 同步后端源码（增量复制 src/ftre/ → server/ftre/）
  // =========================================================================
  log("同步后端源码（增量）...");
  mkdirp(serverDir);

  const ftreSrcDir = path.join(PROJECT_ROOT, "src", "ftre");
  const ftreDestDir = path.join(serverDir, "ftre");
  if (fs.existsSync(ftreSrcDir)) {
    log("  - src/ftre/");
    syncDirIncremental(ftreSrcDir, ftreDestDir);
  }

  // 同步 pyproject.toml（用于版本信息）
  const pyprojectSrc = path.join(PROJECT_ROOT, "pyproject.toml");
  const pyprojectDest = path.join(serverDir, "pyproject.toml");
  if (fs.existsSync(pyprojectSrc)) {
    const srcHash = fileHash(pyprojectSrc);
    const destHash = fileHash(pyprojectDest);
    if (srcHash !== destHash) {
      log("  - pyproject.toml");
      fs.copyFileSync(pyprojectSrc, pyprojectDest);
    }
  }

  // 确保 data 目录存在（SQLite + logs）
  mkdirp(path.join(serverDir, "data", "logs"));

  // =========================================================================
  // 5. 保存状态并统计
  // =========================================================================
  saveState(newState);

  const totalSize = getDirSize(BACKEND_DIR);
  log(`=== 后端打包完成 ===`);
  log(`目录: ${BACKEND_DIR}`);
  log(`总大小: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
}

function getDirSize(dir) {
  let size = 0;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      size += fs.statSync(fullPath).size;
    }
  }
  return size;
}

main().catch((err) => {
  console.error("[bundle] 错误:", err);
  process.exit(1);
});
