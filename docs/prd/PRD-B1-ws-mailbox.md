# PRD-B1-WS 协议 + mailbox 适配

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | B1 |
| 名称 | WS 协议 + mailbox 适配 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-12 |
| 定稿日期 | 2026-08-12 |
| 验收日期 | 2026-08-12 |
| 关联文档 | docs/TODO.yaml 阶段 B1；AGENTS.md |

## 1. 背景与目标

- **背景**：后端采用 SessionLane 架构，基于 mailbox 快照同步会话状态，并要求 durable admission（持久化准入）保证消息不丢；前端需要完整适配该协议。
- **目标**：前端通过 WebSocket 与后端 mailbox 协议互通——快照解析、消息收发、断线重连不丢消息、排队消息可视化与取消。
- **非目标**：不做协议服务端实现；不做多后端会话的路由管理。

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：mailbox 快照解析（服务端快照 → 前端会话状态）
- [x] FR2：phase → activity 映射（会话阶段映射为前端活动状态展示）
- [x] FR3：durable ack 消费（消息按 durable 语义确认消费）
- [x] FR4：outbox 断线保留 + 重连重发（未送达消息不丢失）
- [x] FR5：sendCancel(expected_request_id) 取消请求
- [x] FR6：QueuedMessagesBanner 队列横幅（pending 消息可视化）
- [x] FR7：cancelQueuedMessage API（取消排队消息）
- [x] FR8：会话删除确认弹窗（防误删，确认后调用 deleteSession）

### 2.2 非功能需求

- 可靠性：断线重连期间消息零丢失（durable + outbox）
- 性能：快照解析与投影更新流畅，大消息体不卡 UI
- 兼容性：适配 v5 协议版本的消息结构

## 3. 技术方案

- 模块设计：
  - `packages/renderer/src/services/websocket-client.ts`：WS 客户端（连接管理 / 重连 / 帧收发）
  - `packages/renderer/src/stores/chat.ts`：聊天状态 store
  - `packages/renderer/src/stores/session.ts`：会话状态 store
  - `packages/renderer/src/stores/clientSessionProjection.ts`：服务端快照 → 前端投影
  - `packages/renderer/src/features/chat/QueuedMessagesBanner.tsx`：队列横幅组件
- 关键数据结构：mailbox 快照消息、phase 状态机、outbox 持久队列

## 4. 接口定义

- WS 帧：mailbox 快照 / 消息 / ack / cancel（expected_request_id）
- store API：`sendMessage` / `sendCancel` / `cancelQueuedMessage`

## 5. 验收标准

- [x] AC1：mailbox 快照正确渲染为会话消息与状态
- [x] AC2：断线期间发送的消息在重连后不丢失（outbox 重发）
- [x] AC3：队列横幅正确显示 pending 消息与进度
- [x] AC4：取消排队消息后该消息不再发送
- [x] AC5：会话右键「删除会话」先弹确认弹窗，确认后才执行删除（手动验证）

## 6. 测试计划

- 手动验证：断网重连场景模拟、多消息并发、取消排队消息

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-12 | 初始定稿 | — |
| 2026-08-14 | 新增 FR8 / AC5：SessionPanel 会话删除增加确认弹窗（ConfirmDialog），右键菜单补充 Trash2 图标。归属说明：B1 模块含 session store，本变更为会话管理 UI 完善；原 AC1-AC4 不受影响 | 用户需求：删除会话防误操作 |
