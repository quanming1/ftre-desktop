const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const {
  assertRuntimeMatchesProcess,
  readRuntimeManifest,
  resolveBackendRuntime,
  resolveManifestExecutable,
} = require("../../packages/electron/dist/backend-runtime.js");
const { waitForBackendReady } = require("../../packages/electron/dist/backend-readiness.js");
const { WorkerManager } = require("../../packages/electron/dist/ipc/worker-manager.js");
const { collectExternalDependencies, copyLocalPackageSources } = require("../bundle-backend.js");

test("bundle-backend 复制仓内 Package 源码并过滤开发元数据", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ftre-package-sources-"));
  const project = path.join(root, "project");
  const packages = path.join(project, "packages");
  const server = path.join(root, "server");
  fs.mkdirSync(path.join(packages, "ftre-llm", "src", "ftre_llm"), { recursive: true });
  fs.mkdirSync(path.join(packages, "ftre-llm", "src", "ftre_llm.egg-info"), { recursive: true });
  fs.mkdirSync(path.join(packages, "ftre-llm", "src", "ftre_llm", "__pycache__"), { recursive: true });
  fs.writeFileSync(path.join(packages, "ftre-llm", "pyproject.toml"), "[project]\nname='ftre-llm'\n", "utf8");
  fs.writeFileSync(path.join(packages, "ftre-llm", "src", "ftre_llm", "contracts.py"), "VALUE = 1\n", "utf8");
  fs.writeFileSync(path.join(packages, "ftre-llm", "src", "ftre_llm.egg-info", "PKG-INFO"), "metadata\n", "utf8");
  fs.writeFileSync(path.join(packages, "ftre-llm", "src", "ftre_llm", "__pycache__", "contracts.pyc"), "cache\n", "utf8");
  fs.mkdirSync(path.join(packages, "not-a-package", "src", "ignored"), { recursive: true });
  fs.writeFileSync(path.join(packages, "not-a-package", "src", "ignored", "module.py"), "VALUE = 2\n", "utf8");
  fs.mkdirSync(path.join(server, "ftre_agent_core"), { recursive: true });
  fs.writeFileSync(path.join(server, "ftre_agent_core", "__init__.py"), "legacy\n", "utf8");

  try {
    const copied = copyLocalPackageSources(project, server);
    assert.deepEqual(copied, ["ftre_llm"]);
    assert.equal(fs.readFileSync(path.join(server, "ftre_llm", "contracts.py"), "utf8"), "VALUE = 1\n");
    assert.equal(fs.existsSync(path.join(server, "ftre_llm.egg-info")), false);
    assert.equal(fs.existsSync(path.join(server, "ftre_llm", "__pycache__")), false);
    assert.equal(fs.existsSync(path.join(server, "ignored")), false);
    assert.equal(fs.existsSync(path.join(server, "ftre_agent_core")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bundle-backend 收集 workspace Package 的外部依赖", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ftre-package-deps-"));
  fs.mkdirSync(path.join(root, "packages", "ftre-llm"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "pyproject.toml"),
    '[project]\ndependencies = [\n  "ftre-llm>=0.1.0,<0.2.0"\n]\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "packages", "ftre-llm", "pyproject.toml"),
    '[project]\ndependencies = [\n  "openai>=1.0.0"\n]\n',
    "utf8",
  );

  try {
    const { externalDeps, monorepoPkgs } = collectExternalDependencies(root);
    assert.deepEqual(monorepoPkgs, ["ftre-llm"]);
    assert.deepEqual(externalDeps, ["openai>=1.0.0"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("electron-builder 声明 Mac dmg/zip 双架构产物和 bundled backend", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../../electron-builder-full.json"), "utf8"));
  const targets = config.mac.target;
  assert.deepEqual(targets.map((target) => target.target), ["dmg", "zip"]);
  for (const target of targets) assert.deepEqual(target.arch, ["x64", "arm64"]);
  assert.equal(config.mac.artifactName, "ftre-${version}-mac-${arch}.${ext}");
  assert.ok(config.extraResources.some((resource) => resource.from === "backend/"));
  assert.ok(config.extraResources.some((resource) => resource.from === "scripts/start-gateway.sh"));
});

test("Windows、macOS、托盘与 renderer 使用统一品牌资源", () => {
  const packageConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"));
  const fullConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "../../electron-builder-full.json"), "utf8"));
  const windowSource = fs.readFileSync(path.join(__dirname, "../../packages/electron/src/window.ts"), "utf8");
  const iconSource = fs.readFileSync(path.join(__dirname, "../../packages/electron/src/app-icon.ts"), "utf8");
  const rendererLogo = fs.readFileSync(path.join(__dirname, "../../packages/renderer/src/assets/ftre-logo.svg"), "utf8");
  assert.equal(packageConfig.build.win.icon, "packages/electron/assets/ftre.ico");
  assert.equal(fullConfig.win.icon, "packages/electron/assets/ftre.ico");
  assert.equal(packageConfig.build.mac.icon, "packages/electron/assets/ftre.icns");
  assert.equal(fullConfig.mac.icon, "packages/electron/assets/ftre.icns");
  assert.match(windowSource, /resolveAppIconPath\("window"\)/);
  assert.match(iconSource, /new Tray\(iconPath\)/);
  assert.match(iconSource, /app\.dock\.setIcon\(iconPath\)/);
  assert.match(rendererLogo, /width="1254" height="1254"/);
  assert.ok(fs.existsSync(path.join(__dirname, "../../packages/electron/assets/ftre.ico")));
  assert.ok(fs.existsSync(path.join(__dirname, "../../packages/electron/assets/ftre.icns")));
  assert.ok(fs.existsSync(path.join(__dirname, "../../packages/electron/assets/ftre-logo.png")));
});

test("Release workflow 包含 macOS 矩阵和 SHA256 汇总", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/release.yml"), "utf8");
  assert.equal((workflow.match(/runner: macos-14/g) || []).length, 1);
  assert.equal((workflow.match(/runner: macos-15-intel/g) || []).length, 1);
  assert.doesNotMatch(workflow, /runner: macos-13/);
  assert.match(workflow, /runtime_arch=\$\(file backend\/python\/bin\/python3\.12\)/);
  assert.match(workflow, /SHA256SUMS/);
  assert.match(workflow, /action-gh-release/);
});

