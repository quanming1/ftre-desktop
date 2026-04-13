# Diff View (差异对比视图)

> 差异对比存在两套实现：编辑器内使用 Monaco DiffEditor，Chat 消息列表中使用 DiffSummaryCard。

## 核心文件

### 编辑器 Diff (Monaco)
| 文件 | 职责 |
|------|------|
| `packages/editor/src/ui/DiffBar.tsx` | Diff 工具栏，显示变更统计和操作按钮 |
| `packages/editor/src/ui/MonacoDiffViewer.tsx` | Monaco DiffEditor 封装，渲染差异对比 |
| `packages/editor/src/ui/themes/darcula.ts` | Monaco Darcula 主题定义 |
| `packages/renderer/src/features/editor/EditorArea.tsx` | 集成 DiffBar 和 MonacoDiffViewer，管理 diff 状态 |
| `packages/editor/src/store/editor-store.ts` | `addDiff` 函数创建 diff 虚拟标签页 |
| `packages/renderer/src/features/chat/toolActions.ts` | `handleShowDiff` 处理 edit tool 的 diff 展示请求 |

### Chat Diff (自研组件)
| 文件 | 职责 |
|------|------|
| `packages/ui/src/components/diff-summary/DiffSummaryCard.tsx` | 文件列表 + diff 展示容器，纯展示组件 |
| `packages/renderer/src/features/chat/DiffSummaryCard.tsx` | 包装组件，处理 API 调用和按需加载逻辑 |
| `packages/renderer/src/features/chat/ToolCallCard.tsx` | edit tool 卡片，edit 完成后默认展开 diff |
| `packages/renderer/src/services/api.ts` | `fetchDiff`, `fetchDiffStat`, `fetchSnapshotFileDiff` 等 API |
| `packages/renderer/src/features/chat/MessageList.tsx` | 渲染 `diff_summary` 类型的 RenderUnit |

### 可复用的 Diff 组件（从 DiffSummaryCard 解耦导出）
| 组件 | 导出路径 | 职责 |
|------|----------|------|
| `InlineDiffView` | `@ftre/ui` | 完整 diff 视图，支持分段折叠、上下文切换、展开控制 |
| `DiffLineRow` | `@ftre/ui` | 单行 diff 渲染，支持点击行号回调 |
| `DiffBar` | `@ftre/ui` | 增删比例可视化条 |
| `DiffStats` | `@ftre/ui` | 增删数字标签 |
| `parseUnifiedDiffLines` | `@ftre/ui` | 解析 unified diff 文本 |
| `computeDiffLines` | `@ftre/ui` | 从 old/newString 计算 diff（LCS 算法） |
| `groupIntoSegments` | `@ftre/ui` | diff 分段折叠 |
| `computeDiffStats` | `@ftre/ui` | 计算 diff 统计（变更块数、增删行数） |

### 已废弃文件/方法
```
packages/renderer/src/features/chat/diff/DiffView.tsx (已删除)
packages/renderer/src/features/chat/diff/index.ts (已删除)
attachDiffMetaToLastUserMessage (已从 stream-manager.ts 删除)
diff_meta SSE 事件 (已从 global-event-stream.ts 删除)
```
删除原因：与 `DiffSummaryCard` 功能重复，统一使用 `@ftre/ui` 包实现；Diff 统计改为按需 API 调用而非 SSE 推送。

## 关键数据结构

### DiffEntry (编辑器)
```typescript
interface DiffEntry {
  id: string;              // 唯一标识，格式: `${toolId}:${filePath}:${timestamp}`
  tabPath: string;         // 虚拟路径 `diff:${filePath}`
  filePath: string;        // 实际文件绝对路径
  originalContent: string; // 变更前内容 (对应后端 before_content)
  newContent: string;      // 变更后内容 (对应后端 after_content)
  toolName: string;
  isApproximate: boolean;
}
```

