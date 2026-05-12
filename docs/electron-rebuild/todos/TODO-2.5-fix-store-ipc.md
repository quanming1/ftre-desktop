# TODO-2.5: 修复 Store IPC

## 阶段
Phase 2: IPC 通道恢复

## 状态
- [x] 完成

## 目标
修复持久化存储 IPC，恢复应用状态保存。

## 涉及文件
- `packages/electron/src/ipc/store.ts`
- `packages/renderer/src/stores/workspace.ts`

## 具体任务
1. 确认 `store:get` / `store:set` 读写 `userData/ftre-state.json`
2. 确认 workspace 路径、窗口状态等能正确持久化

## 验收标准
- 打开工作区 → 关闭 app → 重新打开 → 自动恢复上次工作区

## 前置依赖
TODO-2.4

## 预估难度
低
