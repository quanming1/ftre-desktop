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
| `packages/renderer/src/stores/chat.ts` | 只负责 Zustand 状态、session bucket、WS wiring 和用户操作 |
| `packages/renderer/src/stores/chatProjection.ts` | 纯函数式消费 Queue/Reply/Event 事实；按 revision、message_id 和事件 id 做投影去重 |
| `packages/renderer/src/stores/chatTypes.ts` | Store 与纯投影共享的数据契约；不依赖 Zustand 或 WebSocket 生命周期 |
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
| 2026-08-25 | 将 chat.ts 的纯投影 reducer 拆到 `chatProjection.ts`，chat.ts 仅保留 Store/WS/交互编排；原 AC1–AC7 全部重跑通过 | 降低单文件复杂度，避免协议 reducer 与 Zustand 生命周期互相耦合 |
| 2026-08-25 | 修复“Agent 已完成但队列仍显示”：Queue Operation Response 的 `request_id` 独立于 revision 结算本地 optimistic 项，覆盖空快照和乱序响应 | Inbox 可能在响应生成前完成 claim；客户端不能因后台快照先到或响应 revision 较旧而保留已消费项 |
| 2026-08-25 | 修复 queue snapshot 先到时跳过 `session/status: idle` 的状态门禁；完成消息立即进入可操作态并显示 token/复制信息 | Queue pending 与 Agent 活跃状态是两条独立事实流，不能用 `hasCoordinatorState` 阻断 idle 状态 |
| 2026-08-25 | Queue UI 按确认的预览结构重构：队列项改为输入框上方单行、真实消息内容、调整方向/删除/更多操作；队列项与输入框统一使用 `composer` Surface token，保留输入框上边框并消除透明度叠加色差 | 原队列横幅包含独立背景层和折叠标题，导致队列项与输入面板出现色差、菜单层级和边框关系不清晰 |
| 2026-08-25 | Assistant 消息底部展示持久化 `finished_at`；token 使用输入/输出图标表达分量，结束时间小于一周显示相对时长，超过一周显示 `YYYY MM dd HH:mm:ss`；复制、token、模型和时间统一使用 `text-t-faint`，消息 hover 时通过 `visibility` 显示 | 用户需要区分输入/输出成本和消息新鲜度，底部运行元数据默认应弱化，且 hover 不应改变消息高度 |
| 2026-08-25 | User 消息将复制按钮移至气泡底部，并与 Assistant 共用相对/绝对时间规则；元数据默认通过 `visibility` 隐藏，消息 hover 时显示，不使用高度折叠 | 用户消息与 Assistant 消息采用一致的底部操作布局和时间表达，避免复制按钮占用气泡左侧空间和 hover 布局跳动 |
| 2026-08-25 | ChatMessageList 增加 `isCompacting` 门禁；压缩状态只显示 CompactBubble，不再同时渲染通用“处理中”占位 | `isBusy` 同时覆盖执行和压缩，压缩命令刚发送时会出现两个状态提示 |
| 2026-08-25 | 文件变更胶囊增加 `sessionStatus=compacting` 门禁；压缩期间即使 `isBusy=true` 也不展示上一轮临时摘要 | `isBusy` 覆盖运行和压缩两种状态，单独判断会导致压缩中误显示胶囊 |
