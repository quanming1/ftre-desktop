# PRD-E1 Mac 客户端打包适配计划

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | E1 |
| 名称 | Mac 客户端打包适配计划 |
| 状态 | 开发中 |
| 创建日期 | 2026-08-22 |
| 定稿日期 | — |
| 验收日期 | — |
| 关联文档 | docs/TODO.yaml；AGENTS.md；docs/PROCESS.md；packages/electron/；E:\ftre\docs\prd\PRD-F11-compaction-gate-hook.md |
| 执行状态 | 客户端开发与本地验证完成；需授权提交并推送后由 GitHub macOS runner 完成最终验收 |

## 1. 背景与目标

### 1.1 当前现状

ftre-desktop 当前是 Electron + React + TypeScript + Vite 的桌面客户端，
但打包链路仍然以 Windows 为唯一目标：

- package.json 的 pack/dist 脚本固定传入 electron-builder --win；
- electron-builder-full.json 只有 win/nsis 配置；
- GitHub Actions 只在 windows-latest 上构建；
- 内置 Python 使用 Windows embed-amd64 包和 python.exe；
- 后端启动依赖 start-gateway.bat、PowerShell 和 Windows 路径；
- Release workflow 只上传 Setup.exe 与 blockmap；
- Electron backend.ts 虽然已经对 SIGTERM 做了部分 POSIX 分支，
  但打包路径仍然硬编码 python.exe。

因此，Electron UI 的部分代码理论上可以在 macOS 开发环境运行，
但当前没有可交付的 .app、.dmg 或 macOS GitHub Release 安装包。

### 1.2 目标

在不改变现有后端协议和用户数据格式的前提下，将客户端打包链路完整适配
macOS，最终在 GitHub Release 中提供可安装、可启动、可自动拉起内置 Gateway
的 Mac 安装包。

本阶段的核心发布承诺是“零前置环境安装”：在项目声明支持的 macOS 版本和
CPU 架构上，普通用户不需要预装 Python、Node.js、Homebrew、conda、Git、
任何 Python/Node 依赖或 ftre 源码，仅下载并安装 GitHub Release 提供的安装包
即可完成首次启动和基本使用。操作系统版本、CPU 架构、磁盘空间以及用户正常
安装应用所需的系统权限属于不可由应用打包消除的基础条件，必须在 Release
说明和安装前检查中明确列出。

本阶段完成后，用户应能：

1. 在 Intel Mac 上安装并运行 x64 包；
2. 在 Apple Silicon Mac 上安装并运行 arm64 包；
3. 从 GitHub Release 下载对应架构的 .dmg 或 .zip；
4. 首次启动后客户端自动启动内置 ftre Gateway；
5. 使用中文配置、中文文件、中文命令和中文日志而不出现乱码；
6. 在包含空格、Unicode、中文和不同分隔符的路径下正常工作；
7. 使用终端、文件树、Git、MCP、Tool 和 Session 功能；
8. Windows NSIS 构建和既有安装流程不回归。

“可安装”不等于“开发机可启动”：验收必须使用未安装开发工具链的干净 macOS
环境验证，不能通过测试机预先安装 Python、Homebrew 或仓库依赖来掩盖安装包
缺少运行时的问题。

### 1.3 非目标

- 不重写 ftre Gateway、Agent Core 或 WebSocket 协议；
- 不修改客户端业务功能和现有用户交互，除非平台差异必须提供适配；
- 不在本阶段改变 Session、Mailbox、Compaction 或 Plugin 数据模型；
- 不把客户端代码复制到 E:\ftre 后端仓库；
- 不要求本阶段发布到 Mac App Store；
- 不在没有 Apple Developer 凭据时伪造“已签名/已 notarize”验收；
- 不删除 Windows 构建目标；
- 不把路径差异交给业务模块自行判断，平台分支必须收敛到基础适配层。

## 2. 需求范围

### 2.1 打包目标

