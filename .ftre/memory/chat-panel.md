# Chat 面板

> AI 对话界面，包含消息列表和输入框（Session 管理已独立为顶层面板）

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/features/chat/ChatPanel.tsx` | 纯聊天面板，仅包含 MessageList + ChatInput |
| `packages/renderer/src/features/chat/MessageList.tsx` | 消息列表展示，包含消息分组、system 错误消息重试按钮、RenderUnit 转换 |
| `packages/renderer/src/features/chat/ChatInput.tsx` | 输入框组件，支持拖拽 archive_ref，集成 RetryPanel |
| `packages/renderer/src/features/chat/RetryPanel.tsx` | LLM 重试状态面板，显示在输入框上方 |
| `packages/renderer/src/features/chat/ToolCallCard.tsx` | Tool 调用结果渲染（含 EditDiffCard/InlineDiffView） |
| `packages/renderer/src/features/chat/DiffSummaryCard.tsx` | Diff 统计卡片，展示本轮变更摘要（支持 autoLoad 静默加载） |
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
| `packages/renderer/src/services/api.ts` | chat API：sendChat / cancelChat / retryChat / rollbackSession / branchSession / fetchDiffStat / fetchSessionMessages / fetchUsage |
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
  "session_status_change",  // ← idle ↔ running 状态变更
  "session_created",        // ← 多端同步：新 session 创建
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

## 多端同步机制

### Session 状态变更 (`session_status_change`)

当 session 从 `running` 变为 `idle` 时，后端推送此事件通知前端刷新数据。

```
后端推送 session_status_change
       ↓
更新 streamManager 中对应 session 的 streaming 状态
       ↓
如果用户当前处于该 session：
  ├─ fetchSessionMessages(sessionId) → replayInto() 刷新消息列表
  └─ fetchUsage(sessionId) → 更新 token 用量
```

**核心逻辑** (`global-event-stream.ts`)：
```typescript
source.addEventListener("session_status_change", (e) => {
  const { session_id, status } = parseEvent(e);
  
  // 1. 更新 streaming 状态
  const session = streamManager.get(session_id);
  if (session) session.setStreaming(status === "running");
  
  // 2. 如果用户在该 session，刷新消息和用量
  const active = streamManager.getActive();
  if (active?.sessionId === session_id) {
    fetchSessionMessages(session_id).then(events => {
      streamManager.replayInto(session_id, events);
    });
    fetchUsage(session_id).then(tokens => {
      active.setContextTokens(tokens);
    });
  }
  
  // 3. 刷新当前工作区的 sessionList
  const currentWorkspace = useWorkspace.getState().rootPath;
  if (session?.workspace && normalizePathForCompare(session.workspace) === 
      normalizePathForCompare(currentWorkspace)) {
    useSession.getState().loadSessions(currentWorkspace);
  }
});
```

### Session 创建 (`session_created`)

用于多端同步：当其他客户端创建新 session 时，后端推送此事件。

```
后端推送 session_created
       ↓
解析 session_id 和 workspace
       ↓
如果 workspace 匹配当前工作区：
  └─ loadSessions() 刷新 session 列表
```

**工作区匹配逻辑**：
```typescript
source.addEventListener("session_created", (e) => {
  const { session_id, workspace } = parseEvent(e);
  const currentWorkspace = useWorkspace.getState().rootPath;
  
  if (currentWorkspace && 
      normalizePathForCompare(workspace) === normalizePathForCompare(currentWorkspace)) {
    useSession.getState().loadSessions(currentWorkspace);
  }
});
```

### 工作区路径规范化

多端同步时必须统一路径格式进行比较：
- 只对盘符开头的 Windows 路径转小写
- 保持其他路径大小写敏感
- 使用 `normalizePathForCompare()` 工具函数

## Diff 统计卡片（DiffSummaryCard）

展示本轮对话产生的代码变更统计，支持**静默自动加载**。

### 核心实现

```typescript
// DiffSummaryCard Props
interface DiffSummaryCardProps {
  messageId: string;
  baseHash: string;
  finalHash: string;
  workspace: string;
  autoLoad?: boolean;  // 是否静默自动加载
}
```

### 自动加载机制

**设计决策**：Session 结束时（流式输出完成），自动获取本轮 diff 统计，有变更则展开，无变更不弹窗提示。

```typescript
// DiffSummaryCard.tsx 核心逻辑
const loadDiffData = useCallback(async (silent: boolean) => {
  // silent=true: 静默模式，无变更不弹窗
  // silent=false: 手动点击，有错误则弹窗
}, [messageId]);

// autoLoad 时静默加载
useEffect(() => {
  if (autoLoad && !autoLoadedRef.current) {
    autoLoadedRef.current = true;
    loadDiffData(true);  // 静默模式
  }
}, [autoLoad, loadDiffData]);
```

### RenderUnit 标记

`MessageList.tsx` 通过 `isLastTurn` 区分历史轮次和最后一轮：

```typescript
type RenderUnit = {
  type: "diff_summary";
  messageId: string;
  baseHash: string;
  finalHash: string;
  workspace: string;
  key: string;
  isLastTurn: boolean;  // true=最后一轮，触发 autoLoad
};
```

**逻辑**：
- 历史轮次：`isLastTurn: false`，需手动点击「查看变更」
- 最后一轮（刚结束）：`isLastTurn: true`，自动静默加载

### API 接口

```typescript
// packages/renderer/src/services/api.ts
export async function fetchDiffStat(messageId: string): Promise<{
  files: DiffFileSummary[];
  total_additions: number;
  total_deletions: number;
  total_files: number;
} | null>
```

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
export interface RetryState {
  code: string;           // 错误码: timeout | network | api_error | rate_limit | unknown
  message: string;        // 错误信息
  attempt: number;        // 当前第几次重试 (1-based)
  maxAttempts: number;    // 最大重试次数
}
```

