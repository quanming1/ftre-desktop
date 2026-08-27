# B4 执行报告：Steering 多 AssistantMessage 客户端投影

## 结果

- 状态：已完成
- 分支：`feature/B4-steering-message-projection`
- 范围：renderer WebSocket 类型、Session Projection、Chat reducer、队列横幅和测试；未修改后端或 Agent Core。

## 实现证据

| 语义 | 代码位置 | 结果 |
|---|---|---|
| Assistant 事件坐标 | `packages/renderer/src/services/websocket-client.ts` | `AgentStreamEvent`/`ReplySnapshotItem` 明确携带 `message_id`，快照校验该字段 |
| 事件路由 | `packages/renderer/src/stores/chat.ts` `applyEvent` | Assistant reducer 以 `message_id` 查找/创建气泡，`reply_id` 仅保存为运行元数据 |
| 快照重连 | `packages/renderer/src/stores/chat.ts` `applyReplySnapshot` | revision 以 `message_id` 去重，同 reply 的 A/B 不覆盖 |
| UserMessage 交接 | `packages/renderer/src/stores/chat.ts` | USER_MESSAGE 追加 U，不主动 split/重命名 Assistant；queue snapshot 决定何时移除 pending |
| 乱序处理 | `packages/renderer/src/stores/chat.ts` `applyQueueSnapshot` | claim snapshot 先到时保留 `awaitingEcho`，U 到达后清理视觉占位 |
| 旧 segment 清理 | `packages/renderer/src/stores/chat.ts` | 删除 `splitActiveReplyBeforeUserMessage`、`reply_segment` 和派生 id |

## 验证

```text
pnpm --filter @ftre/renderer test
Test Files 52 passed; Tests 517 passed

pnpm exec tsc -p packages/renderer/tsconfig.json --noEmit
通过

pnpm --filter @ftre/renderer build
通过（仅已有 CSS/chunk size 警告）
```

新增回归覆盖：A→U→B 的服务端 message_id 投影、A/B 同 reply 不合并、Tool 结果按
Assistant 路由、USER_MESSAGE 与 queue snapshot 任意顺序、重复与重连 revision 去重、
Steering ACK 后立即切换 placement 和旧快照不回退、旧 message_id 事件丢弃。

## 收尾审计

- renderer 源码中没有 `reply_segment`、`splitActiveReplyBeforeUserMessage` 或
  `reply_id:segment:*` 引用。
- 2026-08-25 修复 Steering ACK 后 UI 不变的问题：ACK 成功后本地立即将队列项标记为
  `steering`，并在 Projection 中保留该本地意图，避免旧/缺失的 `session/queue` 快照把
  状态回退成 `queued`。
- 同步修正普通消息的状态语义：durable ACK 只表示 Inbox 已写入，仍在 pending 的消息
  保持“下一条/等待下一次推理”；只有 claim 后 queue snapshot 移除该项、而 USER_MESSAGE
  尚未到达时，才保留 `awaitingEcho` 并显示“正在消费”。
- 已删除本次验证生成的 renderer `.vite` 临时缓存；复核数量为 0。`node_modules` 与
  既有 `dist` 属于仓库依赖/构建资产，未做宽泛删除。
- 工作树仍保留本批未提交的源码、PRD、TODO、CHANGELOG 和执行报告修改；未执行 commit/push。

## 用户可见流程

```text
发送/点击 Steering
→ pending 横幅继续显示
→ 后端 USER_MESSAGE 已落库并推送
→ MessageList 追加 U（不闪烁、不生成 segment）
→ queue snapshot 确认 claim 后移除横幅项
→ 首个 message_id=B 事件到达，客户端自然创建 Assistant B
```