- [ ] FR1：electron-builder 增加 macOS target
  - 至少生成 .dmg 和 .zip；
  - 支持 x64 和 arm64；
  - 明确是否额外生成 universal 包，并记录体积和构建时间取舍；
  - 产物名称包含产品名、版本号和架构；
  - 输出目录和 Windows 构建隔离，不能互相覆盖。

- [ ] FR2：脚本支持按目标平台构建
  - 保留 Windows 的 dist/dist:full/dist:quick 行为；
  - 新增 macOS 对应脚本，不能要求开发者手工修改 package.json；
  - 脚本参数能够明确选择平台和架构；
  - 构建失败时输出缺少的依赖、权限或签名信息。

- [ ] FR3：GitHub Release 上传 Mac 产物
  - Release workflow 增加 macOS runner；
  - 同时构建 x64 与 arm64，或提供明确的 universal 构建矩阵；
  - 上传 .dmg、.zip、blockmap（如目标生成）和 SHA256 校验和；
  - Release notes 标明支持的 macOS 最低版本、CPU 架构和签名状态；
  - Windows 产物继续上传且文件名不冲突。

- [ ] FR3a：零前置环境安装
  - 安装包必须包含客户端启动、Gateway 启动和已声明功能所需的运行时与依赖；
  - 不得要求用户另外安装 Python、Node.js、npm/pnpm、Homebrew、conda、Git、shell 扩展或项目源码；
  - 不得在首次启动时偷偷联网下载核心运行时或 Python/Node 依赖；联网只允许用于产品本身明确声明的在线功能；
  - 安装器和首次启动检查必须给出 macOS 最低版本、CPU 架构、磁盘空间和安装权限等不可打包解决的系统前置条件；
  - “开发模式可运行”不能作为发布包验收证据，所有发布候选包都必须在干净 macOS 环境中安装验证。

### 2.2 内置 Python 和 Gateway

- [ ] FR4：为每个 macOS 架构提供可分发 Python runtime
  - macOS x64 和 arm64 必须分别携带与目标架构匹配的 Python runtime；
  - runtime 必须随客户端安装包分发，安装后可以离线启动 Gateway，不依赖用户预装 Python、Node.js、Homebrew、conda、Git 或仓库源码；
  - runtime 的解释器、标准库、ftre 运行所需依赖和启动元数据必须位于应用资源目录，并纳入产物完整性校验；
  - 运行时入口通过平台适配函数返回，不允许业务代码拼接 python.exe 或假设某个系统 Python 路径；
  - x64 包不得启动 arm64 runtime，arm64 包不得启动 x64 runtime；构建阶段必须检查 Mach-O/Python 架构与 Electron 目标架构一致；
  - 记录 Python、ftre、ftre-agent-core 和 cordis-py 的版本来源、许可证、构建 commit 与校验和；
  - Windows 继续使用现有架构匹配的 bundled Python，不得因 macOS 适配移除 Windows runtime。

- [ ] FR5：后端资源目录跨平台解析
  - 使用 Electron resourcesPath、path.join、path.resolve 和 URL/file URL 的正确转换；
  - 不硬编码反斜杠、盘符、PowerShell 路径或 Windows 临时目录；
  - packaged 与 development 两种模式分别有明确的 backend root；
  - 资源路径包含空格、中文和 Unicode 时仍能启动；
  - 不把用户数据写入 asar，Session/config/log 必须落到用户目录。

- [ ] FR6：Gateway 启动、重启和停止跨平台
  - macOS 启动内置 Python 后执行等价的 ftre gateway 命令；
  - cwd、PYTHONPATH、HOME、TMPDIR 和日志环境变量正确传递；
  - POSIX 使用 SIGTERM/SIGKILL 或进程组管理，不能调用 taskkill；
  - Windows 继续使用 taskkill 和现有进程树清理；
  - crash retry、restart、app quit 和重复调用保持幂等；
  - Gateway 未启动或异常退出时，客户端显示可诊断错误。

