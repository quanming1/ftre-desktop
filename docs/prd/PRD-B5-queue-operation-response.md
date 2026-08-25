# PRD-B5 Queue Operation Response 客户端统一消费

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | B5 |
| 名称 | Queue Operation Response 客户端统一消费 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-25 |
| 定稿日期 | 2026-08-25 |
| 验收日期 | 2026-08-25 |
| 关联文档 | `docs/TODO.yaml` B5；`E:\ftre\docs\prd\PRD-F24-queue-operation-response.md`；B4 Steering 投影；AGENTS.md |

## 1. 背景与目标

当前客户端分别处理 durable ACK、optimistic queue item 和 `session/queue` 快照。
ACK 与快照到达顺序不稳定，导致点击 Steering 后 placement 不立即变化，以及普通 pending
消息被误标为“正在消费”。已消费项不能因为等待 USER_MESSAGE 回显而继续占据队列横幅。

本阶段让客户端把 Queue Operation Response 当作一次完整事实：请求结算和队列投影由同一
payload 完成；后台 `session/queue` 仍可独立更新队列。客户端不保留旧协议兼容分支，
Assistant/Queue 当前协议缺失必需字段时直接丢弃，不猜测旧字段。

### 非目标

- 不修改 Core、Inbox Repository、Session Projection 或 Electron 主进程。
- 不让客户端读取原始 `inbox.json`。
- 不恢复 `reply_segment`、旧 Assistant 分段或旧 ACK 兼容算法。

## 2. 需求范围

### 2.1 功能需求

- [x] **FR1：统一 Queue Response**：解析 `type=session/queue`、`request_id`、`ok`、`payload`；成功 payload 直接进入 `applyQueueSnapshot`。
- [x] **FR2：删除独立 admission ACK**：删除 `getMessageAckPayload`、`value.accepted` 成功路径和 `unackedChats` 对 ACK 的专用分支；请求由 Queue Response 结算。
- [x] **FR3：控制操作统一返回**：`promoteQueueItemToSteer`、edit、remove 的 Promise 以 QueueSnapshot 完成，不再依赖 item_id ACK。
- [x] **FR4：revision 防旧快照覆盖**：使用服务端 revision 丢弃旧 QueueSnapshot；同 revision 重复幂等。
- [x] **FR5：队列显示语义**：操作响应中的 queued/steering 立即显示；仍在 pending 的 item
  不显示“正在消费”；claim 后 item 立即从队列横幅移除，USER_MESSAGE 独立进入 MessageList。
- [x] **FR6：后台推送**：无 request_id 的 `session/queue` 仍更新当前 Session，不影响 UserMessage 和 Assistant `message_id` 投影。
- [x] **FR7：错误**：`ok=false` 通过统一 RPC error 处理，清理对应本地 outbox/控制等待，不修改错误 session 的队列。
- [x] **FR8：严格当前协议**：reply snapshot Assistant item 必须有 `message_id`；缺失字段不回退旧 id、不生成 segment。

### 2.2 非功能需求

- `QueueSnapshot` reducer 必须保持不可变 bucket 更新。
- 重连 replay 的未完成请求仍使用原 request_id，成功 Queue Response 到达后清理 outbox。
- 不增加第二个队列状态 Owner；`ClientSessionProjection` 是唯一客户端投影入口。

## 3. 技术方案

| 文件 | 改动 |
|---|---|
| `packages/renderer/src/services/websocket-client.ts` | 定义 Queue Response/Revision 类型；删除独立 Message ACK parser；控制 Promise 返回 QueueSnapshot |
| `packages/renderer/src/stores/chat.ts` | 统一消费 Queue Response；按服务端 revision 应用快照；删除 ACK 专用状态转换 |
| `packages/renderer/src/stores/clientSessionProjection.ts` | 保存 queue revision，支持重连/乱序 |
| `packages/renderer/src/features/chat/QueuedMessagesBanner.tsx` | 只根据服务端 pending placement 渲染，不保留已 claim 占位 |

## 4. 接口定义

### 4.1 成功响应

```json
{
  "type": "session/queue",
  "request_id": "op-001",
  "ok": true,
  "payload": {
    "session_id": "ws_sess_1",
    "revision": 13,
    "items": []
  }
}
```

### 4.2 后台推送

```json
{
  "type": "session/queue",
  "payload": {
    "session_id": "ws_sess_1",
    "revision": 14,
    "items": []
  }
}
```

### 4.3 失败响应

```json
{
  "request_id": "op-001",
  "ok": false,
  "error": {
    "code": "item-not-pending",
    "message": "消息已不在队列中",
    "retryable": false
  }
}
```

## 5. 验收标准

- [x] **AC1**：prompt 成功响应直接创建/更新 queued item，不再依赖独立 ACK。
- [x] **AC2**：Steering 成功响应直接显示 steering placement，无刷新延迟。
- [x] **AC3**：普通 pending 消息在 Queue Response 后显示“下一条”，不显示“正在消费”。
- [x] **AC4**：claim 快照先到、USER_MESSAGE 先到、重复快照和重连均不丢失/重复 UserMessage，
  且 claim 后队列横幅立即清空。
- [x] **AC5**：旧/缺失 message_id 的 Assistant 帧不进入 MessageList，不生成 segment。
- [x] **AC6**：renderer 全量测试、TypeScript、Vite build 通过。
- [x] **AC7**：与 ftre F24 的跨仓协议测试通过。

## 6. 测试计划

- websocket-client：Queue Response 成功/错误、重连重发、revision 过滤。
- chat reducer：prompt/steer/edit/remove、后台 queue push、乱序和重复。
- UI：Steering placement 即时显示，普通 pending 文案正确，claim 后不显示“正在消费”占位。
- A/U/B 回归：Queue Response 改造不影响 UserMessage 与 Assistant `message_id`。

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-25 | 初始定稿；客户端统一消费 Queue Operation Response，取消独立 ACK 状态机 | 简化 WebSocket 协议并消除队列状态延迟 |
| 2026-08-25 | 完成 B5：队列响应直接驱动请求结算、revision 投影和 Steering UI；全量测试/tsc/build 通过 | 删除客户端独立 admission ACK 与本地 Steering 猜测状态 |
| 2026-08-25 | 收尾审计修正 renderer 测试入口：先构建 workspace shared/ui 再运行 Vitest | 清洁工作树不再依赖残留 dist 产物 |
| 2026-08-25 | 修复 claim 后队列横幅残留：移除 `awaitingEcho` 中间态，Queue Snapshot 立即清理，USER_MESSAGE 独立进入 MessageList | 用户消息已在后端 DB-first 持久化，客户端不应继续显示已消费队列项 |