test("develop 预发布 workflow 使用 SemVer 通道并先过质量门禁", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/prerelease.yml"), "utf8");
  assert.match(workflow, /branches:\s*\n\s+- develop/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /alpha|beta|rc/);
  assert.match(workflow, /GITHUB_RUN_NUMBER/);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT/);
  assert.match(workflow, /run: pnpm test/);
  assert.match(workflow, /prerelease: true/);
  assert.match(workflow, /make_latest: false/);
  assert.match(workflow, /ref: develop/);
  assert.equal((workflow.match(/runner: macos-14/g) || []).length, 1);
  assert.equal((workflow.match(/runner: macos-15-intel/g) || []).length, 1);
  assert.doesNotMatch(workflow, /runner: macos-13/);
});

test("Electron 退出入口注销 watcher 和 PTY", () => {
  const main = fs.readFileSync(path.join(__dirname, "../../packages/electron/src/main.ts"), "utf8");
  const watcher = fs.readFileSync(path.join(__dirname, "../../packages/electron/src/ipc/watcher.ts"), "utf8");
  const terminal = fs.readFileSync(path.join(__dirname, "../../packages/electron/src/ipc/terminal.ts"), "utf8");
  assert.match(main, /disposeWatcherIPC\(\)/);
  assert.match(main, /disposeTerminalIPC\(\)/);
  assert.match(main, /backend:status/);
  assert.match(main, /event\.preventDefault\(\)/);
  assert.match(main, /backendSupervisor\.stop\(\)\.finally\(\(\) => app\.quit\(\)\)/);
  assert.match(watcher, /export function disposeWatcherIPC/);
  assert.match(terminal, /export function disposeTerminalIPC/);
});