#### RetryState 清除时机

在 `message` / `done` / `error` / `tool_call` / `tool_call_streaming` 事件中清除

### 用户手动重试

```typescript
// MessageList.tsx 中 system 错误消息显示重试按钮
if (message.role === "system") {
  const canRetry = isLast && !isStreaming;
  // ...
}
```

**设计决策**：
- 仅在最后一条消息且非流式时显示重试按钮
- **前端不清理任何消息**——重试是"继续"而不是"重来"

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
  metadata?: {
    archive_id?: string;
    [key: string]: unknown;
  };
}
```

### 消息 ID 生成策略

**设计决策**：使用后端返回的 `event.id` 作为消息 ID，而非前端自增生成。

```typescript
addToolCall(tool: string, args: Record<string, unknown>, backendId?: string): string {
  const toolCall: ToolCallMessage = {
    id: backendId ?? `tool-${this.nextId++}`,  // 优先使用后端 ID
    // ...
  };
}
```

**原因**：`replayInto()` 可能被多次调用，每次调用都会用 `nextId()` 生成新的消息 ID。若 fingerprint 只检查首尾消息 ID，中间消息 ID 变化不会被检测，导致 renderUnits 使用旧 ID 找不到新消息。

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

### replayInto 多次调用问题

**现象**：AI 消息一开始渲染正常，但随后突然消失。

**根因**：`replayInto` 被调用两次，每次用 `nextId()` 生成新的消息 ID，但 `fingerprint` 只检查首尾消息 ID（user 消息 ID 来自后端，固定不变）。

**修复**：使用后端 `event.id` 作为消息 ID

## 消息渲染流程

### 渲染单元类型
`MessageList.tsx` 将消息流转换为渲染单元（RenderUnit）：

| 类型 | 说明 |
|------|------|
| `single` | 单条消息 |
| `group` | 连续同类型工具调用分组 |
| `diff_summary` | Diff 摘要卡片，支持 `isLastTurn` 标记 |
| `ai_turn_start` | **每轮 AI 回复开始标记**（显示 PixelLogo） |

### AI 品牌标识显示规则
- **位置**：每轮对话（turn）中，user 消息之后、第一个 AI 内容之前
- **组件**：`<PixelLogo size={2} />`
- **样式**：`mt-4 mb-1`
- **频率**：每轮只显示一次

## Tool UI 渲染

### EditDiffCard 组件（edit tool）

`ToolCallCard.tsx` 中的 `EditDiffCard` 专门用于渲染 edit tool 的执行结果。

**设计决策**：使用自研 InlineDiffView，而非第三方库
- React 19 与 `prism-react-renderer`/`react-diff-viewer-continued` 不兼容
- 自研组件位于 `packages/renderer/src/features/chat/diff/DiffView.tsx`

**注意事项**：
- edit tool 使用 `InlineDiffView`，不是 `DiffSummaryCard`
- `InlineDiffView` 直接展示行级 diff 对比
- `DiffSummaryCard` 用于展示整体的 diff 统计（+/- 行数）

## UserMessage 按钮交互设计

### Fork 会话功能

用户可以从历史对话的某一轮"分叉"出一个新会话。

```
UserMessage:hover 显示 Fork 按钮
          ↓
    点击 Fork
          ↓
    fetchArchiveDetail(archiveId)
          ↓
    newSession()
          ↓
    dispatch "ftre:insert-archive-ref" CustomEvent
          ↓
    ChatInput.tsx 监听事件 → insertArchiveChip(archiveRef)
```

## 注意事项

- **retryState 清除时机**：在 `message`、`done`、`error`、`tool_call`、`tool_call_streaming` 事件中清除
- **重试不清理消息**：重试是"继续"执行，不是"重新来过"
- **`replayInto` 多次调用**：使用后端 `event.id` 作为消息 ID 避免消息消失
- **切换 session 时 running tool 消息丢失**：`streamingTail` 只检查 `streamingMessageId`（assistant 消息），不追踪 tool 消息
- **多端同步路径匹配**：必须使用 `normalizePathForCompare()` 统一格式后再比较，避免大小写差异导致同步失败
- **session_status_change 刷新时机**：只在用户当前处于该 session 时才刷新 messageList，避免不必要的重渲染

## 历史变更

- **2025-03**: 新增多端同步机制
  - `session_created` 事件：其他客户端创建 session 时同步刷新列表
  - `session_status_change` 事件：session 结束时刷新消息和 token 用量
  - 工作区路径规范化：`normalizePathForCompare()` 统一比较逻辑

- **2025-03**: DiffSummaryCard 支持自动加载
  - 新增 `autoLoad` prop，实现 Session 结束后静默获取 diff 统计
  - 新增 `isLastTurn` RenderUnit 标记区分历史/最后一轮
  - `loadDiffData(silent: boolean)` 支持静默模式（无变更不弹窗）

- **2025-03**: 新增用户手动重试功能（POST /chat/retry）
- **2025-03**: 新增 RetryPanel 组件
- **2025-03**: 新增 LLM 重试事件（retry）处理
