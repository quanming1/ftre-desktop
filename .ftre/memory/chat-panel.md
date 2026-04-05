# Chat 面板

> AI 对话界面，包含消息列表和输入框（Session 管理已独立为顶层面板）

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/features/chat/ChatPanel.tsx` | 纯聊天面板，仅包含 MessageList + ChatInput |
| `packages/renderer/src/features/chat/MessageList.tsx` | 消息列表展示，包含消息分组和 AI turn start 渲染 |
| `packages/renderer/src/features/chat/ChatInput.tsx` | 输入框组件 |
| `packages/renderer/src/features/chat/UserMessage.tsx` | 用户消息渲染，处理多种 part 类型（text、code_ref、email、archive_ref） |
| `packages/renderer/src/features/chat/AssistantMessage.tsx` | AI 消息渲染（Markdown） |
| `packages/renderer/src/components/PixelLogo.tsx` | 像素风格 Logo 组件 |
| `packages/renderer/src/stores/session.ts` | Session store，管理会话状态 |
| `packages/renderer/src/services/api.ts` | SessionSummary 接口定义 |

## 消息渲染流程

### 渲染单元类型
`MessageList.tsx` 将消息流转换为渲染单元（RenderUnit）：

| 类型 | 说明 |
|------|------|
| `single` | 单条消息 |
| `group` | 连续同类型工具调用分组 |
| `diff_summary` | Diff 摘要卡片 |
| `ai_turn_start` | **每轮 AI 回复开始标记**（显示 PixelLogo） |

### AI 品牌标识显示规则
- **位置**：每轮对话（turn）中，user 消息之后、第一个 AI 内容（tool call 或 assistant）之前
- **组件**：`<PixelLogo size={2} />`
- **样式**：`mt-4 mb-1`（与 user 消息拉开距离）
- **频率**：每轮只显示一次

### 消息流转
```
user message → [ai_turn_start → PixelLogo] → tool calls / assistant message
```

## 消息 Part 协议

用户消息（UserMessage）支持多种 part 类型渲染：

| Part 类型 | 组件 | 说明 |
|-----------|------|------|
| `text` | 纯文本 | 普通文本段落 |
| `code_ref` | CodeChip | 代码引用，点击跳转文件 |
| `email` | EmailCard | 邮件消息卡片 |
| `archive_ref` | ArchiveChip | **归档引用**，紫色背景 + 📦 图标 |

### archive_ref 数据结构
```typescript
interface ArchiveRefData {
  id: string;
  display: string;  // label || summary，用于展示
}
```

**注意**：输入框（Slate 编辑器）中的归档引用和消息渲染的归档引用数据结构不同。输入框使用 `ArchiveChipElement`（包含完整归档信息），而消息渲染使用简化的 `ArchiveRefData`。

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

- **2024-xx**: 消息显示优化
  - 移除 user 消息的 "你" 标签
  - 新增 `ai_turn_start` 渲染单元，在每轮 AI 回复开始时显示 PixelLogo
