# Changelog

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

- A3：文件、图片和 Diff 预览的路径段支持逐级打开目录文件列表；目录按需懒加载，点击文件可复用或打开对应 Inspector Tab；新增规范化 `fs:listDirectory` IPC 与错误码。
- A6：运行详情的 Changes 入口打开唯一 Inspector 审阅 Tab，支持未提交/未暂存/已暂存对比、文件级按需 Diff、复制 Diff 和打开源文件。
- E1：客户端新增 macOS x64/arm64 打包链路，安装包内置架构匹配的 Python runtime、ftre Gateway 与 cordis-py；增加 UTF-8、路径、进程组清理和 GitHub Release 资产校验。

### 修复

- A2：重复的 TOOL_CALL_START 事件按 tool_call_id 幂等处理，消除聊天工具卡片 duplicate key 警告；Reply 快照转换同样按 id 去重。
- A1：renderer 声明 Content-Security-Policy（index.html meta + 开发模式响应头注入），消除 Electron 开发模式 Insecure Content-Security-Policy 警告。

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