- [ ] FR7：脚本和运行时入口跨平台
  - Windows 保留 start-gateway.bat；
  - macOS 增加 start-gateway.sh 或等价的直接 spawn 入口；
  - shell 脚本声明 UTF-8、可执行权限和安全的参数转义；
  - 禁止使用 PowerShell 解压、cmd 特有语法或 .bat 作为 macOS 唯一入口；
  - Node bundler 根据目标平台下载和准备正确的 Python runtime。

### 2.3 编码、换行与文件路径

- [ ] FR8：统一文本编码为 UTF-8
  - TypeScript、JSON、Markdown、配置、日志和生成的脚本默认 UTF-8；
  - 中文配置、中文 Session、中文 Tool 输出和中文文件名全链路保真；
  - stdout/stderr 采集按平台正确解码，macOS 不走 GBK fallback；
  - 不用 BOM 解决跨平台乱码；如 Windows 兼容必须限定在 Windows 适配层；
  - JSON 序列化、日志写入和文件复制不改变 Unicode 内容。

- [ ] FR9：统一路径构造规则
  - Node 端所有本地路径使用 node:path API；
  - Python 端使用 pathlib.Path；
  - URL 与本地文件路径分开处理，不把 URL 当作普通路径拼接；
  - 文件分隔符、盘符、UNC、POSIX 根目录、HOME 和 TMPDIR 均有测试；
  - 路径中含空格、中文、括号、emoji 时，spawn、读写、Git 和预览均正常；
  - 禁止在业务逻辑中直接 replace 反斜杠/正斜杠作为通用修复。

- [ ] FR10：临时文件和权限
  - 临时文件使用系统临时目录 API；
  - macOS shell 脚本、内置可执行文件和 node-pty 相关文件具备正确权限；
  - 打包后 asar 内文件只读，需执行或写入的内容放在 asarUnpack/resources；
  - 退出时清理临时文件，不删除用户 Session/config 数据；
  - 首次运行权限错误可诊断，不能只显示“后端启动失败”。

### 2.4 Electron 与原生依赖

- [ ] FR11：node-pty 和其他原生依赖支持 macOS
  - 对 Electron ABI 执行正确 rebuild；
  - 分别验证 x64、arm64，必要时验证 universal；
  - 终端 shell 默认使用用户 SHELL 或 /bin/bash；
  - 终端 resize、signal、退出码和中文输入输出正常；
  - Windows node-pty 行为保持不变。

- [ ] FR12：签名和 notarization 能力
  - 支持 Developer ID Application 签名配置；
  - 支持公证所需的 Apple ID/App Store Connect API Key 环境变量；
  - CI secret 缺失时明确标记为 unsigned，而不是声称发布完成；
  - 对 unsigned 本地测试包和 signed 发布包分别定义验收方式；
  - Release notes 记录签名/notarization 状态。

### 2.5 兼容性和回归

- [ ] FR13：Windows 回归
  - Windows NSIS 构建仍然成功；
  - Windows 内置 Python、.bat、taskkill、路径和 GBK 兼容逻辑不回归；
  - Windows Release 资产继续生成。

- [ ] FR14：客户端功能回归
  - Gateway 自动启动后可以建立 WebSocket；
  - Session 创建、消息发送、流式回复、Tool 调用、取消和重连正常；
  - 文件树、read/write/edit、Git diff、MCP、终端和附件功能正常；
  - 用户配置、Session 数据、日志和 workspace 不因升级改变位置；
  - 关闭客户端后 Gateway 子进程和子进程组被正确回收。

## 3. 技术方案

### 3.1 平台适配边界

平台差异集中在 Electron 主进程和构建脚本：

    packages/electron/src/backend-runtime.ts
      ├─ resolveBackendRuntime()
      ├─ readRuntimeManifest()
      ├─ assertRuntimeMatchesProcess()
      └─ resolveManifestExecutable()

    packages/electron/src/backend.ts
      ├─ UTF-8 output decoder
      ├─ Gateway spawn/retry
      └─ platform-specific process-group cleanup

    scripts/bundle-backend.js
      ├─ target platform/arch
      ├─ Python runtime provider
      ├─ dependency installer
      └─ source/resource synchronizer

