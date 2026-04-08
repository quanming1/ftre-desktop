# Chat 面板

> AI 对话界面，包含消息列表和输入框（Session 管理已独立为顶层面板）

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/features/chat/ChatPanel.tsx` | 纯聊天面板，仅包含 MessageList + ChatInput |
| `packages/renderer/src/features/chat/MessageList.tsx` | 消息列表展示，包含消息分组和 AI turn start 渲染 |
| `packages/renderer/src/features/chat/ChatInput.tsx` | 输入框组件，支持拖拽 archive_ref |
| `packages/renderer/src/features/chat/UserMessage.tsx` | 用户消息渲染 + 操作按钮（复制/回滚/Fork） |
| `packages/renderer/src/features/chat/RollbackConfirmDialog.tsx` | 回滚确认对话框，支持分支选项 |
| `packages/renderer/src/features/chat/AssistantMessage.tsx` | AI 消息渲染（Markdown） |
| `packages/renderer/src/features/chat/slate/ChatInputEditor.ts` | Slate 编辑器，处理 archive-chip 插入 |
| `packages/renderer/src/features/chat/slate/elements/ArchiveChipView.tsx` | Slate 内联归档 Chip 渲染 |
| `packages/renderer/src/components/PixelLogo.tsx` | 像素风格 Logo 组件 |
| `packages/renderer/src/stores/session.ts` | Session store，管理会话状态 |
| `packages/renderer/src/stores/chat.ts` | Chat store，UI 层数据源 |
| `packages/renderer/src/services/api.ts` | rollbackSession / branchSession / fetchArchiveDetail API |
| `packages/renderer/src/services/stream-manager.ts` | 流管理器，管理 StreamSession 生命周期 |
| `packages/renderer/src/services/global-event-stream.ts` | 全局 SSE 连接，接收所有 session 的事件 |
| `packages/renderer/src/types/chat.ts` | ChatMessage 等类型定义 |

## 流式处理架构

```
后端 (chat.py / dispatcher)
       ↓ SSE 推送
GlobalEventStream (global-event-stream.ts)
       ↓ 按 session_id 分发
StreamSession (stream-manager.ts，每 session 一个实例)
       ↓ 更新 messages 数组
       ↓ 如果是 active session，调用 onChanged 回调
useChat store (chat.ts)
       ↓ syncFrom() 更新 UI 数据
React UI (ChatPanel → MessageList)
```

### SessionStreamManager

全局单例，管理多个 `StreamSession` 实例：
- `getOrCreate(sessionId)` - 获取或创建 StreamSession
- `switchTo(sessionId)` - 切换 active session，绑定回调
- `isSessionStreaming(sessionId)` - 检查指定 session 是否在流式中

### StreamSession

每个 session 对应一个实例，保存完整的消息状态：
- `messages: AnyMessage[]` - 消息列表
- `isStreaming: boolean` - session 级别流式状态
- `streamingMessageId: string | null` - 当前正在流式的 assistant 消息 ID

## 消息数据结构

### ChatMessage 类型

```typescript
interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  streaming?: boolean;
  codeRefs?: CodeRef[];
  parts?: MessagePart[];
  diffMeta?: DiffMeta;
  /** 消息元数据（Fork 功能依赖） */
  metadata?: {
    archive_id?: string;
    [key: string]: unknown;
  };
}
```

### ToolCallMessage 类型

```typescript
interface ToolCallMessage {
  id: string;
  role: "tool_call";
  tool: string;
  args: Record<string, unknown>;
  status: "running" | "success" | "error";
  result?: unknown;
}
```

### metadata 传递链路

metadata 用于携带后端附加信息（如归档 ID），流转路径：

```
后端事件 Event.metadata
       ↓
stream-manager.ts replayInto()
       ↓
addUserMessage(content, codeRefs, parts, backendId, metadata)
       ↓
ChatMessage.metadata
       ↓
UserMessage 读取 metadata.archive_id 判断是否可以 Fork
```

**关键实现点：**
- `stream-manager.addUserMessage()` 第 5 个参数接收 metadata
- `replayInto()` 在历史回放时将 `event.metadata` 原样传递
- 实时流（global-event-stream.ts）中 metadata 为空（因为是当前用户新发送的消息）

## Session 切换数据流

```
sessionStore.switchSession(sessionId)
       ↓