### DiffResponse (后端 API)
```typescript
interface DiffFileEntry {
  file: string;            // 相对路径，如 "app/runtime/session_node.py"
  before_content: string;  // 映射到 DiffEntry.originalContent
  after_content: string;   // 映射到 DiffEntry.newContent
  additions: number;
  deletions: number;
}

interface DiffResponse {
  call_id: string;
  tool_name: string;
  files: DiffFileEntry[];
}
```

### DiffMeta (精简后)
```typescript
interface DiffMeta {
  base_hash: string;
  final_hash: string;
  workspace: string;
  // 注意：files 列表不再内嵌，改为调用 /diff/stat 接口按需获取
}
```

### DiffStatResponse
```typescript
interface DiffStatResponse {
  message_id: string;
  base_hash: string;
  final_hash: string;
  workspace: string;
  files: DiffStatFile[];       // 文件变更列表
  total_additions: number;
  total_deletions: number;
  total_files: number;
}

interface DiffStatFile {
  file: string;
  additions: number;
  deletions: number;
}
```

### RenderUnit (MessageList)
```typescript
type RenderUnit =
  | { type: "ai_turn_start" }
  | { type: "single"; id: string }
  | { type: "group"; key: string; toolName: string; ids: string[] }
  | { type: "diff_summary"; messageId: string; baseHash: string; finalHash: string; workspace: string };
```

### DiffSummaryCard 包装组件 Props
```typescript
interface DiffSummaryCardProps {
  messageId: string;    // 用于调用 /diff/stat 接口
  baseHash: string;     // snapshot base hash
  finalHash: string;    // snapshot final hash
  workspace: string;    // 工作区路径
  /** 是否自动加载（用于刚结束的轮次），静默模式不弹窗 */
  autoLoad?: boolean;
}
```

### DiffLine
```typescript
type DiffLineType = "ctx" | "del" | "add" | "hunk";

interface DiffLine {
  type: DiffLineType;
  text: string;
  lineNo: number | null;
}
```

### DiffSegment
```typescript
interface DiffSegment {
  lines: DiffLine[];
  isCollapsed: boolean;
  canCollapse: boolean;
}
```

## 业务流程

### 编辑器 Diff 工具调用链路 (edit tool)
```
edit tool 执行完成
  ↓
toolActions.ts:handleShowDiff(callId)
  ↓ 调用 GET /diff/{call_id}
fetchDiff(callId): Promise<DiffResponse>
  ↓ 筛选有效文件 (before !== after 或 additions+deletions > 0)
  ↓ 字段映射: before_content → originalContent, after_content → newContent
  ↓ 路径构建: tabPath = buildDiffTabPath(fullPath) = `diff:${fullPath}`
editor-store.ts:addDiff(diffEntry)
  ↓ 更新 pendingDiffs 数组，id 添加 timestamp 强制重新挂载
  ↓ 调用 openFile({ path: tabPath, isDiff: true })
EditorArea.tsx 检测到 currentFile.path 以 diff: 开头
  ↓ pendingDiffs.find(d => d.tabPath === currentFile.path) 匹配 activeDiff
  ↓ 渲染 DiffBar + MonacoDiffViewer
```

### 字段映射关系
| 后端 API | 前端 DiffEntry | 说明 |
|----------|---------------|------|
| `before_content` | `originalContent` | 变更前文件内容 |
| `after_content` | `newContent` | 变更后文件内容 |
| `file` | `filePath` | 文件路径（后端相对，前端会 resolve 为绝对路径） |

### EditorArea Diff 渲染逻辑
```typescript
// EditorArea.tsx
const activeDiff = pendingDiffs.find(
  (d) => d.tabPath === currentFile.path  // 关键匹配条件
);

if (activeDiff) {
  return (
    <>
      <DiffBar diff={activeDiff} ... />
      <MonacoDiffViewer
        diff={activeDiff}
        original={activeDiff.originalContent}  // before_content
        modified={activeDiff.newContent}        // after_content
        ...
      />
    </>
  );
}
```