test("WorkerManager 取消旧任务并清理超时 worker", async () => {
  const workerPath = path.join(os.tmpdir(), `ftre-worker-${process.pid}.cjs`);
  fs.writeFileSync(
    workerPath,
    "const { parentPort } = require('node:worker_threads'); parentPort.on('message', ({ taskId, payload }) => setTimeout(() => parentPort.postMessage({ taskId, result: payload }), payload.delay || 0));\n",
    "utf8",
  );
  const manager = new WorkerManager();
  manager.register("exclusive", { workerPath, mode: "exclusive", timeout: 500 });
  const first = manager.run("exclusive", { value: "first", delay: 100 });
  const second = manager.run("exclusive", { value: "second", delay: 0 });
  assert.deepEqual(await first, { error: "Worker cancelled" });
  assert.deepEqual(await second, { value: "second", delay: 0 });

  manager.register("spawn", { workerPath, mode: "spawn", timeout: 10 });
  assert.deepEqual(await manager.run("spawn", { value: "late", delay: 100 }), { error: "Worker timed out" });
  manager.dispose();
  fs.rmSync(workerPath, { force: true });
});

test("darwin runtime 使用 POSIX bin 路径和 sh launcher", () => {
  const paths = resolveBackendRuntime(path.join(os.tmpdir(), "ftre 中文 path"), "darwin");
  assert.match(paths.pythonExecutable, /python[\\/]bin[\\/]python3\.12$/);
  assert.match(paths.launcherScript, /start-gateway\.sh$/);
});

test("win32 runtime 使用 pythonw.exe，诊断仍保留 bat launcher", () => {
  const paths = resolveBackendRuntime(path.join(os.tmpdir(), "ftre spaces"), "win32");
  assert.match(paths.pythonExecutable, /python[\\/]pythonw\.exe$/);
  assert.match(paths.launcherScript, /start-gateway\.bat$/);
});

test("Windows 客户端启动器无控制台且仍保留日志 pipe", () => {
  const backendSource = fs.readFileSync(path.join(__dirname, "../../packages/electron/src/backend-supervisor.ts"), "utf8");
  const runtimeSource = fs.readFileSync(path.join(__dirname, "../../packages/electron/src/backend-runtime.ts"), "utf8");
  const bundleSource = fs.readFileSync(path.join(__dirname, "../bundle-backend.js"), "utf8");
  assert.match(runtimeSource, /pythonw\.exe/);
  assert.match(bundleSource, /pythonw\.exe/);
  assert.match(backendSource, /stdio:\s*\["ignore", "pipe", "pipe"\]/);
  assert.match(backendSource, /windowsHide:\s*true/);
  assert.match(backendSource, /private lifecycle: Promise<unknown> = Promise\.resolve\(\)/);
  assert.match(backendSource, /private enqueue<T>/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../../packages/electron/src/main.ts"), "utf8"), /start-gateway\.(bat|sh)/);
});

test("Gateway readiness 只在 /api/health 成功后完成", async () => {
  const server = http.createServer((request, response) => {
    if (request.url !== "/api/health") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  await waitForBackendReady(
    { host: "127.0.0.1", port: address.port },
    () => true,
    { timeoutMs: 1000, pollMs: 10 },
  );
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("runtime manifest 拒绝架构错配和绝对路径", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ftre-runtime-"));
  const paths = resolveBackendRuntime(root, "darwin");
  fs.mkdirSync(paths.pythonDir, { recursive: true });
  const manifest = {
    formatVersion: 1,
    platform: "darwin",
    arch: "arm64",
    pythonVersion: "3.12.14",
    pythonExecutable: "bin/python3.12",
    source: "test",
  };
  fs.writeFileSync(paths.runtimeManifest, JSON.stringify(manifest), "utf8");
  const loaded = readRuntimeManifest(paths.runtimeManifest);
  assert.throws(() => assertRuntimeMatchesProcess(loaded, "darwin", "x64"), /架构不匹配/);
  assert.equal(resolveManifestExecutable(paths, loaded), path.join(paths.pythonDir, "bin", "python3.12"));
  assert.throws(
    () => resolveManifestExecutable(paths, { ...loaded, pythonExecutable: "/tmp/python" }),
    /不允许包含绝对路径/,
  );
  const windowsPaths = resolveBackendRuntime(root, "win32");
  assert.throws(
    () => resolveManifestExecutable(windowsPaths, { ...loaded, platform: "win32", pythonExecutable: "python.exe" }),
    /必须使用 pythonw\.exe/,
  );
  fs.rmSync(root, { recursive: true, force: true });
});
