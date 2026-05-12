# TODO-4.3: IPC 功能离线可用

## 阶段
Phase 4: 连接层增强

## 状态
- [x] 完成

## 目标
确认 WS 断连时所有 IPC 原生功能（文件/Git/终端/编辑器）正常工作。

## 涉及文件
- `packages/renderer/src/` 各 feature 组件
- `packages/renderer/src/services/api.ts`

## 具体任务
1. 审查所有 window.desktop 调用，确认不依赖 WS 连接
2. 确认 api.ts 中 stub 的 HTTP 函数在 WS 断连时不阻塞 UI
3. Chat 功能在断连时显示提示，其余功能正常

## 验收标准
- 不启动 gateway → 文件树/编辑器/Git/终端 全部正常
- 仅 Chat 面板显示 "未连接"

## 前置依赖
TODO-4.2

## 预估难度
低