### Chat Diff - DiffSummaryCard (按需加载)
```
MessageList 渲染消息
  ↓ 消息包含 diffMeta (base_hash/final_hash/workspace)
  ↓ 构建 diff_summary RenderUnit
DiffSummaryCard 渲染
  ↓ 条件判断：baseHash && finalHash && baseHash !== finalHash
  ↓ 条件满足则显示"查看变更"按钮
  ↓ 用户点击按钮 / autoLoad 触发
调用 fetchDiffStat(messageId)
  ↓ 获取 files/additions/deletions 列表
展开显示文件列表
  ↓ 用户点击具体文件
调用 fetchSnapshotFileDiff 获取 diff 内容 → InlineDiffView 渲染
或调用 fetchSnapshotFileContent → 打开编辑器 Diff Tab
```

### 自动加载流程 (isLastTurn)
```
ai_turn_end 事件 → isLastTurn=true
  ↓
DiffSummaryCard autoLoad 触发
  ↓
fetchDiffStat 静默加载
  ↓
total_files > 0 → 自动展开显示
  ↓
total_files === 0 → 静默退出（无弹窗）
```

### API 接口

**获取工具调用 Diff 内容（edit tool）：**
```
GET /diff/{call_id}
Response: DiffResponse { call_id, tool_name, files: DiffFileEntry[] }
```

**获取 Diff 统计信息：**
```
GET /diff/stat?message_id={user_input_message_id}
Response: DiffStatResponse
```

**获取文件 Diff 内容：**
```
POST /snapshot/file-diff
Body: { workspace, base_hash, final_hash, file_path }
Response: { diff: string }
```

**获取文件完整内容（用于编辑器 Diff）：**
```
POST /snapshot/file-content
Body: { workspace, from_hash, to_hash, file_path }
Response: { before_content: string, after_content: string }
```

## Diff 核心函数

```typescript
// 获取工具调用 diff（edit tool 结果）
function fetchDiff(callId: string): Promise<DiffResponse | null>

// 获取 diff 统计信息（按 message_id 查询）
function fetchDiffStat(messageId: string): Promise<DiffStatResponse | null>

// 获取文件 diff 内容
function fetchSnapshotFileDiff(
  workspace: string,
  baseHash: string,
  finalHash: string,
  filePath: string
): Promise<{ diff: string } | null>

// 获取文件完整内容
function fetchSnapshotFileContent(
  workspace: string,
  fromHash: string,
  toHash: string,
  filePath: string
): Promise<{ before_content: string; after_content: string } | null>

// 构建 diff ID
function buildDiffId(toolId: string, filePath: string): string

// 构建 diff tab 路径（虚拟路径）
function buildDiffTabPath(filePath: string): string  // 返回 `diff:${filePath}`

// 解析 unified diff 文本
function parseUnifiedDiffLines(diffText: string): DiffLine[]

// 从 old/newString 计算 diff（LCS 算法）
function computeDiffLines(oldString: string, newString: string): DiffLine[]

// 分段折叠
function groupIntoSegments(lines: DiffLine[]): DiffSegment[]

// 计算 diff 统计
function computeDiffStats(segments: DiffSegment[]): DiffStats
```

## Diff 交互控制

### InlineDiffView 控制栏
```typescript
interface InlineDiffViewProps {
  diffLines: DiffLine[];
  filePath?: string;
  contextLines?: number;          // 上下文行数：3 | 10 | Infinity
  defaultCollapsed?: boolean;     // 默认折叠状态
  onLineClick?: (lineNo: number) => void;
}
```

**交互功能：**
- **上下文切换**: 3 行 / 10 行 / 全部
- **批量控制**: 展开全部 / 折叠全部
- **统计展示**: 变更块数、增删行数
- **行号点击**: 点击行号触发回调（可跳转编辑器）
- **折叠块 hover**: 显示该块的变更统计

