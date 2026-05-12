# TODO-2.8: 修复内存监控 IPC

## 阶段
Phase 2: IPC 通道恢复

## 状态
- [x] 完成

## 目标
修复内存监控数据获取。

## 涉及文件
- `packages/electron/src/ipc/memory.ts`
- `packages/renderer/src/features/memory/MemoryMonitorPanel.tsx`

## 具体任务
1. 确认 `memory:getUsage` 返回 process.memoryUsage + app.getAppMetrics 数据
2. 确认 renderer 侧轮询和展示正常

## 验收标准
- 内存监控面板显示 RSS、Heap Used 等数据

## 前置依赖
TODO-2.7

## 预估难度
低
