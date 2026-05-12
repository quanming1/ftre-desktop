# TODO-4.1: Gateway 连接状态 UI

## 阶段
Phase 4: 连接层增强

## 状态
- [x] 完成

## 目标
WS 断连时在 UI 显示明确提示，而非白屏或静默失败。

## 涉及文件
- `packages/renderer/src/services/websocket-client.ts`
- `packages/renderer/src/stores/chat.ts`
- 新增: 连接状态提示组件

## 具体任务
1. 在 StatusBar 或 ChatPanel 显示 WS 连接状态（已连接/断开/重连中）
2. 断连时显示提示: "未连接 AI 后端，请启动 ai-base gateway"
3. 手动重连按钮

## 验收标准
- 不启动 gateway → 打开 app → 看到断连提示
- 启动 gateway → 提示消失，可正常对话

## 前置依赖
TODO-3.3

## 预估难度
中
