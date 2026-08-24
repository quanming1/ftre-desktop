# E1 Mac 客户端打包适配执行报告

## 1. 执行状态

| 项目 | 状态 |
|---|---|
| 阶段 | E1 |
| 目标 | macOS x64/arm64 零前置环境安装包，并上传 GitHub Release |
| 当前状态 | 开发完成，待 macOS runner/真实设备收口验收；当前工作区未授权 commit/push |
| 执行范围 | 仅 `E:\\binn\\ftre-desktop` 客户端仓库 |
| 未修改 | `E:\\ftre`、`E:\\ftre-agent-core`、`E:\\cordis-py` 源码 |

## 2. 已实现

- `packages/electron/src/backend-runtime.ts`
  - 统一 packaged 资源路径；
  - 读取 `runtime.json`；
  - 校验平台、架构和相对可执行路径；
  - 拒绝绝对路径和 runtime 目录逃逸。
- `packages/electron/src/backend.ts`
  - macOS 使用 `bin/python3.12`，Windows 使用 `python.exe`；
  - `PYTHONUTF8`、`PYTHONIOENCODING=utf-8`、`PYTHONUNBUFFERED`；
  - UTF-8 `StringDecoder`，避免中文字符跨 stdout chunk 损坏；
  - POSIX 独立进程组和 Windows `taskkill /t` 回收；
  - 重启时旧进程 `close` 事件不会清空新进程句柄；
  - 启动失败日志包含 platform、arch、python、server 和 cwd。
- `scripts/bundle-backend.js`
  - Windows embedded Python；
  - macOS 使用 python-build-standalone `install_only`；
  - x64 使用 `x86_64-apple-darwin`，arm64 使用 `aarch64-apple-darwin`；
  - runtime archive SHA256 校验；
  - 同步 ftre、ftre-agent-core 和 cordis-py 源码；
  - 生成 `backend/python/runtime.json` 和 `backend/manifest.json`；
  - 复制许可证文件；
  - 不在发布模式依赖系统 Python、Node、Homebrew、conda、Git 或源码。
- `electron-builder-full.json`
  - macOS dmg/zip；
  - x64/arm64 独立产物和架构文件名；
  - backend、bat、sh launcher 作为 extraResources。
- `.github/workflows/release.yml`
  - Windows x64 job；
  - macOS x64（macos-13）和 arm64（macos-14）矩阵；
  - bundle 后先校验 manifest、机器架构和三项 Python 导入，再进入 electron-builder；
  - 汇总产物、生成 `SHA256SUMS` 并上传 GitHub Release。
- `scripts/start-gateway.bat` / `scripts/start-gateway.sh`
  - 只使用安装包自带 runtime；
  - UTF-8 环境和路径均按平台处理。

## 3. 验证证据

已通过：

- `pnpm build`；
- `pnpm test`：48 个测试文件、488 个 renderer 测试通过；
- `pnpm run test:platform`：7 个 runtime、builder、Release workflow、退出清理和 worker 生命周期契约测试通过；
- `pnpm --filter @ftre/electron build`；
- `node --check scripts/bundle-backend.js`；
- package/builder/TODO/workflow YAML/JSON 语法验证；
- Windows x64 backend bundle：Python、依赖、ftre、ftre-agent-core、cordis-py 完成同步；
- bundled Python 导入验证：`cordis`、`ftre`、`ftre_agent_core` 和中文 stdout；
- `electron-builder --win --x64 --dir -c electron-builder-full.json --publish never`；
- Windows unpacked 资源验证：runtime manifest、Python、cordis、bat/sh launcher 均存在。

## 4. 尚未完成的外部验收

当前开发机为 Windows，以下项目必须在 GitHub macOS runner 或真实 Mac 上执行：

1. x64/arm64 Python runtime 实际下载、解压、pip 依赖安装；
2. x64/arm64 `.dmg` 和 `.zip` 构建；
3. 安装后 Gateway、WebSocket、中文消息和终端冒烟；
4. node-pty 原生 ABI、权限、shell 和 Ctrl+C；
5. unsigned/signed/notarized 状态与 Gatekeeper 行为；
6. GitHub Release 资产、SHA256SUMS 和干净 Mac 下载验证。

当前工作区停在 `feature/A6-audit-tab`，E1 改动尚未提交。根据仓库协作规则，
没有明确的 commit/push 授权不能把改动推到 GitHub，因此无法触发上述 macOS
runner 和 Release job；这不是代码测试失败，而是外部发布权限尚未发生。

本机 NSIS 安装器命令曾因 electron-builder Windows 工具下载阶段长时间无输出而超时；
不影响已通过的 `--dir` 应用资源打包验证，CI 仍会执行完整 NSIS job。

本机还实际下载并校验了 macOS x64 runtime archive（SHA256 与锁定值一致），并确认
archive 使用 POSIX symlink；Windows 自带 tar 无法正确还原这些链接，因此 runtime
解压、pip 安装和可执行性仍必须由 macOS runner 完成，而不是在 Windows 上伪造通过。

## 5. Cleanup audit 结果

| 检查项 | 证据/结论 |
|---|---|
| Gateway runtime Owner | `packages/electron/src/backend.ts` 唯一负责运行时 spawn/restart/stop；bundle 脚本只负责构建期资源，不注册运行时进程 |
| Runtime path Owner | `packages/electron/src/backend-runtime.ts` 唯一负责 manifest、平台/架构和 executable 路径解析 |
| Gateway 入口 | `packages/electron/src/main.ts` 的 `app.whenReady` 唯一启动；`before-quit` 唯一关闭 |
| Watcher 生命周期 | `disposeWatcherIPC()` 清理 watcher、debounce timer 和 pending path，并接入 `before-quit` |
| PTY 生命周期 | `disposeTerminalIPC()` 终止全部 PTY，并接入 `before-quit` |
| Worker 生命周期 | `WorkerManager.dispose()` 清理 worker/timer；exclusive 取消会结算旧 Promise，spawn timeout 不残留 worker |
| 旧入口引用 | 生产代码未发现 `ai-base gateway`、旧 `startBackend` 或系统 Python fallback；历史方案文档已明确标注 superseded |
| 生成物 | `backend/` 4363 文件、`release/` 4620 文件、`.cache/` 4 文件和各包 `dist/` 均为忽略的构建产物；未删除用户数据或依赖目录 |
| 字节码/空目录 | 工作区非 `node_modules` 的 `__pycache__` 数量为 0；源码、scripts、docs 无空目录。3 个空目录位于依赖 `node_modules`，按规则保留 |
