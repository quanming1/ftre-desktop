# TODO-2.4: 修复终端 IPC (node-pty)

## 阶段
Phase 2: IPC 通道恢复

## 状态
- [x] 完成

## 目标
修复终端 IPC，恢复集成终端功能。

## 涉及文件
- `packages/electron/src/ipc/terminal.ts`
- `packages/renderer/src/features/terminal/TerminalManager.tsx`
- `packages/renderer/src/features/terminal/TerminalPane.tsx`

## 具体任务
1. 确认 node-pty 能正常 import（可能需要 native rebuild）
2. 确认 `pty:create` 创建 shell 进程
3. 确认 `pty:write` 写入数据、`pty:data` push 输出
4. 确认 `pty:resize` 调整终端尺寸

## 验收标准
- 底部终端面板打开 → 显示 shell prompt
- 输入命令 → 看到输出
- 窗口缩放 → 终端自适应

## 前置依赖
TODO-2.3

## 预估难度
高（node-pty native module 可能需要 electron-rebuild）
