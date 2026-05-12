# TODO-2.6: 修复文件搜索 IPC

## 阶段
Phase 2: IPC 通道恢复

## 状态
- [x] 完成

## 目标
修复 Worker Thread 文件搜索。

## 涉及文件
- `packages/electron/src/ipc/search.ts`
- `packages/electron/src/workers/search.ts`
- `packages/electron/src/ipc/worker-manager.ts`

## 具体任务
1. 确认 worker-manager 能正确创建 worker thread
2. 确认 `fs:search` 委托给 worker 并返回结果
3. 确认大目录搜索不阻塞主进程

## 验收标准
- 全局搜索面板输入关键词 → 返回文件名和行号

## 前置依赖
TODO-2.5

## 预估难度
中
