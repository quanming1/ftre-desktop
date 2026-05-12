# TODO-1.4: 修复 dev 启动脚本端口不一致

## 阶段
Phase 1: 基础骨架

## 状态
- [x] 完成

## 目标
修复根 package.json 的 dev 脚本，使 Electron 正确等待 Vite dev server 启动后再打开窗口。

## 涉及文件
- 根 `package.json` (scripts.dev)

## 具体任务
1. 将 `wait-on http://localhost:5173` 改为 `wait-on http://127.0.0.1:50000`
2. 确认 concurrently 启动顺序: shared → editor → (renderer + electron 并发)
3. 确认 Electron 启动命令路径正确

## 验收标准
- `pnpm dev` 一键启动
- Vite 启动后 Electron 窗口自动弹出并加载页面

## 前置依赖
TODO-1.3

## 预估难度
低
