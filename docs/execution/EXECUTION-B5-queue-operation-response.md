# B5 Queue Operation Response 客户端统一消费执行报告

## 范围

- 仓库：`E:\binn\ftre-desktop`
- 分支：`feature/B4-steering-message-projection`
- 配套后端阶段：`E:\ftre` F24
- 未修改：Electron 主进程、Agent Core、Inbox 存储

## 实现结果

- `packages/renderer/src/services/websocket-client.ts`
  - `QueueSnapshotPayload` 强制要求服务端 `revision`；缺失字段的旧帧直接拒绝。
  - 删除 `MessageAckPayload`、`getMessageAckPayload`、`QueueUpdateResult` 和 `value.accepted` admission 成功路径。
  - `sendChat` outbox、`updateQueue`/`promoteQueueItemToSteer` waiter 统一由带 payload 的 `session/queue` 响应结算。
- `packages/renderer/src/stores/chat.ts`
  - `applyQueueSnapshot` 按服务端 revision 丢弃旧/重复快照，不再按客户端收帧顺序递增。
  - 删除 ACK 后本地 Steering placement 猜测；queued/steering 完全由服务端 payload 驱动。
  - 移除 claim 与 USER_MESSAGE 之间的 `awaitingEcho` 视觉屏障；claim 快照到达即清理队列，
    UserMessage 回显只负责进入 MessageList。
- `packages/renderer/src/stores/clientSessionProjection.ts`
  - 删除 `steeringRequests` 本地意图，只保留 session revision 投影。
- `packages/renderer/src/features/chat/QueuedMessagesBanner.tsx`
  - Steering 点击只等待 Queue Operation Response，成功后由同一 payload 更新 UI。

## 验证结果

```text
pnpm --filter @ftre/renderer test
52 files, 517 tests passed
pnpm exec tsc -p packages/renderer/tsconfig.json --noEmit
passed
pnpm --filter @ftre/renderer build
passed（仅已有 CSS/chunk size 警告）
```

配套协议单测覆盖 prompt response、steer response、revision 乱序、重连 outbox、普通 pending
不显示“正在消费”、以及旧 Assistant `message_id` 缺失丢弃。

收尾审计后，renderer `test` script 会先构建 `@ftre/shared` 和 `@ftre/ui`，因此在没有历史
workspace `dist` 的清洁工作树中，根 `pnpm test` 仍可直接运行。

最终静态扫描确认 renderer 生产代码不再包含 `getMessageAckPayload`、`QueueUpdateResult`、
`MessageAckPayload`、`consumeDurableAdmissionAck`、`steeringRequests` 或
`markQueueItemSteering`。依赖目录未纳入清理范围；renderer 自有构建输出已在最终验证后清理。

## 变更记录

| 日期 | 结果 |
|---|---|
| 2026-08-25 | 完成 B5 客户端统一消费 Queue Operation Response；全量 renderer test、TypeScript 和 Vite build 通过 |
| 2026-08-25 | 修复 claim 后队列项残留：删除 `awaitingEcho` 客户端中间态并新增乱序/重复回显回归 |
