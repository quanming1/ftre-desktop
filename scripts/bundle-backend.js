/**
 * bundle-backend.js
 *
 * 将 Python 嵌入式运行时 + 后端代码 + pip 依赖打包到 desktop/backend/ 目录
 * 供 electron-builder 一并打包进最终应用。
 *
 * 用法: node scripts/bundle-backend.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const https = require("https");
const http = require("http");

const DESKTOP_DIR = path.resolve(__dirname, "..");
// 后端项目绝对路径
const PROJECT_ROOT = "E:\\binn\\ai-base";
const AGENT_CORE_ROOT = "E:\\binn\\ftre-agent-core";
const BACKEND_DIR = path.join(DESKTOP_DIR, "backend");

const PYTHON_VERSION = "3.11.8";
const PYTHON_EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
const GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";

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
  log("=== 开始打包后端 ===");

  // 1. 清理
  log("清理旧的 backend 目录...");
  rmrf(BACKEND_DIR);
  mkdirp(BACKEND_DIR);

  // 2. 下载嵌入式 Python
  const pythonDir = path.join(BACKEND_DIR, "python");
  const zipPath = path.join(BACKEND_DIR, "python-embed.zip");

  // 检查是否已经有缓存的 zip
  const cacheDir = path.join(DESKTOP_DIR, ".cache");
  const cachedZip = path.join(
    cacheDir,
    `python-${PYTHON_VERSION}-embed-amd64.zip`,
  );

  if (fs.existsSync(cachedZip)) {
    log("使用缓存的 Python 嵌入式包");
    fs.copyFileSync(cachedZip, zipPath);
  } else {
    await downloadFile(PYTHON_EMBED_URL, zipPath);
    mkdirp(cacheDir);
    fs.copyFileSync(zipPath, cachedZip);
  }

  // 3. 解压 Python
  log("解压嵌入式 Python...");
  mkdirp(pythonDir);
  execSync(
    `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${pythonDir}' -Force"`,
    {
      stdio: "inherit",
    },
  );
  fs.unlinkSync(zipPath);

  // 4. 修改 python311._pth 启用 import site (pip 需要)
  const pthFile = path.join(pythonDir, `python311._pth`);
  if (fs.existsSync(pthFile)) {
    let content = fs.readFileSync(pthFile, "utf-8");
    // 取消注释 import site
    content = content.replace(/^#\s*import site/m, "import site");
    // 添加后端代码路径
    content += "\n..\\server\n";
    fs.writeFileSync(pthFile, content, "utf-8");
    log("已修改 python311._pth");
  }

  // 5. 安装 pip
  const getPipPath = path.join(BACKEND_DIR, "get-pip.py");
  const cachedGetPip = path.join(cacheDir, "get-pip.py");
  if (fs.existsSync(cachedGetPip)) {
    log("使用缓存的 get-pip.py");
    fs.copyFileSync(cachedGetPip, getPipPath);
  } else {
    await downloadFile(GET_PIP_URL, getPipPath);
    mkdirp(cacheDir);
    fs.copyFileSync(getPipPath, cachedGetPip);
  }

  const pythonExe = path.join(pythonDir, "python.exe");
  log("安装 pip...");
  execSync(`"${pythonExe}" "${getPipPath}" --no-warn-script-location`, {
    stdio: "inherit",
    cwd: pythonDir,
  });
  fs.unlinkSync(getPipPath);

  // 6. 安装后端依赖
  const requirementsFile = path.join(PROJECT_ROOT, "requirements.txt");
  log("安装后端 Python 依赖...");
  execSync(
    `"${pythonExe}" -m pip install -r "${requirementsFile}" --no-warn-script-location --no-cache-dir`,
    {
      stdio: "inherit",
      cwd: pythonDir,
    },
  );

  // 6.1 安装 ftre-agent-core 本地包
  log("安装 ftre-agent-core ...");
  execSync(
    `"${pythonExe}" -m pip install "${AGENT_CORE_ROOT}" --no-warn-script-location --no-cache-dir`,
    {
      stdio: "inherit",
      cwd: pythonDir,
    },
  );

  // 7. 复制后端代码
  const serverDir = path.join(BACKEND_DIR, "server");
  mkdirp(serverDir);

  log("复制 app/ ...");
  copyDirSync(path.join(PROJECT_ROOT, "app"), path.join(serverDir, "app"));

  log("复制 packages/ (仅 Python 后端包) ...");
  const packagesDir = path.join(serverDir, "packages");
  mkdirp(packagesDir);
  // 写入 packages/__init__.py
  fs.writeFileSync(path.join(packagesDir, "__init__.py"), "", "utf-8");

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
      copyDirSync(srcPkg, path.join(packagesDir, pkg));
      log(`  - packages/${pkg}/`);
    }
  }

  // 8. 复制配置文件
  log("复制配置文件...");
  fs.copyFileSync(
    path.join(PROJECT_ROOT, ".env"),
    path.join(serverDir, ".env"),
  );
  fs.copyFileSync(
    path.join(PROJECT_ROOT, "requirements.txt"),
    path.join(serverDir, "requirements.txt"),
  );

  // 9. 创建 data 目录
  mkdirp(path.join(serverDir, "data", "logs"));

  // 10. 统计大小
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
