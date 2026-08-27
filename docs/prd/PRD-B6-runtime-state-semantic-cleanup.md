# PRD-B6 客户端运行状态语义收敛

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | B6 |
| 名称 | 客户端运行状态语义收敛 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-25 |
| 定稿日期 | 2026-08-25 |
| 验收日期 | 2026-08-25 |
| 关联文档 | `docs/TODO.yaml` B6；B5 Queue Operation Response；`AGENTS.md` |

## 1. 背景与目标

客户端的 `isBusy` 同时表示 Agent 执行、上下文压缩、队列 pending、Command 派发、取消和
流式输出。不同 UI 用同一个布尔值判断不同语义，已经造成压缩重复占位、队列状态误判和消息
操作按钮延迟显示。本阶段让 UI 直接消费已有的 `sessionStatus`、`sessionActivity`、队列和
消息流状态；`isBusy` 不再作为 UI 的领域判断入口。

非目标：不修改 WebSocket 协议、Inbox 持久化、Agent Core 或后端 `is_busy()` 服务契约。

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：ChatView、ChatInput、ChatMessageList、RunContextPopover、UserMessage 及运行详情
  helper 不再读取 `isBusy`，分别使用执行、压缩、派发、队列、取消和流式状态。
- [x] FR2：`useIsStreaming` 必须依据 `messages[].streaming`，不得返回 busy 聚合值；取消按钮只由
  `canCancel` 或明确的 running fallback 控制。
- [x] FR3：压缩期间只展示压缩状态；有 pending 队列但没有 active Turn 时不伪装成 Agent 正在
  流式处理；历史消息操作和回滚规则保持原有业务语义。
- [x] FR4：从 Session Projection、Zustand Store、selector、测试夹具和文档实现中删除
  `isBusy` 字段与旧导出，不保留兼容镜像或 deprecated 尾巴。

### 2.2 非功能需求

- 状态来源唯一：后端生命周期使用 `sessionStatus`，活动细节使用 `sessionActivity`，队列使用
  `queueDepth/pendingMessages`，真实流式使用 `messages[].streaming`。
- 不通过时间戳、最后一条消息或 busy 猜测队列 placement。
- 不改变已验收的 Queue Operation Response 和 A/U/B 消息边界。

## 3. 技术方案

- `packages/renderer/src/stores/chat.ts`：增加精确状态选择器，删除 `isBusy` 聚合字段和旧导出。
- `packages/renderer/src/features/chat/`：把 `isBusy` 参数改成 `hasActiveTurn`、
  `hasPendingWork` 或 `canCancel` 等窄语义参数。
- `chatProjection.ts` 与 `clientSessionProjection.ts`：保持现有事件和状态字段，不再增加新的
  busy 推导分支。
- 测试覆盖 running、dispatching、compacting、pending-only、streaming、idle 五种组合。

## 4. 验收标准

- [x] AC1：renderer 源码和测试不再出现 `isBusy` 字段或旧 selector，`useIsStreaming` 能区分 streaming 与
  queue/compacting。
- [x] AC2：压缩状态不出现通用“处理中”，pending-only 不显示 active Turn 占位。
- [x] AC3：取消、回滚、文件变更摘要、运行详情和历史操作按钮的现有测试通过。
- [x] AC4：renderer 全量测试、TypeScript、Vite build 和 `git diff --check` 通过。

## 5. 测试计划

- selector：idle/running/compacting/dispatching/queue-only/streaming。
- UI：ChatInput、ChatMessageList、RunContextPopover、UserMessage。
- 回归：Queue Operation Response 乱序、Steering、A/U/B、压缩开始/结束。

## 6. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-25 | 新建 B6；将客户端运行状态从 `isBusy` 聚合值迁移到窄语义状态 | `isBusy` 混合队列、压缩、执行和流式状态，导致 UI 判断不准确 |
| 2026-08-25 | 完成 B6；删除 `isBusy` 字段、旧 selector 和全部测试夹具，新增窄语义 selector，迁移聊天 UI 和运行详情 | 用户明确要求不保留兼容尾巴，客户端状态必须由精确事实流表达 |
