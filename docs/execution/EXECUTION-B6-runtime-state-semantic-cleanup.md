# B6 客户端运行状态语义收敛执行记录

## 范围

- 仓库：`E:\binn\ftre-desktop`
- 阶段：B6
- 分支：`develop`（遵循当前用户指令，未提交）
- 不修改 WebSocket 协议、Inbox、Agent Core 或 Electron 主进程。

## 实现

1. 新增 `stores/runtimeState.ts`，集中定义 `hasPendingWork`、`hasActiveTurn`、
   `hasRuntimeActivity` 和 `hasStreamingAssistant` 四类窄语义判断。
2. ChatView、ChatInput、ChatMessageList、RunContextPopover、UserMessage 和运行详情 helper
   不再把 `isBusy` 当作业务判断入口。
3. `useIsStreaming` 改为读取 Assistant 消息的 `streaming` 标记；取消按钮使用 `canCancel`，
   回滚使用 idle + 空队列条件。
4. 从 Session Projection、Zustand Store、selector 和测试夹具中删除 `isBusy`，不保留兼容镜像。

## 验证

- renderer：`pnpm --filter @ftre/renderer test` → 534 passed
- 类型：`pnpm --filter @ftre/renderer exec tsc --noEmit` → 通过
- diff：`git diff --check` → 通过

## 影响

- pending-only 不再渲染普通 Agent 处理中占位。
- compacting 继续由专用压缩状态控制，不与普通 streaming 混用。
- Queue Operation Response、Steering、A/U/B 和客户端消息协议不变。
