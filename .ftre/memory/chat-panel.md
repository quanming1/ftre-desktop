# Chat 面板

> AI 对话界面，包含消息列表和输入框（Session 管理已独立为顶层面板）

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/features/chat/ChatPanel.tsx` | 纯聊天面板，仅包含 MessageList + ChatInput |
| `packages/renderer/src/features/chat/MessageList.tsx` | 消息列表展示，包含消息分组和 AI turn start 渲染 |
| `packages/renderer/src/features/chat/ChatInput.tsx` | 输入框组件，支持拖拽 archive_ref |
| `packages/renderer/src/features/chat/UserMessage.tsx` | 用户消息渲染 + rollback/branch 操作按钮 |
| `packages/renderer/src/features/chat/RollbackConfirmDialog.tsx` | 回滚确认对话框，支持分支选项 |
| `packages/renderer/src/features/chat/AssistantMessage.tsx` | AI 消息渲染（Markdown） |
| `packages/renderer/src/features/chat/slate/ChatInputEditor.ts` | Slate 编辑器，处理拖拽插入 |
| `packages/renderer/src/components/PixelLogo.tsx` | 像素风格 Logo 组件 |
| `packages/renderer/src/stores/session.ts` | Session store，管理会话状态 |
| `packages/renderer/src/services/api.ts` | rollbackSession / branchSession API |
| `packages/renderer/src/services/stream-manager.ts` | 流管理器，支持回滚和分支 |

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

## Rollback 功能（回滚与分支）

### 核心概念
- **回滚（Rollback）**：将会话状态重置到某条用户消息之前，丢弃后续所有消息
- **分支（Branch）**：基于当前会话创建新分支，保留原会话不变

### 业务流程

```
UserMessage:hover 显示按钮 → 点击 rollback → RollbackConfirmDialog
                                           ↓
                              选择「回滚」或「创建分支」
                                           ↓
                    ┌──────────────────────┴──────────────────────┐
                    ↓                                             ↓
            api.rollbackSession(sessionId, messageId)    api.branchSession(sessionId, messageId)
                    ↓                                             ↓
            streamManager.rollback(sessionId)           切换到新 session
                    ↓
            刷新消息列表，定位到回滚点
```

### API 接口
```typescript
// packages/renderer/src/services/api.ts
api.rollbackSession(sessionId: string, messageId: string): Promise<void>
api.branchSession(sessionId: string, messageId: string): Promise<{ session_id: string }>
```

### UI 交互
- **触发位置**：`UserMessage.tsx` hover 时显示 rollback/branch 按钮
- **确认对话框**：`RollbackConfirmDialog.tsx`
  - 默认选项：「创建分支」（保留原会话）
  - 危险选项：「回滚」（红色警告，不可逆）
- **分支结果**：创建新会话并自动切换

### 注意事项
- 回滚操作不可逆，需二次确认
- 分支是新会话，原会话保持不变
- 回滚后需要调用 `streamManager.rollback()` 清理流状态

## 拖拽 Archive Ref 到输入框

### 功能说明
支持将归档引用（archive_ref）从外部拖拽到输入框，自动插入为可编辑元素。

### 实现路径

```
外部拖拽源 → ChatInput.tsx (onDrop)
                    ↓
          ChatInputEditor.insertArchiveRef(archiveData)
                    ↓
          Slate 编辑器插入 ArchiveChipElement
```

### 核心代码
```typescript
// ChatInputEditor.ts
insertArchiveRef(editor: Editor, archive: ArchiveRefData): void {
  // 插入 inline void 元素，包含归档信息
}
```

### 数据结构
输入框中的归档引用使用 `ArchiveChipElement`（Slate inline void 元素），与消息渲染的 `ArchiveRefData` 结构不同。

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

- **2024-xx**: 新增 Rollback 功能
  - UserMessage 添加 rollback/branch 按钮
  - RollbackConfirmDialog 确认对话框
  - api.ts 新增 rollbackSession/branchSession 接口
  - stream-manager.ts 支持回滚状态清理

- **2024-xx**: 输入框支持拖拽
  - ChatInput 支持 onDrop 事件
  - ChatInputEditor.insertArchiveRef 方法

- **2024-xx**: SessionSidebar 从 ChatPanel 内部组件提升为独立顶层面板（sessions）
  - 四模块布局：`sessions` | `sidebar` | `editor` | `chat`
  - ChatPanel 回归纯聊天功能

- **2024-xx**: 消息显示优化
  - 移除 user 消息的 "你" 标签
  - 新增 `ai_turn_start` 渲染单元，在每轮 AI 回复开始时显示 PixelLogo
