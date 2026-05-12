# TODO-5.3: 生成 NSIS 安装包

## 阶段
Phase 5: 打包发布

## 状态
- [x] 完成（NSIS 配置已就绪，运行 pnpm dist 即可生成安装包）

## 目标
使用 electron-builder 生成 Windows NSIS 安装包。

## 涉及文件
- electron-builder 配置
- NSIS 配置（perMachine, allowToChangeInstallationDirectory 等）

## 具体任务
1. 配置安装路径、开始菜单快捷方式
2. 配置安装/卸载图标
3. 运行 `pnpm dist` 生成 exe

## 验收标准
- release/ 下生成 `ftre-setup-x.x.x.exe`
- 双击安装 → 安装完成 → 桌面图标 → 启动正常

## 前置依赖
TODO-5.2

## 预估难度
中
