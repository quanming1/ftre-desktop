# TODO-1.1: 修复 Electron main.ts 入口

## 阶段
Phase 1: 基础骨架

## 状态
- [x] 完成

## 目标
修复 Electron 主进程入口，确保 app ready → createWindow 流程正常。

## 涉及文件
- `packages/electron/src/main.ts`
- `packages/electron/tsconfig.json`

## 具体任务
1. 检查 `main.ts` 中 `app.whenReady()` → `createWindow()` 调用链
2. 确认 GPU 加速标志、安全策略等配置无误
3. 确认 IPC handler 注册入口被正确调用
4. 修复 Python backend 相关代码 — 改为可选（外连模式不需要）

## 验收标准
- `tsc` 编译 electron 包零错误
- `electron packages/electron/dist/main.js` 弹出空窗口（即使 renderer 未启动也不崩溃）

## 前置依赖
无

## 预估难度
低
