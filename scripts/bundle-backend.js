/**
 * bundle-backend.js
 *
 * 将 Python 嵌入式运行时 + 后端代码 + pip 依赖打包到 desktop/backend/ 目录
 * 供 electron-builder 一并打包进最终应用。
 *
 * 支持增量打包：
 * - Python 运行时和 pip 依赖只在首次或 requirements.txt 变化时安装
 * - 后端代码每次都会同步（但使用增量复制）
 *
 * 用法:
 *   node scripts/bundle-backend.js          # 增量打包
 *   node scripts/bundle-backend.js --clean  # 全量重新打包
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const https = require("https");
const http = require("http");
const crypto = require("crypto");

const DESKTOP_DIR = path.resolve(__dirname, "..");
// 后端项目绝对路径
const PROJECT_ROOT = "E:\\binn\\ai-base";
const AGENT_CORE_ROOT = "E:\\binn\\ftre-agent-core";
const BACKEND_DIR = path.join(DESKTOP_DIR, "backend");

const PYTHON_VERSION = "3.11.8";
const PYTHON_EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
const GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";

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

function copyDirSync(src, dest, filter) {
  mkdirp(dest);
  const items = fs.readdirSync(src, { withFileTypes: true });
  for (const item of items) {
    if (item.name === "__pycache__" || item.name === ".pyc") continue;
    if (item.name === "node_modules" || item.name === ".git") continue;
    const srcPath = path.join(src, item.name);
    const destPath = path.join(dest, item.name);
    if (filter && !filter(srcPath, item)) continue;
    if (item.isDirectory()) {
      copyDirSync(srcPath, destPath, filter);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
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
      // 检查是否需要复制
      if (fs.existsSync(destPath)) {
        const srcStat = fs.statSync(srcPath);
        const destStat = fs.statSync(destPath);
        // 只有当源文件更新时才复制
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
        // 处理重定向
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

    // 修改 python311._pth
    const pthFile = path.join(pythonDir, `python311._pth`);
    if (fs.existsSync(pthFile)) {
      let content = fs.readFileSync(pthFile, "utf-8");
      content = content.replace(/^#\s*import site/m, "import site");
      content += "\n..\\server\n";
      fs.writeFileSync(pthFile, content, "utf-8");
      log("已修改 python311._pth");
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
    state.requirementsHash = null;
    state.agentCoreHash = null;
  } else {
    log("✓ Python 运行时已存在，跳过");
  }

  // =========================================================================
  // 2. pip 依赖（只在 requirements.txt 变化时重新安装）
  // =========================================================================
  const requirementsFile = path.join(PROJECT_ROOT, "requirements.txt");
  const currentReqHash = fileHash(requirementsFile);
  newState.requirementsHash = currentReqHash;

  if (currentReqHash !== state.requirementsHash) {
    log("安装后端 Python 依赖（requirements.txt 已变化）...");
    execSync(
      `"${pythonExe}" -m pip install -r "${requirementsFile}" --no-warn-script-location --no-cache-dir -q`,
      { stdio: "inherit", cwd: pythonDir },
    );
  } else {
    log("✓ Python 依赖无变化，跳过");
  }

  // =========================================================================
  // 3. ftre-agent-core（只在变化时重新安装）
  // =========================================================================
  const currentAgentCoreHash = dirHash(AGENT_CORE_ROOT);
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
  // 4. 后端代码（增量同步）
  // =========================================================================
  log("同步后端代码（增量）...");
  mkdirp(serverDir);

  // app/
  log("  - app/");
  syncDirIncremental(
    path.join(PROJECT_ROOT, "app"),
    path.join(serverDir, "app"),
  );

  // packages/
  const packagesDir = path.join(serverDir, "packages");
  mkdirp(packagesDir);

  // 确保 __init__.py 存在
  const initFile = path.join(packagesDir, "__init__.py");
  if (!fs.existsSync(initFile)) {
    fs.writeFileSync(initFile, "", "utf-8");
  }

  const backendPackages = [
    "core",
    "storage",
    "workspace",
    "workflow",
    "shared",
    "sandbox",
    "shadow_git",
  ];

  for (const pkg of backendPackages) {
    const srcPkg = path.join(PROJECT_ROOT, "packages", pkg);
    if (fs.existsSync(srcPkg)) {
      log(`  - packages/${pkg}/`);
      syncDirIncremental(srcPkg, path.join(packagesDir, pkg));
    }
  }

  // =========================================================================
  // 5. 配置文件
  // =========================================================================
  const envSrc = path.join(PROJECT_ROOT, ".env");
  const envDest = path.join(serverDir, ".env");
  if (fs.existsSync(envSrc)) {
    const srcHash = fileHash(envSrc);
    const destHash = fileHash(envDest);
    if (srcHash !== destHash) {
      log("  - .env");
      fs.copyFileSync(envSrc, envDest);
    }
  }

  const reqSrc = path.join(PROJECT_ROOT, "requirements.txt");
  const reqDest = path.join(serverDir, "requirements.txt");
  if (fs.existsSync(reqSrc)) {
    const srcHash = fileHash(reqSrc);
    const destHash = fileHash(reqDest);
    if (srcHash !== destHash) {
      log("  - requirements.txt");
      fs.copyFileSync(reqSrc, reqDest);
    }
  }

  // 确保 data 目录存在
  mkdirp(path.join(serverDir, "data", "logs"));

  // =========================================================================
  // 6. 保存状态并统计
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
