# Chat 面板

> AI 对话界面，包含消息列表和输入框（Session 管理已独立为顶层面板）

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/features/chat/ChatPanel.tsx` | 纯聊天面板，仅包含 MessageList + ChatInput |
| `packages/renderer/src/features/chat/MessageList.tsx` | 消息列表展示，包含消息分组、system 错误消息重试按钮 |
| `packages/renderer/src/features/chat/ChatInput.tsx` | 输入框组件，支持拖拽 archive_ref，集成 RetryPanel |
| `packages/renderer/src/features/chat/RetryPanel.tsx` | LLM 重试状态面板，显示在输入框上方 |
| `packages/renderer/src/features/chat/ToolCallCard.tsx` | Tool 调用结果渲染（含 EditDiffCard/InlineDiffView） |
| `packages/renderer/src/features/chat/diff/index.ts` | Diff 组件导出（DiffBar, InlineDiffView, computeDiffLines） |
| `packages/renderer/src/features/chat/diff/DiffView.tsx` | 自研 diff 渲染组件（含 InlineDiffView 实现） |
| `packages/renderer/src/features/chat/UserMessage.tsx` | 用户消息渲染 + 操作按钮（复制/回滚/Fork） |
| `packages/renderer/src/features/chat/RollbackConfirmDialog.tsx` | 回滚确认对话框，支持分支选项 |
| `packages/renderer/src/features/chat/AssistantMessage.tsx` | AI 消息渲染（Markdown） |
| `packages/renderer/src/features/chat/slate/ChatInputEditor.ts` | Slate 编辑器，处理 archive-chip 插入 |
| `packages/renderer/src/features/chat/slate/elements/ArchiveChipView.tsx` | Slate 内联归档 Chip 渲染 |
| `packages/renderer/src/components/PixelLogo.tsx` | 像素风格 Logo 组件 |
| `packages/renderer/src/stores/session.ts` | Session store，管理会话状态 |
| `packages/renderer/src/stores/chat.ts` | Chat store，UI 层数据源 |
| `packages/renderer/src/services/api.ts` | chat API：sendChat / cancelChat / retryChat / rollbackSession / branchSession |
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

### SSE 事件类型

`global-event-stream.ts` 监听的事件类型：

```typescript
const eventTypes = [
  "connected",
  "session_started",
  "user_input",
  "message",
  "message_complete",
  "tool_call",
  "tool_call_streaming",
  "tool_result",
  "tool_cancelled",
  "tool_timed_out",
  "usage_update",
  "done",
  "error",
  "retry",        // ← LLM 后端自动重试事件
  "interrupt",
  "diff_meta",
];
```

### SessionStreamManager

全局单例，管理多个 `StreamSession` 实例：
- `getOrCreate(sessionId)` - 获取或创建 StreamSession
- `switchTo(sessionId)` - 切换 active session，绑定回调
- `isSessionStreaming(sessionId)` - 检查指定 session 是否在流式中
- `retryLastMessage(model?)` - 调用 retry API，不复用消息

### StreamSession

每个 session 对应一个实例，保存完整的消息状态：
- `messages: AnyMessage[]` - 消息列表
- `isStreaming: boolean` - session 级别流式状态
- `streamingMessageId: string | null` - 当前正在流式的 assistant 消息 ID
- `retryState: RetryState | null` - LLM 重试状态（后端自动重试时推送）

**新增方法**：
- `setRetryState(state)` - 设置重试状态，触发 UI 更新

## LLM 重试功能

### 两种重试机制

| 机制 | 触发方式 | 说明 |
|------|----------|------|
| **后端自动重试** | 后端 CodeAgent 在失败时自动重试 | 推送 `retry` SSE 事件，前端展示 RetryPanel |
| **用户手动重试** | 点击错误消息下方的「重试」按钮 | 调用 `POST /chat/retry` 接口 |

### 后端自动重试（RetryPanel）

后端 LLM 调用失败时自动重试，通过 SSE 推送 `retry` 事件。

#### RetryState 数据结构

```typescript
// packages/renderer/src/services/stream-manager.ts
export interface RetryState {
  code: string;           // 错误码: timeout | network | api_error | rate_limit | unknown
  message: string;        // 错误信息，如 "请求超时"
  attempt: number;        // 当前第几次重试 (1-based)
  maxAttempts: number;    // 最大重试次数
}

// StreamSession 中的状态
export class StreamSession {
  retryState: RetryState | null = null;
  
