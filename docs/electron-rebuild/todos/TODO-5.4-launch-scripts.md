# TODO-5.4: 桌面快捷方式 + Gateway 启动脚本

> 历史 TODO，当前由 E1 接管。发布客户端自动启动安装包内 Gateway，不要求
> 用户单独安装或启动外部 ai-base gateway；当前实现见 `scripts/start-gateway.*`
> 和 `packages/electron/src/backend.ts`。

## 阶段
Phase 5: 打包发布

## 状态
- [x] 历史阶段完成（已被 E1 跨平台实现取代）

## 目标
为用户提供方便的启动方式。

## 涉及文件
- 新增: gateway 启动 bat 脚本
- NSIS 配置（可选）

## 具体任务
1. 附带 `start-gateway.bat`（启动安装包内的 ftre Gateway）
2. 安装后桌面创建 ftre 快捷方式
3. 可选: README 说明先启动 gateway 再启动 app

## 验收标准
- 用户运行 start-gateway.bat → 内置 ftre Gateway 启动
- 双击桌面 ftre 图标 → app 启动并连接 gateway

## 前置依赖
TODO-5.3

## 预估难度
低
