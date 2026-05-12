# TODO-2.7: 修复文件监听 IPC

## 阶段
Phase 2: IPC 通道恢复

## 状态
- [x] 完成

## 目标
修复文件系统变更监听，恢复实时刷新。

## 涉及文件
- `packages/electron/src/ipc/watcher.ts`
- `packages/renderer/src/app/Workbench.tsx` (watcher setup)

## 具体任务
1. 确认 `fs:watch` 启动递归监听
2. 确认 `fs:fileChanged` push 事件正确推送到 renderer
3. 确认 `fs:unwatch` 清理资源

## 验收标准
- 外部编辑器修改文件 → 前端文件树自动刷新
- 新建/删除文件 → 文件树实时更新

## 前置依赖
TODO-2.6

## 预估难度
低
