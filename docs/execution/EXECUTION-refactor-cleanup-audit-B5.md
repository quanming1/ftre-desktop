# B5 Refactor Cleanup Audit 执行报告

## 范围

- 仓库：`E:\binn\ftre-desktop`
- 分支：`feature/B4-steering-message-projection`
- 模块：renderer WebSocket/Queue Projection、workspace test/build 入口、B5 文档
- 未修改：Electron 业务主进程、Agent Core、ftre 后端源码

## Owner 与残留清理

- Queue Operation Response 的唯一消费入口是 `websocket-client.ts` → `chat.ts` →
  `ClientSessionProjection`；没有独立 Message ACK parser 或本地 Steering 状态 Owner。
- `revision` 是服务端队列事实顺序；缺失 revision 的旧 Queue 帧直接丢弃。
- `QueuedMessagesBanner` 只发起操作，不猜测 placement；成功状态由服务端快照投影。
- 当前 `AGENTS.md` 已从旧 `{ok,value}` admission ACK 更新为 `session/queue` Queue Operation Response。

## 工程卫生修复

清洁 renderer 工作树时发现 workspace package 的 `@ftre/ui/dist` 未生成会导致测试入口失败。
已将 renderer `test` script 改为先构建 `@ftre/shared` 和 `@ftre/ui`，再运行 Vitest；这样不依赖
开发者机器上残留的历史 dist 文件。

## 验证

```text
pnpm test
→ 52 files / 517 renderer tests passed
→ 10 platform tests passed
pnpm exec tsc -p packages/renderer/tsconfig.json --noEmit
→ passed
pnpm --filter @ftre/renderer build
→ passed（仅既有 CSS/chunk size 警告）
git diff --check
→ passed
```

## 工作树

本次审计未执行 commit、push、merge；F22/B3/B4/B5 的既有及当前修改保留在工作树中。