### DiffNavCard (ToolCallCard)
edit tool 卡片交互：
- 默认展开 diff（edit 完成后）
- 显示变更统计（块数、增删行数）
- 支持展开/折叠全部、上下文切换

## 设计决策

- **组件统一**: Chat Diff 统一使用 `@ftre/ui` 的 `DiffSummaryCard`
  - 原因：避免两套实现维护成本，解耦出可复用组件
  - 废弃 `packages/renderer/src/features/chat/diff/DiffView.tsx`

- **Diff 统计接口重构** (2025):
  - **变化**: 从 SSE 推送 `diff_meta` 改为按需调用 `/diff/stat` API
  - **原因**: 避免存储冗余（base_hash/final_hash 足够），数据不会过时，支持查看历史轮次
  - **实现**: `DiffMeta` 只保留 `base_hash`, `final_hash`, `workspace`，files 列表通过 API 获取
  - **删除**: `diff_meta` SSE 事件、`attachDiffMetaToLastUserMessage` 方法

- **字段命名映射**: 后端使用 `before_content`/`after_content`，前端 DiffEntry 使用 `originalContent`/`newContent`
  - 原因：前端代码语义更清晰（original/modified 对应 Monaco DiffEditor 的 API）
  - 转换点：`toolActions.ts:handleShowDiff` 中进行字段映射

- **DiffEntry ID 强制刷新**: `addDiff` 中每次更新 `id` 添加 `Date.now()` 时间戳
  - 原因：@monaco-editor/react 的 DiffEditor 对 props 变化响应不完善，强制重新挂载确保内容更新

- **按需加载策略**: DiffSummaryCard 默认只显示操作按钮，首次点击"查看变更"时才调用 API
  - 原因：避免不必要的请求，提升消息列表渲染性能
  - 实现：组件内维护 `showDiff` 和 `files` 状态

- **Session 结束自动加载** (isLastTurn):
  - **触发**: `autoLoad={isLastTurn}` 时自动加载
  - **静默模式**: 无变更时不弹窗提示
  - **有变更**: 自动展开 DiffSummaryCard

- **"查看变更"按钮条件渲染** (2025):
  - **条件**: `baseHash && finalHash && baseHash !== finalHash`
  - **场景**: hash 不全（流式输出期间占位对象）或 hash 相同（无实际变更）时不展示按钮
  - **原因**: 避免无效操作，用户无需点击无意义的 diff

- **纯展示组件**: `DiffSummaryCard` / `InlineDiffView` 解耦为纯展示组件
  - 接收 `DiffLine[]` 作为 props
  - 不自行调用 API 加载 diff 数据
  - 导出所有子组件供外部复用

- **默认展开**: edit tool 编辑完成后默认展开 diff 展示
  - 原因：用户需要立即看到修改结果

- **编辑器 Diff**: 继续使用 Monaco DiffEditor
  - 原因: 功能完善，与编辑器体验一致

## 注意事项

- **字段映射**: 后端 `before_content`/`after_content` → 前端 `originalContent`/`newContent`
- **路径匹配**: EditorArea 中通过 `tabPath === currentFile.path` 匹配，`tabPath` 格式为 `diff:${filePath}`
- **DiffMeta 变化**: 只存储精简数据（hash + workspace），files 列表需调用 API
- **SSE 事件已移除**: `diff_meta` 不再通过 SSE 推送
- **按需加载**: DiffSummaryCard 点击后才加载数据，首次点击有 loading 状态
- **包依赖**: `@ftre/renderer` 使用 `@ftre/ui` 的 `DiffSummaryCard` / `InlineDiffView`
- **样式配置**: 通过 Tailwind 类名直接控制
- **DiffEditor 清理**: 关闭 diff tab 时需确保 Monaco DiffEditor 正确清理
- **空 diff 不展示**: 当 `diffLines` 为空数组时，不应渲染 diff 视图
- **查看变更按钮条件**: 必须在 `baseHash` 和 `finalHash` 都存在且不相同时才展示按钮
- **强制重新挂载**: addDiff 中通过 `${diff.id}:${Date.now()}` 更新 id，解决 Monaco DiffEditor 不响应 props 变化的问题

