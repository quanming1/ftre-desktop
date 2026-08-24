const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  assertRuntimeMatchesProcess,
  readRuntimeManifest,
  resolveBackendRuntime,
  resolveManifestExecutable,
} = require("../../packages/electron/dist/backend-runtime.js");
const { WorkerManager } = require("../../packages/electron/dist/ipc/worker-manager.js");

test("electron-builder 声明 Mac dmg/zip 双架构产物和 bundled backend", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../../electron-builder-full.json"), "utf8"));
  const targets = config.mac.target;
  assert.deepEqual(targets.map((target) => target.target), ["dmg", "zip"]);
  for (const target of targets) assert.deepEqual(target.arch, ["x64", "arm64"]);
  assert.equal(config.mac.artifactName, "ftre-${version}-mac-${arch}.${ext}");
  assert.ok(config.extraResources.some((resource) => resource.from === "backend/"));
  assert.ok(config.extraResources.some((resource) => resource.from === "scripts/start-gateway.sh"));
});

test("Release workflow 包含 macOS 矩阵和 SHA256 汇总", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/release.yml"), "utf8");
  assert.equal((workflow.match(/runner: macos-14/g) || []).length, 2);
  assert.doesNotMatch(workflow, /runner: macos-13/);
  assert.match(workflow, /runtime_arch=\$\(file backend\/python\/bin\/python3\.12\)/);
  assert.match(workflow, /SHA256SUMS/);
  assert.match(workflow, /action-gh-release/);
});

test("Electron 退出入口注销 watcher 和 PTY", () => {
  const main = fs.readFileSync(path.join(__dirname, "../../packages/electron/src/main.ts"), "utf8");
  const watcher = fs.readFileSync(path.join(__dirname, "../../packages/electron/src/ipc/watcher.ts"), "utf8");
  const terminal = fs.readFileSync(path.join(__dirname, "../../packages/electron/src/ipc/terminal.ts"), "utf8");
  assert.match(main, /disposeWatcherIPC\(\)/);
  assert.match(main, /disposeTerminalIPC\(\)/);
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

test("win32 runtime 保留 python.exe 和 bat launcher", () => {
  const paths = resolveBackendRuntime(path.join(os.tmpdir(), "ftre spaces"), "win32");
  assert.match(paths.pythonExecutable, /python[\\/]python\.exe$/);
  assert.match(paths.launcherScript, /start-gateway\.bat$/);
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
  fs.rmSync(root, { recursive: true, force: true });
});
