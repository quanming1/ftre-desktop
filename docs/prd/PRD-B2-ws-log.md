# PRD-B2-WS Log 审计日志

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | B2 |
| 名称 | WS Log 审计日志 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-12 |
| 定稿日期 | 2026-08-12 |
| 验收日期 | 2026-08-12 |
| 关联文档 | docs/TODO.yaml 阶段 B2；AGENTS.md |

## 1. 背景与目标

- **背景**：WS 协议联调与问题排查需要完整的通信审计日志（收发帧、系统事件、连接 attempt 信息）。
- **目标**：采集 WebSocket 通信帧并持久化为可查询的日志，在 Inspector 面板提供 WS Logs 查看 tab。
- **非目标**：不做日志加密与合规审计；不做日志级别过滤规则配置。

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：ws-log IPC（追加 / 查询 / 统计 / 清空 / 打开日志目录）
- [x] FR2：ws-log-collector 采集 in / out / system 三类帧
- [x] FR3：WsLogInspectorPanel Inspector 固定 tab（列表 / 详情 / 筛选）
- [x] FR4：attempt 标记（initial / retry / outbox_flush / reconnect_replay）标识连接尝试类型

### 2.2 非功能需求

- 性能：高频帧采集不阻塞主进程，日志写入异步
- 可靠性：日志文件持久化，可跨重启查看
- 兼容性：日志格式稳定，便于外部工具解析

## 3. 技术方案

- 模块设计：
  - `packages/electron/src/ipc/ws-log.ts`：主进程 IPC handler（追加 / 查询 / 统计 / 清空 / 打开目录）
  - `packages/renderer/src/services/ws-log-collector.ts`：渲染进程帧采集器（in / out / system）
  - `packages/renderer/src/features/inspector/WsLogInspectorPanel.tsx`：日志查看面板
- 关键数据结构：ws-log entry（timestamp / direction / attempt / type / payload）
- 存储：文件追加写（按日滚动），主进程持有写入句柄

## 4. 接口定义

- IPC：`ws-log:append` / `ws-log:query` / `ws-log:stats` / `ws-log:clear` / `ws-log:openDir`
- 采集器在 WS 客户端收发帧时挂载钩子，统一打 attempt 标记

## 5. 验收标准

- [x] AC1：WS 帧（in / out / system）被正确采集并持久化
- [x] AC2：Inspector WS Logs tab 可查询、筛选、查看帧详情
- [x] AC3：日志文件落盘，重启后可继续查看

## 6. 测试计划

- 手动验证：建立会话产生流量后检查日志内容与 attempt 标记

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-12 | 初始定稿 | — |
