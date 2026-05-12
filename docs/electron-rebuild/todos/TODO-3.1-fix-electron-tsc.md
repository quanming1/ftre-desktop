# TODO-3.1: 修复 @ftre/electron 的 tsc 编译

## 阶段
Phase 3: 构建流水线

## 状态
- [x] 完成

## 目标
确保 Electron 主进程代码能正确编译为 JS。

## 涉及文件
- `packages/electron/tsconfig.json`
- `packages/electron/package.json`

## 具体任务
1. 检查 tsconfig.json 的 target/module/outDir 配置
2. 确认输出为 CommonJS（Electron 主进程需要）
3. 确认 `pnpm build` 输出 `dist/main.js` 和 `dist/preload.js`

## 验收标准
- `cd packages/electron && pnpm build` 零错误
- `dist/` 目录包含 main.js, preload.js 及 ipc/ workers/ 子目录

## 前置依赖
TODO-2.8

## 预估难度
低