streamManager.switchTo(sessionId)
       ↓ 解绑旧 session，绑定新 session
bindAndSync() → 立即同步内存消息到 useChat
       ↓
fetchSessionMessages(sessionId)
       ↓
replayInto(events) → 从后端历史重建消息
```

### replayInto 重建逻辑

`replayInto()` 在从后端历史重建消息时，需要保留内存中正在流式的消息（streamingTail）：

```typescript
let streamingTail: AnyMessage[] = [];
if (session.isStreaming && session.streamingMessageId) {
    const streamIdx = session.messages.findIndex(
        (m) => m.id === session.streamingMessageId,
    );
    if (streamIdx >= 0) {
        streamingTail = session.messages.slice(streamIdx);
    }
}
```

**注意**：`streamingMessageId` 只追踪 **assistant 消息**（`ChatMessage.streaming`），**不追踪 tool 消息**。

当 tool 正在 running 时：
- `session.isStreaming = true`（session 级别仍在流式中）
- `session.streamingMessageId = null`（因为 `tool_call` 事件会调用 `finalizeAssistantMessage()`，把它清空）

由于 `streamingMessageId === null`，条件 `session.isStreaming && session.streamingMessageId` 不满足，`streamingTail` 保持为空。

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

## UserMessage 按钮交互设计

### 按钮布局
- **位置**：消息左侧，顶部与消息对齐（flex 布局）
- **排列**：水平排列（复制在左，回滚在右，Fork 在右）
- **尺寸**：`w-7 h-7`，图标 15px
- **间距**：`gap-1`

### 显示逻辑
| 状态 | 可见按钮 | 说明 |
|------|----------|------|
| 默认 | 回滚按钮 | 常驻显示，紧贴消息 |
| Hover | 复制 + 回滚 + Fork | 复制和 Fork 从两侧滑入 |

### Fork 按钮显示条件
Fork 按钮仅在以下条件下显示：
- `message.metadata?.archive_id` 存在且非空
- 该归档 ID 表示该轮对话已完成归档

### 组件依赖
- 使用 `@ftre/ui` 的 `Tooltip` 组件为按钮添加提示
- 按钮样式使用 Tailwind 工具类

## Fork 会话功能

### 功能描述
用户可以从历史对话的某一轮"分叉"出一个新会话，新会话自动携带该轮的归档摘要作为上下文。

### 业务流程

```
UserMessage:hover 显示 Fork 按钮
          ↓
    点击 Fork
          ↓
    fetchArchiveDetail(archiveId) 获取归档详情
          ↓
    newSession() 跳转到新会话页面（session_id = null）
          ↓
    dispatch "ftre:insert-archive-ref" CustomEvent
          ↓
    ChatInput.tsx 监听事件 → insertArchiveChip(archiveRef)
          ↓
    Slate 编辑器插入 ArchiveChipElement
          ↓
    用户可在引用后继续输入，发送后后端自动加载归档上下文