Renderer、shared 和业务 Feature 不应自行判断 process.platform；
需要平台信息时通过既有 preload/shared contract 注入。

### 3.2 目标文件树

    ftre-desktop/
    ├─ package.json
    ├─ electron-builder-full.json
    ├─ scripts/
    │  ├─ bundle-backend.js
    │  ├─ start-gateway.bat
    │  └─ start-gateway.sh
    ├─ packages/
    │  ├─ electron/src/backend.ts
    │  ├─ electron/src/backend-runtime.ts
    │  ├─ electron/src/ipc/terminal.ts
    │  ├─ renderer/src/types/desktop.d.ts
    │  └─ shared/src/types.ts
    ├─ scripts/tests/backend-runtime.test.cjs
    └─ .github/workflows/release.yml

### 3.3 路径与编码契约

平台适配层必须提供以下最小契约：

    type DesktopPlatform = 'win32' | 'darwin' | 'linux';
    type DesktopArch = 'x64' | 'arm64' | 'universal';

    type BackendRuntimePaths = {
      backendDir: string;
      pythonDir: string;
      pythonExecutable: string;
      runtimeManifest: string;
      serverDir: string;
      launcherScript: string;
    };

约束：

- executable 是可执行文件绝对路径，不由调用方补后缀；
- server/userData/logs 使用本地路径，不混入 URL；
- 所有路径由 path.resolve/path.join 生成；
- 所有写文件 API 明确 encoding: utf8；
- shell 参数通过 spawn 参数数组或可靠的 shell quote 函数传递；
- 不允许用字符串替换猜测路径分隔符。

### 3.4 打包策略

优先采用“按架构分别构建”的策略：

- macOS x64：面向 Intel；
- macOS arm64：面向 Apple Silicon；
- universal 作为后续可选优化，只有在 native module 和 Python runtime 可以合并验证后才启用；
- Windows x64：维持现有 NSIS；
- 每个构建 job 生成 backend/manifest.json，记录版本、架构、commit、Python、ftre-agent-core、cordis-py、许可证文件和签名状态。

### 3.5 Gateway 资源策略

内置 Python 的目标已经冻结：为 macOS x64 和 arm64 分别提供可分发 runtime。

- 开发模式可以使用本机 Python，但发布模式不得回退到系统 Python；
- 每个架构的 runtime 必须在构建时下载或生成，并在打包前执行架构、版本、依赖和校验和检查；
- runtime 必须可以在没有网络、没有 Homebrew/conda、没有仓库源码的干净 macOS 环境中启动 Gateway；
- 当前实现固定使用 python-build-standalone 的 install_only 发行物，并锁定 release、版本和 x64/arm64 SHA256；仍需在发布评审中确认体积、许可证、升级策略、签名/notarization 和离线安装策略；
- 不能直接把 Windows embed-amd64 复制到 macOS，也不能用 universal 名称掩盖缺失的架构 runtime。

## 4. 接口与发布协议

### 4.1 构建命令

当前实现支持以下命令：

    pnpm build
    pnpm package:mac:x64
    pnpm package:mac:arm64
    pnpm package:win

每个命令必须输出明确的目标平台、架构、版本和产物路径。

### 4.2 GitHub Release 资产

Release 至少包含：

- ftre-<version>-mac-x64.dmg
- ftre-<version>-mac-arm64.dmg
- 对应 zip；
- SHA256SUMS；
- Windows Setup.exe；
- Release notes：安装方式、系统版本、架构、签名状态、已知限制。

资产上传成功后必须通过 GitHub API 或网页验证，而不是只检查 Actions 日志。

## 5. 非功能需求

- 零前置环境：干净 macOS 只满足已声明的系统版本、架构、磁盘和安装权限条件，
  不安装任何开发工具链也能完成安装、启动 Gateway 和发送第一条消息；
