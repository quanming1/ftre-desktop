# Chat 面板

> AI 对话界面，包含消息列表和输入框（Session 管理已独立为顶层面板）

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/features/chat/ChatPanel.tsx` | 纯聊天面板，仅包含 MessageList + ChatInput |
| `packages/renderer/src/features/chat/MessageList.tsx` | 消息列表展示 |
| `packages/renderer/src/features/chat/ChatInput.tsx` | 输入框组件 |
| `packages/renderer/src/stores/session.ts` | Session store，管理会话状态 |
| `packages/renderer/src/services/api.ts` | SessionSummary 接口定义 |

## 布局结构

ChatPanel 现在是一个纯聊天面板：

```
┌─────────────────────────────┐
│                             │
│      MessageList            │
│                             │
│                             │
├─────────────────────────────┤
│         ChatInput           │
└─────────────────────────────┘
```

Session 管理功能已拆分到独立的 `SessionPanel`，详见 [session-panel.md](./session-panel.md)。

## 历史变更

- **2024-xx**: SessionSidebar 从 ChatPanel 内部组件提升为独立顶层面板（sessions）
  - 四模块布局：`sessions` | `sidebar` | `editor` | `chat`
  - ChatPanel 回归纯聊天功能
