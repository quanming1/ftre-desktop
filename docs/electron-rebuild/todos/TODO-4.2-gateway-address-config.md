# TODO-4.2: Gateway 地址可配置

## 阶段
Phase 4: 连接层增强

## 状态
- [x] 完成

## 目标
支持在设置面板中配置 gateway WebSocket 地址。

## 涉及文件
- `packages/renderer/src/services/websocket-client.ts`
- `packages/renderer/src/features/settings/SettingsPanel.tsx`
- `packages/electron/src/ipc/store.ts` (持久化)

## 具体任务
1. 设置面板新增 "Gateway 地址" 输入框，默认 ws://127.0.0.1:18790/
2. 修改后保存到 store 并触发 WS 重连
3. 重启后从 store 读取地址

## 验收标准
- 修改地址 → WS 断开旧连接 → 连接新地址
- 重启 app → 使用保存的地址

## 前置依赖
TODO-4.1

## 预估难度
低
