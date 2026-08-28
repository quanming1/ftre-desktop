# Changelog

## [0.1.20] - 2026-08-28

### D4 品牌 Logo 与应用壳视觉

- 使用用户提供的 SVG/PNG 统一 TitleBar、LoadingScreen、Windows 窗口/任务栏/EXE/托盘和 macOS Dock。
- 新增统一的 ICO、ICNS、PNG 原生资源与平台图标解析，托盘生命周期随 Electron 应用正确创建和销毁。
- 客户端 Host 事件投影、消息搜索和 workspace Package 打包链路同步到当前 develop。

## [0.1.18] - 2026-08-27

### D4 品牌 Logo 与应用壳视觉

- **绿色狐狸 FtreLogo 替换 PixelLogo**：新增 `FtreLogo` 组件（静态 SVG 资源、size 映射、role/alt 可访问性），TitleBar 与 LoadingScreen 切换引用，删除旧像素字母实现；组件测试覆盖默认与自定义尺寸
- **Windows 统一品牌图标**：多尺寸 `ftre.ico` 接线 BrowserWindow（existsSync 防御开发态）与 electron-builder `build.win.icon`，窗口、任务栏和 exe 使用同一绿色狐狸图标
- **bundle 仓内 Package 源码复制（FR6）**：`copyLocalPackageSources` 将 ftre `packages/*/src` 中带 `pyproject.toml` 的 monorepo 发行物（`ftre_llm`、`ftre_agent_runtime`、`ftre_inbox`、`ftre_compaction` 等）复制进 `resources/backend/server`，过滤 `__pycache__`/`.pyc`/`.git`/`.egg-info`，配套 node 测试覆盖；ownPkgs 判定改为精确包名匹配，修复前缀误杀（v0.1.15 回归教训），与 master 的 bundle 修复收敛为同一实现

### [0.1.15] - 2026-08-27

### A2 聊天体验修复与重构

- **图片上传三问题修复**：配额判定改用同步镜像（修「首张图误报最多8张」与多次粘贴才成功）；Electron 主进程与打包 index.html 双处 CSP 的 `img-src` 放行 gateway 回环图片服务（修实时消息图片裂图，刷新才显示）
- **消息列表发送抖动根治**：滚底收敛为 ResizeObserver 单一事实源（观察容器+内容层，绘制前修正）；删除 tailFingerprint paint 后重复滚动与 TURN_START 强制拉底，跟随完全由用户滚动位置决定；输入框浮层改为固定 72px 底部 spacer，出现/消失零布局变化；消息间距由 margin 系改 padding 规则
- **git 状态解析修复**：`status -z` 模式 rename/copy 旧路径按顺序配对；文件树对同文件 staged/unstaged 双记录使用含 staged 维度的 key，消除 React key 冲突
- **UI 微调**：图片附件卡片与气泡同底色并加白描边、圆角收敛；hover 元数据行 g/y 降部截断修复；输入框与用户消息底色统一 `#f6f7f9`

### B7 会话列表信息 Tooltip 化（已完成，未发布）

- sessionList 会话项统一为紧凑单行，移除常驻 desc；悬停整行显示标题、最后消息、工作区和相对时间。
- Tooltip 使用白底、无边框、轻阴影并即时出现，不影响会话切换、菜单、置顶、运行和拖拽行为。

### B6 客户端运行状态语义收敛（开发中）

- 聊天 UI 不再使用 `isBusy` 判断执行、压缩、队列和流式状态，改用精确的 session、queue、
  activity 和 message streaming 字段。
- `useIsStreaming` 改为依据 Assistant 消息的真实 `streaming` 标记。

### B5 Queue Operation Response（已完成，未发布）

- 客户端以带 `revision` 的 `session/queue` 操作响应同时结算聊天 outbox、队列控制 Promise
  和队列投影；删除独立 Message ACK parser 与本地 Steering 猜测状态。
- 旧协议不做兼容；缺少 revision 或 Assistant `message_id` 的旧帧按当前协议丢弃，取消控制
  ACK 保持不变。
- 修复 claim 后队列横幅残留：移除 `awaitingEcho` 中间态，Queue Snapshot 清空后立即移除已消费项，
  UserMessage 回显独立进入 MessageList。
- 修复 Inbox 在 Queue Operation Response 返回前完成 claim 时的队列残留：客户端按响应
  `request_id` 结算本地 optimistic 项，不受后台快照先到或旧 revision 影响。
- 重构 Chat Store：纯 Queue/Reply/Event 投影迁移到 `chatProjection.ts`，`chat.ts` 从 2112 行降至 997 行，
  Zustand 生命周期与协议 reducer 解耦。
- Tool Call 实时投影以 `TOOL_CALL_END.arguments` 作为最终入参快照；即使中间 delta 丢失，工具卡片
  也能在当前运行中恢复完整参数。
- 修复完成消息操作栏延迟显示：`session/queue` 不再阻止后续 `session/status: idle`，回复结束后
  立即显示复制按钮、token 用量和模型信息，无需刷新会话。
- Queue UI 按预览重构：队列项改为输入框上方的单行消息条，使用与输入框一致的 composer Surface，保留
  调整方向、删除、编辑和更多菜单，不再显示重复的队列标题或消息预览。
