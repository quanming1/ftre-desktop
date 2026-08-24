# B1 执行报告：WebSocket F12 协议与 Inbox 适配

## 范围

- 仓库：`E:\binn\ftre-desktop`
- 分支：`feature/B1-ws-protocol-bridge`
- 关联后端协议：`E:\ftre` F12 `ftre-inbox` WebSocket contract
- 未修改：`E:\ftre-agent-core`、后端源码、客户端用户数据

## 根因

桌面端仍发送旧 `user_message/data/frame_id` 帧，而 ftre 后端只接受
`session.prompt/payload/request_id`。后端将旧帧作为 unknown frame 静默忽略，既没有
错误也没有 durable ACK，导致消息看起来“发送成功后消失”。

## Owner 与协议迁移

| 旧职责 | 新 Owner/协议 | 证据 |
|---|---|---|
| `user_message` + `data` + `frame_id` 上行 | `session.prompt` + `payload` + `request_id` | `websocket-client.ts`、协议单测 |
| `cancel` 控制帧 | `session.cancel` + `payload.expected_request_id` | cancel 重连/ACK 回归测试 |
| `session_event:mailbox_snapshot` | `session/queue` + `QueueSnapshotPayload` | `chat.protocol.test.ts`、Store 投影测试 |
| `global_event:session_status` | `session/status` + 独立 status payload | WebSocket parser 测试、真实 Gateway smoke |
| `MailboxItemPayload` / `applyMailboxSnapshot` | `QueueItemView` / `applyQueueSnapshot` | 运行时代码最终搜索无旧类型/函数 |

## 生命周期审计

- `WebSocketClient` 仍是单一 WS Owner；`disconnect()` 清理 socket、重连 timer 和稳定性
  timer，`unackedChats/unackedControls` 按设计保留用于重连重发。
- `request_id` 是聊天和控制操作唯一相关性键；ACK/error 后分别清理对应 outbox。
- `session.cancel` ACK 不会被误判为聊天 admission ACK；无匹配 optimistic queue item 时
  Store 不会错误地把 idle Session 置为 running。
- attach 重连使用 `payload.session_id`，消息事件通过 `payload` 投影到当前 Session。

## 验证证据

```text
pnpm test
  renderer: 48 files / 486 passed
  Electron/platform: 7 passed
  renderer tsc: passed

真实 Gateway WebSocket smoke
  attach -> reply_snapshot/session/queue/session/status
  session.prompt -> durable RPC ACK (ok=true)
  session.cancel -> RPC response (active turn 已结束时 accepted=false 为正确业务结果)

git diff --check -> passed
TODO YAML parse -> passed
旧运行时协议/Owner 搜索 -> 无命中
```

## 清理与最终状态

- 清理 5 个 workspace 包构建输出：`packages/*/dist`；未触碰 `node_modules` 及依赖缓存。
- `src` 范围空目录：0。
- 当前工作区仍有本轮未提交修改；按用户未要求 commit，本轮未执行 commit/push/merge。
- B1 PRD 已验收，TODO B1/B1.1-B1.3 为 done，CHANGELOG 已记录。
