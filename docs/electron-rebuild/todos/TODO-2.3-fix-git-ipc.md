# TODO-2.3: 修复 Git IPC

## 阶段
Phase 2: IPC 通道恢复

## 状态
- [x] 完成

## 目标
修复 Git 相关 IPC 通道，恢复 Git 状态显示和操作。

## 涉及文件
- `packages/electron/src/ipc/git.ts`
- `packages/renderer/src/services/git-service.ts`
- `packages/renderer/src/features/explorer/GitChangesView.tsx`

## 具体任务
1. 确认 `git:info` 返回仓库信息（分支名、remote 等）
2. 确认 `git:status` 返回文件变更状态
3. 确认 `git:stage` / `git:unstage` / `git:commit` 操作正常
4. 确认 `git:diff-file` / `git:show` 返回 diff 内容

## 验收标准
- 侧栏 Git Changes 面板显示变更文件列表
- 标题栏显示当前分支名
- 可以暂存、提交

## 前置依赖
TODO-2.2

## 预估难度
中