- Assistant 消息底部改为用输入/输出图标展示 token、模型和相对结束时间；超过一周显示绝对时间，元数据使用更淡颜色并仅在 hover 时显示。
- User 消息复制按钮移动到气泡下方，与 Assistant 共用时间表达和 hover 显示规则。
- 修复压缩命令刚发送时同时显示“压缩上下文中…”和“处理中”的问题。

## [0.1.14] - 2026-08-24

- 修复 macOS 14 arm64 runner 交叉构建 Intel runtime 时架构校验误用宿主 `uname` 的问题。

## [0.1.13] - 2026-08-24

- 修复 macOS Intel 交叉打包时原生依赖错误回退源码编译的问题。

## [0.1.12] - 2026-08-24

### 发布修复

- macOS Intel 构建改用 macos-14 runner，避免 macos-13 runner 长时间排队；继续生成 x64 产物。

## [0.1.11] - 2026-08-24

### 修复

- 修复 macOS arm64 Python runtime 缺少可选 `2to3` 文件时，后端 bundle 目录统计失败的问题。

## [0.1.10] - 2026-08-24

### B1 WebSocket F12 协议修复

- 客户端聊天、工具确认迁移到 `session.prompt`，取消迁移到 `session.cancel`，统一使用
  `payload` 和 `request_id`；attach/detach 同步迁移到 `payload.session_id`。
- 下行事件、`reply_snapshot`、`session/queue`、`session/status` 改为解析 `payload`；
  durable admission 改为消费无 `type` 的 RPC ACK/error envelope。
- 修复旧 `user_message/data/frame_id` 帧被 ftre 后端静默忽略导致消息消失的问题，并补齐
  outbox 重连、取消 ACK、队列和状态回归测试。
- 修复 Electron 开发启动竞态：等待 `main.js` 与 `preload.js` 都生成后再创建窗口，避免
  preload 未注入导致 Inspector 文件树读取 `window.desktop.fs` 崩溃；增加 bridge 缺失降级和
  preload 错误日志。
- 修复 Windows Vite 依赖缓存锁导致 renderer 进程退出：开发启动使用 `--force` 重优化，
  避免 Electron 保留旧页面后出现整页 `ERR_CONNECTION_REFUSED`。

## [未发布]

### 新增

- D4：统一使用用户提供的 Ftre Logo；TitleBar、LoadingScreen、Windows 窗口/任务栏/EXE/托盘和 macOS
  Dock 均接入同一 SVG/PNG 派生资源，补齐 ICNS 与原生托盘生命周期。
- B4：Assistant 流事件和 attach 快照按服务端 `message_id` 投影，Steering 同一 `reply_id`
  下自然显示 `Assistant A → UserMessage → Assistant B`；删除客户端 `reply_segment` 推断。
- B3：队列横幅新增“插入当前运行”Steering 按钮；同一 request_id 从 queued 升级为 steering，
  后端 USER_MESSAGE 持久化回显后立即进入 MessageList，队列按权威快照完成清理。
- A3：文件、图片和 Diff 预览的路径段支持逐级打开目录文件列表；目录按需懒加载，点击文件可复用或打开对应 Inspector Tab；新增规范化 `fs:listDirectory` IPC 与错误码。
- A6：运行详情的 Changes 入口打开唯一 Inspector 审阅 Tab，支持未提交/未暂存/已暂存对比、文件级按需 Diff、复制 Diff 和打开源文件。
- E1：客户端新增 macOS x64/arm64 打包链路，安装包内置架构匹配的 Python runtime、ftre Gateway 与 cordis-py；增加 UTF-8、路径、进程组清理和 GitHub Release 资产校验。

### 修复

- A3：FileRenderer 在 preload bridge 暂不可用时安全隐藏 Git Diff 能力，不再访问 `undefined.git` 导致 Inspector 崩溃。
- A2：重复的 TOOL_CALL_START 事件按 tool_call_id 幂等处理，消除聊天工具卡片 duplicate key 警告；Reply 快照转换同样按 id 去重。
- A1：renderer 声明 Content-Security-Policy（index.html meta + 开发模式响应头注入），消除 Electron 开发模式 Insecure Content-Security-Policy 警告。
- B4：Steering 控制 Queue Response 成功后立即将队列项显示为“等待下一次推理”，不再必须刷新 Session；
  Queue Response 不再误标普通 pending 消息为“正在消费”，claim 后队列项立即清理，旧数据不再
  走兼容分支，按当前 message_id 协议处理。

## [0.1.9] - 2026-08-20

### 变更

- D3：标题点击直接展开最近 WebSocket 会话列表，移除箭头、绿点和 WS 数量统计；重命名保留在更多操作菜单中。

## [0.1.8] - 2026-08-20

### 新增

- D2：会话消息列表左侧新增悬停式历史定位导航，可预览并平滑跳转至已加载的用户消息。
- D3：运行详情迁移到 Header 弹窗，保留 pending 队列输入区；支持任务、文件、Git 分支和 Git 变更详情及 Diff。
- D3：运行详情按钮常驻并持久化全局开关；规范“本轮修改 / Changes”分组与视觉样式，Changes 条目可直接打开 Inspector 预览。

### 修复

- A2：上下文压缩横幅读取后端事件中的实际摘要模型，旧协议缺少该字段时不再显示陈旧的普通对话模型。
- D1：会话搜索首屏提高至 50 条，并可继续加载后续页面，确保全部匹配会话可见。
- A2：流式回复期间点击“从服务器加载更早的消息”不再丢弃已成功返回的历史页。