  setRetryState(state: RetryState | null) {
    this.retryState = state;
    this.emitChange();
  }
}
```

#### 事件处理链路

```
global-event-stream.ts
    ↓ 收到 retry 事件
    ↓ payload: { code, message, attempt, max_attempts }
    ↓ session.setRetryState({...})
stream-manager.ts
    ↓ emitChange() 触发 onChanged 回调
chat.ts
    ↓ syncFrom() 同步 retryState
ChatInput.tsx
    ↓ retryState && <RetryPanel retry={retryState} />
```

#### RetryState 清除时机

在以下事件中清除 `retryState`（重试成功或失败）：

| 事件 | 清除逻辑 | 说明 |
|------|----------|------|
| `message` | `if (session.retryState) session.setRetryState(null)` | 重试成功，开始正常流式输出 |
| `done` | 同上 | 流式结束 |
| `error` | 同上 | 重试失败（超过 maxAttempts）|
| `tool_call` | 同上 | 重试成功后直接执行 tool |
| `tool_call_streaming` | 同上 | 重试成功后流式输出 tool |

#### RetryPanel UI

**位置**：ChatInput 正上方，宽度比输入框窄（`max-w-[600px]`）

**交互**：可展开/收起，点击箭头切换

**样式要点**：
- 背景：深色半透明（`bg-panel/80`）
- 圆角：顶部 `rounded-t-2xl`，与 ChatInput 连接
- ChatInput 在有重试状态时去除顶部圆角（`rounded-b-2xl border-t-0`）

**显示示例**：
- 收起：「正在重试 (2/10) ▼」
- 展开：显示详细错误信息和重试策略

### 用户手动重试（MessageList 重试按钮）

当 LLM 调用失败，后端推送 `error` 事件并结束流式后，前端显示错误消息并提供重试按钮。

#### API 接口

```typescript
// packages/renderer/src/services/api.ts
export async function retryChat(params: {
  sessionId: string;
  model?: string | null;  // 可选，换模型重试
}): Promise<{ session_id: string }> {
  const res = await fetch(`${BACKEND_URL}/chat/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: params.sessionId,
      model: params.model,
    }),
  });
  if (!res.ok) {
    throw new Error(`retryChat failed: ${res.status}`);
  }
  return res.json();
}
```

#### 业务流程

```
LLM 调用失败
    ↓
收到 error 事件 → global-event-stream.ts
    ↓
session.addSystemMessage(errorMessage) → 显示红色错误文本
    ↓
MessageList.tsx 检测到 system 消息且是最后一条、非流式状态
    ↓
在错误消息下方显示「重试」按钮
    ↓
用户点击重试
    ↓
streamManager.retryLastMessage()
    ↓
直接调用 api.retryChat({ sessionId, model? }) → POST /chat/retry
    ↓
后端截去失败的 AI 回复，重新调用 LLM
    ↓
正常 SSE 事件流（message/tool_call/done）
```

#### MessageList 重试按钮逻辑

```typescript
// MessageList.tsx MessageItem
if (message.role === "system") {
  const canRetry = isLast && !isStreaming;
  return (
    <div>
      <div className="text-[13px] text-danger p-3 bg-danger/[0.08] rounded-lg font-mono">
        {message.content}
      </div>
      {canRetry && (
        <button onClick={() => streamManager.retryLastMessage()}>
          <RotateCwIcon /> 重试
        </button>
      )}
    </div>
  );
}
```

**设计决策**：
- 仅在最后一条消息且非流式时显示重试按钮
- **前端不清理任何消息**——重试是"继续"而不是"重来"
- 后端会自动处理消息截断（截去失败的 AI 回复）
- 支持换模型重试（通过 `model` 参数）

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

### 消息 ID 生成策略

**设计决策**：使用后端返回的 `event.id` 作为消息 ID，而非前端自增生成。

```typescript
// stream-manager.ts
addToolCall(tool: string, args: Record<string, unknown>, backendId?: string): string {
  const toolCall: ToolCallMessage = {
    id: backendId ?? `tool-${this.nextId++}`,  // 优先使用后端 ID
    role: "tool_call",
    tool,
    args,
    status: "running",
  };
  // ...
}

startAssistantMessage(backendId?: string): string {
  const id = backendId ?? `msg-${this.nextId++}`;  // 优先使用后端 ID
  // ...
}
```

**原因**：`replayInto()` 可能被多次调用（如快速切换会话），每次调用都会用 `nextId()` 生成新的消息 ID。若 fingerprint 只检查首尾消息 ID，中间消息 ID 变化不会被检测，导致 renderUnits 使用旧 ID 找不到新消息。

**后端 ID 来源**：后端推送的 SSE 事件中，`event.id` 是持久化的数据库 ID，稳定不变。

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

### replayInto 多次调用问题

**现象**：在某些会话中，AI 消息一开始渲染正常，但随后突然消失，只显示用户消息。

**根因分析**：
1. `replayInto` 被调用两次（可能是上层组件重复渲染或竞态条件）
2. 每次调用都用 `nextId()` 生成新的消息 ID：`msg-87-xxx` → `msg-160-xxx`
3. 但 `fingerprint` 只检查 `消息数量:首条ID:末条ID`，首尾都是 user 消息（ID 来自后端，两次相同）
4. `fingerprint` 不变 → `useMemo` 不重新计算 `renderUnits` → 使用旧 ID `msg-87-xxx`
5. `useMessageById` 在新消息数组中找不到旧 ID → 返回 null → 组件不渲染

**修复方案**：
- 让 `replayInto` 使用后端 `event.id` 作为消息 ID，保证 ID 稳定
- 修改 `startAssistantMessage` 和 `addToolCall`，添加可选的 `backendId` 参数
- 在 `replayInto` 中调用时传入 `event.id`

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

### useStructuralFingerprint 结构指纹

用于控制 `renderUnits` 的重新计算频率，优化流式期间的性能：

```typescript
function useStructuralFingerprint(): string {
  return useChat((s) => {
    const msgs = s.messages;
    if (msgs.length === 0) return '';
    // 检查最后一条 user 消息是否有 diffMeta
    let hasDiff = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if ('role' in msgs[i] && (msgs[i] as any).role === 'user') {
        hasDiff = (msgs[i] as any).diffMeta ? 1 : 0;
        break;
      }
    }
    // 关键：包含第二条消息的 ID 以检测中间消息重建
    return `${msgs.length}:${msgs[0].id}:${msgs[1]?.id ?? '-'}:${msgs[msgs.length - 1].id}:d${hasDiff}`;
  });
}
```

**设计决策**：
- 流式期间只有最后一条消息的 `content` 变化，ID 和结构不变
- 指纹只关注「结构变化」（消息数量、ID 组合）而非内容变化
- 避免每次内容更新都重新分组导致子组件重排

**修复后状态**：
- 修复消息 ID 生成策略后，fingerprint 可以回滚到只检查首尾消息
- 因为 `replayInto` 多次调用时 ID 不再变化，不会触发该问题

## Tool UI 渲染

### EditDiffCard 组件（edit tool）

`ToolCallCard.tsx` 中的 `EditDiffCard` 专门用于渲染 edit tool（代码编辑工具）的执行结果。

**实现链路：**
```
ToolCallCard.tsx:EditDiffCard
       ↓ 导入 computeDiffLines, diffLinesToUnifiedText
packages/renderer/src/features/chat/diff/index.ts
       ↓ 重新导出
packages/shared/src/diff.ts（核心 diff 算法）
```

**关键实现：**
```typescript
// ToolCallCard.tsx:EditDiffCard
const oldString = message.arguments?.oldString ?? "";
const newString = message.arguments?.newString ?? "";

// 从 oldString/newString 计算 additions/deletions 和 unified diff
const diffLines = useMemo(() => {
  if (!oldString && !newString) return null;
  return computeDiffLines(oldString, newString);
}, [oldString, newString]);

// 渲染：使用 InlineDiffView（自研组件）
<InlineDiffView
  oldCode={oldString}
  newCode={newString}
  filename={filePath}
  onFilenameClick={() => handleShowDiff(message)}
/>
```

**设计决策：使用自研 InlineDiffView，而非第三方库**
- React 19 与 `prism-react-renderer`/`react-diff-viewer-continued` 不兼容
- 自研组件位于 `packages/renderer/src/features/chat/diff/DiffView.tsx`
- 核心 diff 算法已提取到 `packages/shared/src/diff.ts`

**注意事项：**
- edit tool 使用 `InlineDiffView`，不是 `DiffSummaryCard`
- `InlineDiffView` 直接展示行级 diff 对比（类似 `diff -u`）
- `DiffSummaryCard` 用于展示整体的 diff 统计（+/- 行数）

### Tool 状态处理

| 状态 | 行为 |
|------|------|
| `running` | diff 区域不可交互，等待执行完成 |
| `completed` | diff 区域可展开/折叠，默认应展开 |
| `error` | 显示错误信息 |

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
│      RetryPanel (可选)      │
├─────────────────────────────┤
│         ChatInput           │
└─────────────────────────────┘
```

Session 管理功能已拆分到独立的 `SessionPanel`，详见 [session-panel.md](./session-panel.md)。

## 注意事项

- **retryState 清除时机**：必须在 `message`、`done`、`error`、`tool_call`、`tool_call_streaming` 事件中清除，确保重试成功或失败后 UI 及时更新

- **重试不清理消息**：重试是"继续"执行，不是"重新来过"。前端不应移除任何消息（包括 system 错误消息），后端会自动处理消息截断

- **`replayInto` 多次调用导致消息消失**：`replayInto()` 可能被调用两次（如快速切换会话），每次用 `nextId()` 生成新的消息 ID，但 `fingerprint` 只检查首尾消息 ID（user 消息 ID 来自后端，固定不变）。导致 fingerprint 不变 → renderUnits 不重新计算 → 用旧 ID 找不到新消息 → 不渲染。**修复**：使用后端 `event.id` 作为消息 ID，`startAssistantMessage` 和 `addToolCall` 添加 `backendId` 参数

- **切换 session 时 running tool 消息丢失**：`replayInto()` 在从后端历史重建消息时，`streamingTail` 的保留条件只检查 `streamingMessageId`（assistant 消息的 ID），而 tool 执行时这个字段已经是 null。导致切换 session 再切回来时，内存中正在 running 的 tool 消息被清空，UI 丢失。修复方案需要扩展 `streamingTail` 的保留逻辑，同时检查 `isStreaming` 和是否存在 `status === "running"` 的 tool 消息

- `insertArchiveChip` 需要完整的 `ArchiveRef` 对象，不能只传 `{ id, display }`
- `ArchiveChipView` 组件依赖 `summary` 字段计算显示文本长度，缺失会导致报错
- 发送消息时，`message` 数组中包含 `archive_ref` 类型的 part，后端自动加载归档上下文
- metadata 只在历史回放时存在，实时流中 metadata 为空

## 历史变更

- **2025-03**: 修正重试功能设计决策
  - 重试不应清理消息——前端不调用 `removeLastSystemMessage`
  - 重试是"继续"执行，后端自动处理消息截断
  - `retryLastMessage()` 直接调用 API，不修改消息列表

- **2025-03**: 新增用户手动重试功能（POST /chat/retry）
  - 新增 `retryChat()` API 函数，调用 `POST /chat/retry { session_id, model? }`
  - StreamSession 新增 `retryLastMessage()` 方法
  - MessageList 在 system 错误消息下方显示「重试」按钮（仅最后一条 + 非流式时）
  - 支持换模型重试（通过 `model` 参数）

- **2025-03**: 新增 RetryPanel 组件
  - RetryPanel 独立组件，位置在 ChatInput 上方
  - 支持展开/收起，使用箭头图标
  - 清除 retryState 的时机：message/done/error/tool_call/tool_call_streaming

- **2025-03**: 新增 LLM 重试事件（retry）处理
  - 后端通过 SSE 推送 retry 事件通知前端重试状态
  - RetryPayload 包含 code, message, attempt, max_attempts
  - 错误码：timeout | network | api_error | rate_limit | unknown
  - CodeAgent 最大重试 10 次，其他 Agent 3 次，间隔固定 3 秒
  - 需要在 global-event-stream.ts 添加 retry 到 eventTypes 数组

- **2025-03**: 补充 EditDiffCard 文档
  - edit tool 使用 `InlineDiffView` 自研组件渲染 diff
  - 核心算法在 `packages/shared/src/diff.ts`（computeDiffLines, diffLinesToUnifiedText）
  - React 19 与第三方库不兼容，放弃 `prism-react-renderer` 和 `react-diff-viewer-continued`
  - 修复 `ToolCallCard.tsx` 中误用 `@atomOneDark` 主题的问题

- **2025-02**: MessageList 重构
  - 将 AI 品牌标识（PixelLogo）提取为独立的 `ai_turn_start` 渲染单元
  - 在每轮对话开始时显示一次 PixelLogo，而非每个 tool_call 前都显示
  - 优化消息分组逻辑，支持连续同类型 tool_call 分组

- **2025-02**: 新增 Fork 会话功能
  - 支持从任意一轮对话分叉创建新会话
  - 新会话自动携带归档摘要作为上下文
  - 通过 CustomEvent `ftre:insert-archive-ref` 实现跨组件通信

- **2025-02**: 新增 Rollback 功能
  - 支持回滚到任意用户消息
  - 支持分支创建（保留原会话）
  - 回滚按钮常驻显示，Fork 按钮 hover 滑入