- 兼容性：macOS Intel 与 Apple Silicon；最低系统版本在评审时冻结；
- 编码：中文、emoji、非 ASCII 文件名和日志必须保持一致；
- 路径：空格、中文、括号、emoji、深层目录和软链接场景可诊断；
- 安全：不执行未转义的路径，不把用户数据打入 asar，不绕过 macOS 安全机制；
- 可观测：后端启动失败显示 executable、server、cwd、platform、arch 和错误原因；
- 可重复：相同 commit、版本和架构构建产物可复现或差异可解释；
- 体积：报告 bundled Python、依赖、asar 和 dmg 压缩后的大小；
- 发布：没有签名凭据时不得把 unsigned 构建标为正式生产包。

## 6. 验收标准

- [ ] AC1：在 macOS runner 上构建 x64 安装包成功；
- [ ] AC2：在 macOS runner 上构建 arm64 安装包成功；
- [ ] AC3：安装 .dmg 后应用可启动，Gatekeeper/签名状态与 Release notes 一致；
- [ ] AC4：首次启动自动拉起内置 Gateway，并成功建立 WebSocket；
- [ ] AC5：关闭客户端后 Gateway 及其子进程组无残留；
- [ ] AC6：中文配置、中文 Session、中文日志和中文文件名无乱码；
- [ ] AC7：路径包含空格、中文、emoji 时，Gateway、终端、文件树、Git 和附件均正常；
- [ ] AC8：macOS 下使用 /bin/bash 或用户 SHELL，终端输入输出和 Ctrl+C 正常；
- [ ] AC9：Session、Tool、MCP、文件读写、Git diff、取消、重连和流式回复回归通过；
- [ ] AC10：Windows NSIS 构建和现有 Windows 回归测试通过；
- [ ] AC11：CI 在 tag 发布时自动上传 Mac x64/arm64 资产和 SHA256；
- [ ] AC12：Release 页面能下载并安装 Mac 包，版本、架构和签名说明准确；
- [ ] AC13：干净 macOS 环境不依赖仓库源码、开发机绝对路径或手工启动后端；
- [ ] AC14：构建产物不包含调试密钥、临时目录、缓存、测试数据或源码仓库绝对路径。
- [ ] AC15：x64 与 arm64 安装包均包含对应架构的可分发 Python runtime；在无系统 Python、无 Homebrew/conda、无仓库源码和无网络的干净 macOS 环境中，runtime 校验通过并能启动 Gateway。
- [ ] AC16：在未安装 Python、Node.js、npm/pnpm、Homebrew、conda、Git 和项目源码的干净 macOS 环境中，普通用户仅通过 GitHub Release 安装包即可完成安装、首次启动、Gateway 就绪和第一条消息发送；若系统版本、架构、磁盘或权限不满足，客户端必须在安装/启动阶段给出明确诊断。

## 7. 测试计划

### 7.1 单元和静态测试

- 平台路径解析：win32/darwin/linux；
- x64/arm64/universal 架构选择；
- python executable、server、userData、logs 路径；
- Unicode、空格、emoji 和不同分隔符；
- UTF-8 stdout/stderr 和换行；
- spawn 参数、cwd、env 和终止信号；
- 禁止 macOS 路径使用 .exe、.bat、PowerShell 的架构门禁；
- TypeScript 类型检查和 lint。

### 7.2 打包测试

- macOS x64 wheel/runtime/asar/dmg，验证 runtime 架构为 x86_64；
- macOS arm64 wheel/runtime/asar/dmg，验证 runtime 架构为 arm64；
- 干净环境下分别移除系统 Python、Homebrew/conda 和网络，确认两种 runtime 仍能启动 Gateway；
- Windows x64 NSIS；
- asarUnpack、原生 node-pty、执行权限和资源目录；
- 产物内容扫描和版本 manifest。

### 7.3 安装后冒烟

在干净 macOS runner 或测试机上（预先移除 Python、Node.js、npm/pnpm、Homebrew、conda、Git，且不提供仓库源码）：

