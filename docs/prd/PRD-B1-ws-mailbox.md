# PRD-B1-WS 协议与 Inbox 适配

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | B1 |
| 名称 | WS 协议与 Inbox 适配 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-12 |
| 定稿日期 | 2026-08-12 |
| 验收日期 | 2026-08-23 |
| 关联文档 | docs/TODO.yaml 阶段 B1；AGENTS.md；docs/execution/EXECUTION-B1-ws-inbox-protocol.md |

## 1. 背景与目标

- **背景**：ftre 后端已将队列迁入 `ftre-inbox`，WebSocket 契约冻结为
  `session.prompt`、`session.cancel`、`session.updateQueue`、`session/queue` 和
  `session/status`。桌面端仍发送旧 `user_message/data/frame_id`，导致消息被后端静默忽略。
- **目标**：桌面端直接消费 F12 wire contract——消息必须得到 durable admission ACK，
  `payload` envelope、队列快照、状态事件、断线重连和取消语义保持一致。
- **非目标**：不在后端恢复旧协议兼容层；不修改 Agent、Inbox 或 Session 数据面。

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：Inbox queue 快照解析（服务端快照 → 前端会话状态）
- [x] FR2：phase → activity 映射（会话阶段映射为前端活动状态展示）
- [x] FR3：durable ack 消费（消息按 durable 语义确认消费）
- [x] FR4：outbox 断线保留 + 重连重发（未送达消息不丢失）
- [x] FR5：sendCancel(expected_request_id) 取消请求
- [x] FR6：QueuedMessagesBanner 队列横幅（pending 消息可视化）
- [x] FR7：cancelQueuedMessage API（取消排队消息）
- [x] FR8：会话删除确认弹窗（防误删，确认后调用 deleteSession）
- [x] FR9：新版上行协议——聊天使用 `session.prompt` + `payload` + `request_id`，
  工具确认走同一 Command Plane，取消使用 `session.cancel`。
- [x] FR10：新版下行 envelope——事件和快照从 `payload` 解析，durable admission 使用
  `{request_id, ok, value}` ACK，错误使用统一 error envelope。
- [x] FR11：outbox 与重连——按 `request_id` 保留和重发未 ACK 消息；收到 ACK 或明确错误后
  才移除本地 outbox；attach/detach 使用 `payload.session_id`。
- [x] FR12：真实 Gateway 联调——客户端消息可进入 Inbox、收到 ACK、显示队列/状态和 Agent
  事件；不再出现“发送成功但后端无记录”的静默丢帧。

### 2.2 非功能需求

- 可靠性：断线重连期间消息零丢失（durable + outbox）
- 性能：快照解析与投影更新流畅，大消息体不卡 UI
- 兼容性：与 ftre F12 协议版本保持一致，不再发送已退役的 `user_message/data/frame_id`。

## 3. 技术方案

- 模块设计：
  - `packages/renderer/src/services/websocket-client.ts`：WS 客户端（连接管理 / 重连 / 帧收发）
  - `packages/renderer/src/stores/chat.ts`：聊天状态 store
  - `packages/renderer/src/stores/session.ts`：会话状态 store
  - `packages/renderer/src/stores/clientSessionProjection.ts`：服务端快照 → 前端投影
  - `packages/renderer/src/features/chat/QueuedMessagesBanner.tsx`：队列横幅组件
- 关键数据结构：`session/queue` 快照、`session/status` 状态、`payload` envelope、
  `request_id` outbox。

## 4. 接口定义

- 上行：
  - `attach` / `detach`：`payload.session_id`；
  - `session.prompt`：`request_id` + `payload.{session_id, mode, content, attachments}`；
  - `session.cancel`：`request_id` + `payload.{session_id, expected_request_id}`；
  - `session.updateQueue`：`request_id` + `payload.{session_id, item_id, action}`。
- 下行：
  - durable ACK：`{request_id, ok: true, value: {accepted, session_id}}`；
  - 错误：`{request_id, ok: false, error: {code, message, session_id, retryable}}`；
  - 业务事件：`{type, payload, metadata, request_id?}`。
- store API：`sendMessage` / `sendCancel` / `cancelQueuedMessage`

## 5. 验收标准

- [x] AC1：Inbox queue 快照正确渲染为队列消息与状态
- [x] AC2：断线期间发送的消息在重连后不丢失（outbox 重发）
- [x] AC3：队列横幅正确显示 pending 消息与进度
- [x] AC4：取消排队消息后该消息不再发送
- [x] AC5：会话右键「删除会话」先弹确认弹窗，确认后才执行删除（手动验证）
- [x] AC6：`sendChat()` 发出的帧为 `session.prompt`，使用 `payload` 和稳定 `request_id`；
  `sendCancel()` 发出的帧为 `session.cancel`。
- [x] AC7：客户端能解析无 `type` 的 durable ACK、`payload` 业务事件、`reply_snapshot`、
  `session/queue` 和 `session/status`，并正确路由到对应 Session。
- [x] AC8：未收到 ACK 的消息在重连后按同一 `request_id` 重发；收到 ACK 或明确错误后从
  outbox 移除；attach/detach 在重连后仍然有效。
- [x] AC9：真实 Gateway WebSocket smoke 完成 attach、prompt、ACK、队列快照、状态和
  Agent event 链路；客户端不再出现静默丢帧。

## 6. 测试计划

- 自动化：`packages/renderer/src/services/websocket-client.test.ts` 覆盖新版上下行契约、
  ACK、outbox、重连和取消；`chat.protocol.test.ts` 覆盖 Store 事件路由。
- 手动/集成：启动 `ftre gateway`，客户端连接后发送普通消息、steer、取消和断线重连，
  检查 Gateway session Inbox 与客户端聊天/队列/状态显示一致。

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-12 | 初始定稿 | — |
| 2026-08-14 | 新增 FR8 / AC5：SessionPanel 会话删除增加确认弹窗（ConfirmDialog），右键菜单补充 Trash2 图标。归属说明：B1 模块含 session store，本变更为会话管理 UI 完善；原 AC1-AC4 不受影响 | 用户需求：删除会话防误操作 |
| 2026-08-23 | 新增 FR9-FR12：客户端迁移到 ftre F12 WebSocket 契约，统一使用 `payload` envelope、`request_id` ACK、session.prompt/session.cancel，并补充真实 Gateway 联调验收 | 旧客户端仍发送 `user_message/data/frame_id`，后端会静默忽略导致消息消失 | 修正 FR3-FR5，新增 AC6-AC9 |
| 2026-08-23 | B1 收尾验收：renderer 48 个测试文件/486 项测试、Electron/platform 7 项测试、tsc、真实 Gateway attach/prompt ACK/cancel smoke 全部通过 | 确认客户端已与 ftre F12 Inbox wire contract 对齐，消除消息静默丢帧 | FR9-FR12、AC6-AC9 |
