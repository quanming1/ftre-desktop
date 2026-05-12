# TODO-5.1: 修复 electron-builder 配置

## 阶段
Phase 5: 打包发布

## 状态
- [x] 完成

## 目标
修复 electron-builder 配置，使 `pnpm pack:quick` 能打出未压缩包。

## 涉及文件
- 根 `package.json` 的 `build` 字段
- `electron-builder-full.json`（如需）

## 具体任务
1. 确认 files 数组包含 electron/dist, renderer/dist, shared/dist
2. 确认 asarUnpack 包含 node-pty
3. 确认 extraResources 不包含 Python backend（外连模式不需要）
4. 测试 --dir 模式输出

## 验收标准
- `pnpm pack:quick` → release/ 下生成 unpacked 目录
- 直接运行 unpacked/ftre.exe → app 正常启动

## 前置依赖
TODO-4.3

## 预估难度
中
