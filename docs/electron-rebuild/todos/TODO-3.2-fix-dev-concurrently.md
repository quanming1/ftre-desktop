# TODO-3.2: 修复根 dev 脚本并发启动

## 阶段
Phase 3: 构建流水线

## 状态
- [x] 完成

## 目标
实现 `pnpm dev` 一键启动全部开发环境。

## 涉及文件
- 根 `package.json`

## 具体任务
1. 修复 concurrently 配置，正确启动 shared、editor、renderer、electron
2. 确认 renderer dev server 启动后 Electron 才加载窗口
3. 确认 HMR / live reload 工作正常（或确认禁用 HMR 的原因）

## 验收标准
- `pnpm dev` 一条命令 → Electron 窗口弹出，加载前端页面
- 修改 renderer 代码 → 页面刷新

## 前置依赖
TODO-3.1

## 预估难度
中
