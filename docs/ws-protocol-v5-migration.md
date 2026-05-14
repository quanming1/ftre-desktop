# WebSocket 协议 v4 → v5 迁移记录

## 概述

本次迁移将前端 WebSocket 协议从 v4 升级到 v5，主要变化是服务端下行消息格式从 `{id, type, data}` 改为 `{id, role, data, metadata?}`。

## 核心变化

| v4 | v5 | 说明 |
|---|---|---|
| `frame.type` | `msg.role` | 消息类型字段名变更 |
| `text.delta` | `assistant.delta` | 流式文本消息 |
| `text.done` | `assistant` | 完整助手消息 |
| `tool.start` + `tool.done` | `tool_call` | 工具调用（合并） |
| `tool.error` | `tool_result` | 工具结果（通过 `data.error` 判断成功/失败） |
| `data.message_id` | `msg.id` | 消息 ID 位置变更 |
| `tool_call.arguments` (JSON string) | `tool_call.arguments` (object) | 参数已解析，无需 `JSON.parse()` |
| 各种控制帧 | `role: "control"` + `data.event` | 统一为控制帧 |
| `session.ready` 的 `data.chat_id` | `data.chat_id` | chat_id 仍在 data 中 |

## 修改的文件

### 1. `packages/renderer/src/services/ws-protocol.ts`

**主要变更：**
- 新增 `ServerMessage<R, D>` 接口（替代 `Frame`）
- 新增 `ServerRole` 类型
- 新增 v5 数据类型：
  - `AssistantDeltaData`
  - `AssistantData`
  - `ToolCallData`（`arguments` 已是 object）
  - `ToolResultData`（通过 `error` 字段判断成功/失败）
  - `ControlData`（`event` 字段区分事件类型）
- 新增 `isServerMessage()` 替代 `isServerFrame()`
- 新增控制帧辅助函数：`isControlEvent()`, `isTurnStart()`, `isTurnEnd()`, `isSessionReady()`, `isError()`
- 保留所有 v4 类型作为 `@deprecated` 向后兼容

### 2. `packages/renderer/src/services/websocket-client.ts`

**主要变更：**
- 更新 `handleFrame()` → `handleMessage()`
- 使用 `isServerMessage()` 验证消息格式
- 控制帧处理：`role === "control"` + `data.event`
- `session.ready` 的 `chat_id` 从 `data` 获取
- 保留 `onFrame()` 作为 `@deprecated` 别名

### 3. `packages/renderer/src/services/ws-stream-manager.ts`

**主要变更：**
- `switch(frame.type)` → `switch(msg.role)`
- 控制帧处理：先检查 `role === "control"`，再根据 `data.event` 分发
- `handleTextDelta()` 使用 `msgId` 参数（来自 `msg.id`）
- `handleTextDone()` 使用 `msgId` 参数
- 新增 `handleToolCall()` 合并原 `handleToolStart/Delta/Done`
- 新增 `handleToolResult()` 合并原 `handleToolDone/Error`
- `handleSessionReady()` 从 `data` 获取 `chat_id`
- 删除旧方法：`handleToolStart`, `handleToolDelta`, `handleToolDone`, `handleToolError`, `handleMessage`, `parseToolCalls`

### 4. `packages/renderer/src/services/api.ts`

**主要变更：**
- 新增 `SessionMessage` 接口（v5 格式：`{id, role, data}`）
- `fetchSessionMessages()` 返回类型更新为 `SessionMessage[]`
- 添加注释说明 v5 响应格式

### 5. `packages/renderer/src/stores/session.ts`

**主要变更：**
- 更新 `convertHistoryMessages()` 函数支持 v5 格式
- 支持 `tool_call` 和 `tool_result` 作为独立消息
- 保持向后兼容，同时支持旧格式

## 向后兼容

所有 v4 类型和函数都作为 `@deprecated` 别名保留，确保：
- 现有代码仍可编译
- IDE 会显示废弃警告
- 未来可逐步清理

## 测试建议

1. **连接测试**：确认 WebSocket 连接正常
2. **消息流测试**：
   - 发送用户消息，确认收到 `assistant.delta` 和 `assistant`
   - 确认工具调用收到 `tool_call` 和 `tool_result`
   - 确认错误情况下 `tool_result.data.error` 存在
3. **历史消息测试**：切换会话，确认历史消息正确加载
4. **控制帧测试**：确认 `turn.start`/`turn.end` 正确处理

## 注意事项

1. `tool_call.arguments` 现在直接是 object，代码中使用 `JSON.stringify()` 转为字符串存储
2. `session.ready` 的 `chat_id` 在 `data` 中（与其他控制帧一致）
3. 错误判断：检查 `tool_result.data.error` 字段是否存在
