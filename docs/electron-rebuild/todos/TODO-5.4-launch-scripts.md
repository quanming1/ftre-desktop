# TODO-5.4: 桌面快捷方式 + Gateway 启动脚本

## 阶段
Phase 5: 打包发布

## 状态
- [x] 完成

## 目标
为用户提供方便的启动方式。

## 涉及文件
- 新增: gateway 启动 bat 脚本
- NSIS 配置（可选）

## 具体任务
1. 附带 `start-gateway.bat`（启动 ai-base gateway）
2. 安装后桌面创建 ftre 快捷方式
3. 可选: README 说明先启动 gateway 再启动 app

## 验收标准
- 用户运行 start-gateway.bat → gateway 启动
- 双击桌面 ftre 图标 → app 启动并连接 gateway

## 前置依赖
TODO-5.3

## 预估难度
低