```

### 核心实现

**UserMessage.tsx 事件触发：**
```typescript
const handleFork = useCallback(async () => {
  if (!archiveId) return;
  const archive = await fetchArchiveDetail(archiveId);
  
  // 构建完整的 ArchiveRef 对象
  const archiveRef: ArchiveRef = {
    id: archiveId,
    summary: archive.summary,
    turnCount: archive.meta.turn_count,
    totalMessages: archive.meta.total_messages,
    label: archive.meta.label,
    createdAt: archive.created_at,
  };
  
  useSession.getState().newSession();
  window.dispatchEvent(
    new CustomEvent("ftre:insert-archive-ref", { detail: archiveRef })
  );
}, [archiveId]);
```

**ChatInput.tsx 事件监听：**
```typescript
useEffect(() => {
  const handler = (e: Event) => {
    const ref = (e as CustomEvent).detail as ArchiveRef;
    inputEditor.insertArchiveChip(ref);
    inputEditor.focus();
  };
  window.addEventListener("ftre:insert-archive-ref", handler);
  return () => window.removeEventListener("ftre:insert-archive-ref", handler);
}, [inputEditor]);
```

### 数据结构设计

**ArchiveRef（Slate 编辑器使用）：**
```typescript
interface ArchiveRef {
  id: string;
  summary: string;
  turnCount: number;
  totalMessages: number;
  label?: string;
  createdAt: number;
}
```

**ArchiveEntry（API 返回）：**
```typescript
interface ArchiveEntry {
  id: string;
  type: string;
  summary: string;
  content: string;
  meta: {
    session_id: string;
    parent_id: string;
    turn_count: number;
    total_messages: number;
    compressed_at: number;
    label?: string;
    updated_at?: number | null;
  };
  created_at: number;
  folder_ids: string[];
}
```

### ArchiveChipView 空值防御

`ArchiveChipView` 渲染 Slate inline void 元素，必须对 `archiveRef` 属性做防御性检查：

```typescript
const { archiveRef } = element;
if (!archiveRef) return null;

// 截断摘要显示，需使用可选链
const shortSummary = archiveRef.summary?.length > 30
  ? archiveRef.summary.slice(0, 30) + "..."
  : archiveRef.summary;
```

**常见问题：** 若传递不完整的 ArchiveRef（如只传 `{ id, display }`），访问 `archiveRef.summary.length` 会抛出异常。

### 注意事项
- `insertArchiveChip` 需要完整的 `ArchiveRef` 对象，不能只传 `{ id, display }`
- `ArchiveChipView` 组件依赖 `summary` 字段计算显示文本长度，缺失会导致报错
- 发送消息时，`message` 数组中包含 `archive_ref` 类型的 part，后端自动加载归档上下文
- metadata 只在历史回放时存在，实时流中 metadata 为空

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
- **触发位置**：`UserMessage.tsx` hover 时显示操作按钮
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

## 注意事项

- **切换 session 时 running tool 消息丢失**：`replayInto()` 在从后端历史重建消息时，`streamingTail` 的保留条件只检查 `streamingMessageId`（assistant 消息的 ID），而 tool 执行时这个字段已经是 null。导致切换 session 再切回来时，内存中正在 running 的 tool 消息被清空，UI 丢失。修复方案需要扩展 `streamingTail` 的保留逻辑，同时检查 `isStreaming` 和是否存在 `status === "running"` 的 tool 消息。
- `insertArchiveChip` 需要完整的 `ArchiveRef` 对象，不能只传 `{ id, display }`
- `ArchiveChipView` 组件依赖 `summary` 字段计算显示文本长度，缺失会导致报错
- 发送消息时，`message` 数组中包含 `archive_ref` 类型的 part，后端自动加载归档上下文
- metadata 只在历史回放时存在，实时流中 metadata 为空

## 历史变更

- **2025-02**: 补充流式处理架构文档
  - GlobalEventStream → StreamSession → useChat 完整数据链路
  - Session 切换时的数据流（switchSession → switchTo → replayInto）
  - replayInto streamingTail 保留逻辑及 BUG 根因
  - 注意事项记录切换 session 时 running tool 消息丢失问题

- **2025-01**: 新增 Fork 会话功能
  - UserMessage 添加 Fork 按钮（仅当 metadata.archive_id 存在时显示）
  - 点击 Fork 跳转到新会话并自动插入归档引用
  - 新增 `ftre:insert-archive-ref` CustomEvent 用于跨组件通信
  - `insertArchiveChip` 需要完整 ArchiveRef 对象（含 summary, turnCount, totalMessages, label, createdAt）
  - 补充 ChatMessage.metadata 类型定义
  - stream-manager.ts 中 metadata 传递链路：replayInto → addUserMessage

- **2025-01**: UserMessage 按钮布局重构
  - 按钮位置从消息下方右侧移至左侧顶部对齐
  - 默认状态仅显示回滚按钮，hover 显示复制+回滚
  - 按钮水平排列：复制在左，回滚在右
  - 引入 `@ftre/ui` Tooltip 组件

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