1. 下载 GitHub Release 的对应架构安装包；
2. 安装并启动客户端；
3. 等待 Gateway ready；
4. 建立 WebSocket；
5. 创建 Session 并发送中文消息；
6. 调用 read/write/edit、终端、Git 和 MCP 基础路径；
7. 关闭应用；
8. 检查 Gateway 子进程、临时文件和日志；
9. 重启应用确认配置和 Session 数据仍可恢复。

### 7.4 发布验证

- GitHub Actions 所有平台 job 通过；
- GitHub Release 资产完整；
- SHA256 校验和可复算；
- dmg 挂载、安装、卸载和重新安装均可完成；
- unsigned/signed/notarized 状态与实际证据一致。

## 8. 执行边界与当前进度

本阶段只修改客户端仓库；不修改 E:\ftre 后端、E:\ftre-agent-core 或 cordis-py
源码。已完成的客户端范围包括：

- Electron 主进程的 runtime manifest、架构校验、UTF-8 输出和进程组生命周期；
- Windows/macOS 双平台 Gateway launcher；
- x64/arm64 Python runtime 下载、校验、依赖安装和源码同步；
- electron-builder macOS dmg/zip 目标与 GitHub Actions 构建矩阵；
- 平台契约测试、Windows bundle 验证和零前置环境验收脚本。

仍必须在 GitHub macOS runner 或真实 Mac 上完成的证据：

- x64 与 arm64 的实际 .dmg/.zip 构建、安装和 Gateway 冒烟；
- node-pty 原生 ABI、权限、Gatekeeper、签名/notarization 和发布页下载验证；
- tag 发布后 GitHub Release 资产与 SHA256SUMS 验证。

## 9. 开放决策

进入发布收口前仍需评审并冻结：

1. python-build-standalone runtime 的许可证清单、升级节奏和版本锁定流程；
2. 支持架构：x64 + arm64，是否在此基础上提供 universal；
3. 最低 macOS 版本；
4. Apple 签名和 notarization 的凭据管理；
5. bundled runtime/backend 的依赖许可证、升级和离线安装策略；
6. 是否将 ftre-compaction 一并打入客户端，还是作为后端可选包独立安装；
7. Release 版本号是否与 ftre 后端严格同步；
8. Mac 客户端是否需要自动更新及其签名要求。

## 10. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-22 | 创建 E1 Mac 客户端打包适配计划；暂不执行代码，冻结 macOS 安装包、编码、路径、文件分隔符、内置 Gateway、CI 和 GitHub Release 目标 | 当前客户端打包链路仅支持 Windows，需要先建立完整跨平台验收契约，避免直接改代码造成平台分支和发布资产不一致 |
| 2026-08-22 | 增加“零前置环境安装”发布承诺；要求 x64/arm64 安装包自带可离线 Python runtime，并新增 AC16 干净环境验收 | 普通用户不应因为缺少 Python、Node.js、Homebrew、conda、Git 或仓库源码而无法安装和首次启动 |
| 2026-08-22 | 进入 E1 开发：完成 runtime manifest、跨平台 Gateway 生命周期、Python runtime 打包器、electron-builder Mac 目标、macOS CI 矩阵和平台契约测试 | 将零前置环境要求落到可执行的构建链路；Mac runner/真实设备验收保留到 CI 收口 |
| 2026-08-22 | 下载器优先使用 curl 并增加目标 runtime 预检，CI 在打包前验证 manifest、机器架构和内置包导入 | 处理部分 Windows 代理对 Node HTTPS 流的长连接问题，并让 Mac 架构错配在打包前失败 |
| 2026-08-24 | macOS Intel 改由 macOS 14 runner 交叉构建时，依赖安装强制使用目标架构 wheel | 避免 arm64 runner 为 `cryptography` 回退 Rust/OpenSSL 源码编译，确保 x64 发布流水线可重复执行 |
| 2026-08-24 | 交叉构建验证改为检查 bundled Python 二进制架构，不再读取 runner 的宿主架构 | macOS 14 runner 为 arm64，但目标 x64 runtime 必须在产物自身上验收 |
