# 前端 WebSocket 通信层重构

## 项目背景

本项目（ftre-desktop）的前端正在从原来的 REST+SSE 架构迁移到 ai-base 的 WebSocket channel 协议。后端已经是 ai-base v2（基于 nanobot 重写 + Plugin 系统），前端需要适配其 WebSocket 实时通信协议。

**后端仓库：** `E:\binn\ai-base`（GitHub: quanming1/ai-base，分支 v2-rewrite）
**前端仓库：** `E:\binn\ftre-desktop`（GitHub: quanming1/ftre-desktop，分支 main）

## 当前状态

### 已完成 ✓

1. **通信层代码已替换：**
   - `src/services/websocket-client.ts` — 新建，WS 单连接管理（auto-reconnect）
   - `src/services/ws-stream-manager.ts` — 新建，基于 WS 事件的消息状态管理
   - `src/services/api.ts` — 重写为 WS facade
   - `src/services/global-event-stream.ts` — 已 stub（SSE 移除）
   - `src/services/stream-manager.ts` — 已删除

2. **Store 已重写：**
   - `src/stores/chat.ts` — 从 ws-stream-manager 同步状态
   - `src/stores/session.ts` — 本地 session 管理

3. **组件已适配：**
   - ChatInput, MessageList, AssistantMessage, UserMessage
   - ToolCallCard, RetryPanel, SessionList, SessionPanel
   - EditorArea, editor-host-bridge

4. **构建通过：**
   - `pnpm dev` 正常启动（Vite dev server on port 50000）
   - TypeScript 编译 chat 相关文件零错误

### 未完成 — 需要继续

1. **WebSocket channel 后端初始化问题：**
   - `ai-base gateway` 启动时 websocket channel 报错：`expected str, bytes or os.PathLike object, not NoneType`
   - 原因：`channels/websocket.py` 的 `__init__` 对 config 字典的解析方式与我们传入的 JSON config 不匹配
   - 需要调试 `E:\binn\ai-base\src\ai_base\channels\websocket.py` 的初始化逻辑，或者调整 config.json 的 websocket 配置格式

2. **端到端联调：**
   - 前端 WS 连接 → 后端 WS channel → Agent 处理 → streaming 回复
   - 目前前端代码就绪，后端 WS channel 还没跑起来

## 如何运行

### 启动后端（ai-base gateway）
```bash
cd E:\binn\ai-base
ai-base gateway
```
- gateway 默认端口 18790
- 需要 WebSocket channel 正常启动（当前有 bug 需修）
- config 在 `C:\Users\蒋全明\.ai-base\config.json`

### 启动前端
```bash
cd E:\binn\ftre-desktop\packages\renderer
pnpm dev
```
- 访问 http://127.0.0.1:50000
- 前端会尝试连接 `ws://127.0.0.1:18790/`

## TODO — 待完成任务

### P0: 修复后端 WebSocket channel 启动
- [ ] 调试 `E:\binn\ai-base\src\ai_base\channels\websocket.py` 的 `__init__` 方法
- [ ] 确认 config.json 中 `channels.websocket` 的正确格式（可能需要 `token`、`path` 等字段）
- [ ] 验证：`ai-base gateway` 启动后日志显示 `WebSocket channel enabled` + 监听端口

### P1: 端到端对话验证
- [ ] 打开浏览器 Console，确认 WS 连接成功，收到 `{"event":"ready","chat_id":"xxx"}`
- [ ] 输入消息发送，确认 `{type:"message"}` 已发出
- [ ] 看到文字逐字出现（delta 事件），结束后有 stream_end + turn_end
- [ ] 发一条 → 收到回复 → 再发一条 → 再收到回复，历史正确累积

### P2: 交互细节
- [ ] 连续消息 — 快速连发两条，不丢消息
- [ ] 新建会话 — 点新建，WS 发 new_chat，收到新 chat_id，历史清空
- [ ] 切换会话 — 切到旧会话，看到旧消息（本地缓存）
- [ ] 断线重连 — 杀掉 gateway → 前端显示断线 → 重启 → 自动重连
- [ ] 错误处理 — error event → 前端展示提示（不白屏）
- [ ] Tool hints — Agent 调用 tool 时显示 progress 消息
- [ ] 空消息拦截 — 不允许发送空消息
- [ ] 长消息 — 1000+ 字正常处理

### P3: 清理
- [ ] 移除 Electron 专属代码（window.desktop 依赖改为 optional）
- [ ] 移除 terminal/editor/explorer 的后端依赖（UI 保留，功能禁用）
- [ ] Vite build 配置为纯 Web 模式（去掉 `base: "./"` 的 Electron 适配）

## ai-base WebSocket 协议参考

### Client → Server
```json
{"type": "new_chat"}
{"type": "attach", "chat_id": "xxx"}
{"type": "message", "chat_id": "xxx", "content": "hello", "media": [], "webui": true}
```

### Server → Client
```json
{"event": "ready", "chat_id": "xxx", "client_id": "yyy"}
{"event": "delta", "chat_id": "xxx", "text": "chunk..."}
{"event": "stream_end", "chat_id": "xxx"}
{"event": "turn_end", "chat_id": "xxx"}
{"event": "message", "chat_id": "xxx", "text": "full msg", "kind": "tool_hint"|"progress"}
{"event": "attached", "chat_id": "xxx"}
{"event": "error", "detail": "reason"}
```

## 关键文件索引

| 文件 | 作用 |
|------|------|
| `src/services/websocket-client.ts` | WS 连接管理（connect/send/reconnect） |
| `src/services/ws-stream-manager.ts` | 消息状态管理（处理 WS 事件 → 维护 messages 数组） |
| `src/services/api.ts` | 对外 API facade（sendMessage/newChat/switchChat） |
| `src/stores/chat.ts` | Zustand store，订阅 stream-manager 变更 |
| `src/stores/session.ts` | Session 列表（本地维护） |
| `src/features/chat/ChatInput.tsx` | 消息输入组件 |
| `src/features/chat/MessageList.tsx` | 消息列表渲染 |
| `src/features/chat/AssistantMessage.tsx` | AI 回复渲染（markdown） |

## 后端关键文件

| 文件 | 作用 |
|------|------|
| `E:\binn\ai-base\src\ai_base\channels\websocket.py` | WebSocket channel 实现（1335 行） |
| `E:\binn\ai-base\src\ai_base\channels\manager.py` | Channel 管理器（启动/路由/重试） |
| `E:\binn\ai-base\src\ai_base\agent\loop.py` | Agent 主循环（消息分发） |
| `C:\Users\蒋全明\.ai-base\config.json` | 运行时配置 |

## 注意事项

1. **不要兼容旧代码** — 旧的 REST+SSE 全部删掉，只用 WS
2. **WebSocket channel 端口与 gateway 端口相同** — 都是 18790，WS path 默认是 `/`
3. **前端的 `window.desktop`** — 是 Electron preload bridge，浏览器模式下不存在。需要 graceful fallback（目前在组件里用 `window.desktop?.xxx` 处理）
4. **config.json 的 channels.websocket 格式** — 参考 `websocket.py` 里 `WebSocketConfig` 类的字段定义
