# B3 执行报告：Runtime Steering 队列交互

## 结果

B3 已完成。客户端保持普通发送的 `mode=queue`，在队列横幅上对服务端
`placement="queued"` 的同一条消息提供“插入当前运行”按钮。点击只发送
`session.updateQueue({ action: { kind: "steer" } })`，不重发文本、不生成第二个
request_id；收到 `steering` 快照后显示“等待下一次推理”。

`USER_MESSAGE` 是唯一的历史交接点：客户端收到它后立即按 request_id 把正式用户消息
加入 MessageList 并移除横幅项；queue snapshot 负责最终确认，乱序或重复事件不会制造
“消失→重新出现”的视觉空窗。

## 改动

- `websocket-client.ts`：QueueItemView 保留 placement，新增
  `promoteQueueItemToSteer()` 高层 API。
- `chat.ts`：queue snapshot 和本地 optimistic preview 都保留 placement。
- `QueuedMessagesBanner.tsx`：新增按钮、处理中状态、steering 只读状态和失败通知；不
  做乐观删除。
- `chat.ts`：active assistant 收到 USER_MESSAGE 时切分 segment，后续同 reply_id 的流式
  事件写入新的尾段，避免用户消息被拖到整轮回复末尾。
- 对应 websocket、store、banner 测试覆盖 ACK、placement、按钮和 USER_MESSAGE 交接。

## 验证

| 命令 | 结果 |
|---|---|
| `pnpm --filter @ftre/renderer test` | 514 passed / 52 files |
| `pnpm --filter @ftre/renderer exec tsc --noEmit` | passed |
| `pnpm --filter @ftre/renderer build` | passed；仅保留仓库既有 Vite warnings |
| `git diff --check` | passed |

后端 F22 的 `tests/startup/test_f12_ws_smoke.py` 与 Inbox/Core Hook 专项同时验证了同一
协议帧和 queue→steer 数据链路。未修改 `E:\ftre-agent-core`、`E:\cordis-py`。

## 工程卫生

未执行 commit、push、merge 或 release；构建生成的 renderer `dist` 由既有忽略规则排除。

## Refactor Cleanup Audit（2026-08-24）

- `QueueItemView.placement`、`promoteQueueItemToSteer` 和横幅按钮是唯一客户端
  `queue → steer` Owner；没有重复的队列升级入口或旧 Hook 适配层。
- `chat.ts` 是唯一 MessageList 投影 Owner：`USER_MESSAGE` 先切分 active assistant
  segment，再插入 UserMessage；后续同 `reply_id` 事件只进入新的尾段。
- AST/文本扫描未发现本批改动引入旧协议别名、兼容 re-export、重复发送或乐观删除逻辑；
  `awaitingEcho` 与 `placement=steering` 都由服务端事实驱动。
- B3 测试 514 passed / 52 files，TypeScript 和 Vite build 通过，`git diff --check` 通过。
- `__pycache__`、`.pytest_cache`、`.ruff_cache` 为 0；`.ftre/snapshot`、`.taskmaster/reports`
  和 `backend/server/data/logs` 中的空目录属于客户端运行/工具数据，未做破坏性清理。
- 当前仍在 `feature/F22-runtime-steering`，本阶段修改未提交；未执行 commit、push、merge 或 release。
