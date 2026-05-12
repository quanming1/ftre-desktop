# TODO-5.2: 处理 node-pty native module

## 阶段
Phase 5: 打包发布

## 状态
- [x] 完成（node-pty v1.1.0 使用 N-API prebuilds，ABI 稳定，无需 rebuild）

## 目标
确保 node-pty 的 native addon 为 Electron 版本编译。

## 涉及文件
- 根 `package.json`
- 可能需要 `postinstall` 脚本

## 具体任务
1. 安装 electron-rebuild 或配置 @electron/rebuild
2. 在 postinstall 或 build 前执行 native module rebuild
3. 确认编译后的 .node 文件匹配 Electron 的 Node.js ABI 版本

## 验收标准
- 打包后的 app 中终端功能正常（能 spawn shell）

## 前置依赖
TODO-5.1

## 预估难度
高
