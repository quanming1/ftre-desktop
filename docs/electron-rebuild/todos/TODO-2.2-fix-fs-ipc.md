# TODO-2.2: 修复文件系统 IPC

## 阶段
Phase 2: IPC 通道恢复

## 状态
- [x] 完成

## 目标
修复文件系统相关 IPC 通道，恢复文件树浏览、文件读写能力。

## 涉及文件
- `packages/electron/src/ipc/fs.ts`
- `packages/renderer/src/stores/workspace.ts`
- `packages/renderer/src/features/explorer/ExplorerView.tsx`

## 具体任务
1. 确认 `fs:readDir` 返回正确的 FileEntry 数组
2. 确认 `fs:readFile` / `fs:writeFile` 正常工作
3. 确认 `fs:selectFolder` 打开系统文件夹选择对话框
4. 确认 `fs:createFile` / `fs:createFolder` / `fs:rename` / `fs:delete` 正常

## 验收标准
- 前端打开文件夹 → 文件树正确显示
- 点击文件 → 编辑器打开文件内容
- 保存文件 → 文件内容写入磁盘

## 前置依赖
TODO-2.1

## 预估难度
中
