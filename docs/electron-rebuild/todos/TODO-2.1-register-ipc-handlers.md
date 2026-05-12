# TODO-2.1: 注册所有 IPC handlers

## 阶段
Phase 2: IPC 通道恢复

## 状态
- [x] 完成

## 目标
确认 main.ts 中所有 IPC handler 注册函数被正确调用。

## 涉及文件
- `packages/electron/src/main.ts`
- `packages/electron/src/ipc/*.ts`

## 具体任务
1. 检查 main.ts 中 registerFsHandlers, registerGitHandlers, registerTerminalHandlers 等调用
2. 确认每个 handler 模块导出的注册函数签名正确
3. 确认 ipcMain.handle / ipcMain.on 注册无冲突

## 验收标准
- Electron 主进程启动，控制台无 IPC 注册相关错误
- 所有 channel name 与 preload.ts 中 invoke/on 匹配

## 前置依赖
TODO-1.4

## 预估难度
低
