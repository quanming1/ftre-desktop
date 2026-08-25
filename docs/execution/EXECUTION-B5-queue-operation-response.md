# B5 Queue Operation Response 客户端统一消费执行报告

## 范围

- 仓库：`E:\binn\ftre-desktop`
- 分支：`feature/B5-chat-reducer-cleanup`
- 配套后端阶段：`E:\ftre` F24
- 未修改：Electron 主进程、Agent Core、Inbox 存储

## 实现结果

- `packages/renderer/src/services/websocket-client.ts`
  - `QueueSnapshotPayload` 强制要求服务端 `revision`；缺失字段的旧帧直接拒绝。
  - 删除 `MessageAckPayload`、`getMessageAckPayload`、`QueueUpdateResult` 和 `value.accepted` admission 成功路径。
  - `sendChat` outbox、`updateQueue`/`promoteQueueItemToSteer` waiter 统一由带 payload 的 `session/queue` 响应结算。
- `packages/renderer/src/stores/chat.ts`
  - 只保留 Zustand 状态、session bucket、WebSocket wiring 和用户操作，文件从 2112 行降至 997 行。
- `packages/renderer/src/stores/chatProjection.ts`
  - 集中承载 `applyQueueSnapshot`、`applyReplySnapshot` 和 `applyEvent`，按 revision、message_id
    与事件 id 做纯投影去重；不持有 React/Zustand 生命周期。
  - 删除 ACK 后本地 Steering placement 猜测；queued/steering 完全由服务端 payload 驱动。
  - 移除 claim 与 USER_MESSAGE 之间的 `awaitingEcho` 视觉屏障；claim 快照到达即清理队列，
    UserMessage 回显只负责进入 MessageList。
- `packages/renderer/src/stores/chatTypes.ts`
  - 承载 ChatMessage、ContentBlock、Queue 交互所需的共享类型，消除纯投影模块对 Store 的反向类型依赖。
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
pnpm test
52 renderer files / 518 tests passed；platform 10 tests passed
pnpm exec tsc -p packages/renderer/tsconfig.json --noEmit
passed
```

配套协议单测覆盖 prompt response、steer response、revision 乱序、重连 outbox、普通 pending
不显示“正在消费”、以及旧 Assistant `message_id` 缺失丢弃。

## Queue UI 收尾

- QueueItem 改为输入框正上方的单行结构，只显示真实用户消息和操作入口；移除“消息队列”折叠标题以及重复的消息预览。
- QueueItem 与输入面板使用同一个 `--ftre-bg-composer`/`bg-composer` Surface；QueueItem 保留淡边框，输入框保留完整上边框，避免透明度叠加导致色差。
- 更多菜单继续在队列项上方浮出，不受输入框容器裁剪；调整方向、删除和编辑仍复用原 Queue Operation Response 协议。
- Queue UI 改动后重新执行 renderer 全量测试：`52 files / 526 tests passed`；TypeScript 与 Vite build 通过。

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
| 2026-08-25 | 完成 `chat.ts` → `chatProjection.ts` 投影/Store 分层重构；997 行 Store + 1136 行纯 reducer，全部门禁通过 |
| 2026-08-25 | 修复操作响应与后台快照乱序导致的 optimistic 队列残留；新增“空响应”和“旧响应”回归，验证 522 个前端测试、平台 10 个测试、tsc、Vite build 通过 |
| 2026-08-25 | 按确认的 Queue UI 预览完成队列单行布局、Surface token 和菜单层级收口；renderer 全量 526 tests、tsc、Vite build 通过 |

## 最终合入

- B5 功能提交：`09dcc7c feat(B5): 完成队列投影重构与队列界面收口`。
- PR #63 已合入 `develop`，合入提交：`4afb9a1`；本地 `develop` 已同步 `origin/develop` 且工作树干净。