### ⚠️ 参数有效性检查（重要坑点）

**问题**: 流式输出期间，`diffMeta` 可能是一个占位对象，其中 `base_hash`、`final_hash`、`workspace` 字段值可能为 `undefined`。如果不做检查直接调用 `fetchSnapshotFileDiff` 或 `fetchSnapshotFileContent`，会导致：
- 请求 URL 参数为 `undefined`（如 `workspace=undefined&to_hash=undefined`）
- UI 组件的 useEffect 依赖项变化引发无限循环调用

**解决方案**: 在调用 API 前必须检查参数有效性：

```typescript
const handleLoadFileDiff = useCallback(
  async (filePath: string) => {
    // 参数不完整时直接返回，避免无效请求
    if (!workspace || !baseHash || !finalHash) {
      console.warn("[DiffSummaryCard] 缺少必要参数，跳过加载");
      return null;
    }
    const result = await fetchSnapshotFileDiff(workspace, baseHash, finalHash, filePath);
    return result?.diff ?? null;
  },
  [workspace, baseHash, finalHash],
);
```

## 已知问题

### MonacoDiffViewer 无语法高亮
**位置**: `packages/editor/src/store/editor-store.ts` 中 `addDiff` 函数
**根因**: 创建 diff 虚拟 tab 时 `language` 被硬编码为 `"plaintext"`

### MonacoDiffViewer 显示原始文件而非差异（调试案例）
**现象**: 点击 diff 卡片后，diff view 直接展示原始文件内容，没有显示差异对比

**排查方法**:
1. 检查 `EditorArea.tsx` 中的路径匹配逻辑：
   ```typescript
   const activeDiff = pendingDiffs.find((d) => d.tabPath === currentFile.path);
   ```

2. 添加调试日志验证数据流：
   ```typescript
   console.log('[EditorArea] diff tab detected:', {
     currentFilePath: currentFile.path,
     pendingDiffsCount: pendingDiffs.length,
     pendingDiffTabPaths: pendingDiffs.map(d => d.tabPath),
     activeDiffFound: !!activeDiff,
     activeDiffId: activeDiff?.id,
     hasOriginal: !!activeDiff?.originalContent,
     hasNew: !!activeDiff?.newContent,
     originalLen: activeDiff?.originalContent?.length,
     newLen: activeDiff?.newContent?.length,
   });
   ```

3. 检查 `MonacoDiffViewer.tsx` 的 `onMount` 回调：
   ```typescript
   const disposable = diffEditor.onDidUpdateDiff(() => {
     const changes = diffEditor.getLineChanges();
     console.log('[MonacoDiffViewer] onDidUpdateDiff:', {
       changesCount: changes?.length ?? 0,
       changes: changes?.slice(0, 3), // 前3个变更
     });
   });
   ```

**可能原因**:
- `activeDiffFound: true` + `hasOriginal/hasNew: true` + 内容长度不同 → 数据正确，可能是 Monaco DiffEditor 本身渲染问题
- `activeDiffFound: false` → 路径匹配问题，检查 `tabPath` 和 `currentFile.path` 的格式是否一致（都应该是 `diff:${filePath}` 格式）
- 后端返回的 `before_content` 和 `after_content` 实际相同 → 检查后端 diff 数据

### InlineDiffView 行号溢出
**位置**: `packages/ui/src/components/diff-summary/DiffSummaryCard.tsx` 中 `DiffLineRow` 组件
**问题**: 行号宽度固定为 `w-[42px]`，三位数行号可能溢出

### InlineDiffView 无语法高亮
**位置**: `packages/ui/src/components/diff-summary/DiffSummaryCard.tsx`
**问题**: 代码内容直接渲染为纯文本，仅有增删行背景色
