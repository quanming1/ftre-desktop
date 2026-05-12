# SessionList 滚动问题 PRD

## 1. 问题概述

### 1.1 问题现象
切换 session 的时候，能明显看到滚动到最下面（闪现到最下面），scroll bottom 的时机有问题。

### 1.2 影响范围
- `packages/renderer/src/features/chat/MessageList.tsx`
- `packages/renderer/src/hooks/auto-scroll/useAutoScrollToBottom.ts`

## 2. 根因分析

### 2.1 时序问题

```
1. switchSession(sessionId) 被调用
2. sessionId 依赖变化 → useAutoScrollToBottom 重置 autoScrollLock = true
3. fetchSessionMessages 开始异步加载
4. replayInto 执行: session.messages = []  ← 清空消息
5. MutationObserver 检测到 DOM 清空 → 触发 scrollToBottom()
6. ⚠️ 此时 scrollHeight 很小 → 滚动到错误位置
7. 新消息添加 → MutationObserver 再次触发 → 滚动到正确位置
8. 闪现效果：从旧位置 → 错误底部 → 正确底部
```

### 2.2 关键问题点

1. **`useAutoScrollToBottom([sessionId])`** - 监听 `sessionId` 而非消息加载完成
2. **`replayInto` 清空消息的空档** - 导致 `scrollHeight` 先变小后变大
3. **多个滚动触发点竞争** - `useLayoutEffect` + MutationObserver + ResizeObserver

## 3. 修复方案

### 3.1 方案 A：在 replayInto 开始时临时禁用滚动（推荐）

在 `useAutoScrollToBottom` 中添加一个暂停机制：

1. 添加 `pauseScroll` 和 `resumeScroll` 回调
2. 在 `pauseScroll` 时设置 `pauseScrollRef.current = true`
3. 在 `resumeScroll` 时设置 `pauseScrollRef.current = false` 并调用 `scrollToBottom`
4. 在 `MessageList` 中监听消息加载完成后再触发滚动

### 3.2 方案 B：改用消息数量变化而非 sessionId 变化

用消息数量作为 deps，而不是 sessionId，避免在数据加载过程中的多次触发。

### 3.3 方案 C：在 MutationObserver 中检测有意义的 DOM 变化

忽略"清空"操作，只在"添加内容"时滚动。

## 4. 验收标准

| ID | 检查项 | 验证方式 |
|----|--------|----------|
| VSC-1 | 切换 session 时不再出现闪现效果 | 手动切换多次 |
| VSC-2 | 滚动位置始终保持在底部 | 切换后目视检查 |
| VSC-3 | 流式输出时滚动正常 | 发送长消息观察 |
| VSC-4 | 快速切换不产生抖动 | 快速切换多个 session |
