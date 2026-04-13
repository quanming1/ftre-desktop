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
| `packages/editor/src/store/editor-store.ts` | addDiff 函数创建 diff 虚拟标签页 |

### Chat Diff (自研组件)
| 文件 | 职责 |
|------|------|
| `packages/ui/src/components/diff-summary/DiffSummaryCard.tsx` | 文件列表 + diff 展示容器，支持按需加载 |
| `packages/renderer/src/features/chat/DiffSummaryCard.tsx` | 对 UI 组件的包装，处理 API 调用 |
| `packages/renderer/src/features/chat/ToolCallCard.tsx` | edit tool 卡片，edit 完成后默认展开 diff |
| `packages/renderer/src/services/api.ts` | API 调用，包括 `fetchDiffStat` |

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

### 已废弃文件
```
packages/renderer/src/features/chat/diff/DiffView.tsx (已删除)
packages/renderer/src/features/chat/diff/index.ts (已删除)
```
删除原因：与 `DiffSummaryCard` 功能重复，统一使用 `@ftre/ui` 包实现。

## 关键数据结构

### DiffMeta (简化后)
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
}

interface DiffStatFile {
  file: string;
  additions: number;
  deletions: number;
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

### DiffEntry (编辑器)
```typescript
interface DiffEntry {
  id: string;
  tabPath: string;      // 虚拟路径 ftre://diff/{id}
  filePath: string;     // 实际文件路径
  original: string;
  modified: string;
  language: string;
}
```

## 业务流程

### 编辑器 Diff (Monaco)
创建 DiffEntry → 添加到 `pendingDiffs` → `openFile({ path: diffEntry.tabPath, isDiff: true })` → EditorArea 渲染 DiffBar + MonacoDiffViewer

### Chat Diff - DiffSummaryCard (按需加载)
```
MessageList 渲染消息
  ↓ 消息包含 diffMeta (仅含 hash 和 workspace)
DiffSummaryCard 渲染
  ↓ 组件内调用 fetchDiffStat(messageId)
获取 files 列表
  ↓ 用户点击文件
调用 fetchSnapshotFileDiff 获取 diff 内容
```

### API 接口

**获取 Diff 统计信息：**
```
GET /diff/stat?message_id={user_input_message_id}
```

**获取文件 Diff 内容：**
```
POST /snapshot/file-diff
Body: { workspace, base_hash, final_hash, file_path }
```

## Diff 核心函数

```typescript
// 获取 diff 统计信息（按 message_id 查询）
function fetchDiffStat(messageId: string): Promise<DiffStatResponse>

// 获取文件 diff 内容
function fetchSnapshotFileDiff(
  workspace: string,
  baseHash: string,
  finalHash: string,
  filePath: string
): Promise<{ diff: string }>

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

- **纯展示组件**: `DiffSummaryCard` / `InlineDiffView` 解耦为纯展示组件
  - 接收 `DiffLine[]` 作为 props
  - 不自行调用 API 加载 diff 数据
  - 导出所有子组件供外部复用

- **默认展开**: edit tool 编辑完成后默认展开 diff 展示
  - 原因：用户需要立即看到修改结果

- **编辑器 Diff**: 继续使用 Monaco DiffEditor
  - 原因: 功能完善，与编辑器体验一致

## 注意事项

- **DiffMeta 变化**: 只存储精简数据（hash + workspace），files 列表需调用 API
- **SSE 事件已移除**: `diff_meta` 不再通过 SSE 推送
- **包依赖**: `@ftre/renderer` 使用 `@ftre/ui` 的 `DiffSummaryCard` / `InlineDiffView`
- **样式配置**: 通过 Tailwind 类名直接控制
- **DiffEditor 清理**: 关闭 diff tab 时需确保 Monaco DiffEditor 正确清理
- **空 diff 不展示**: 当 `diffLines` 为空数组时，不应渲染 diff 视图

## 已知问题

### MonacoDiffViewer 无语法高亮
**位置**: `packages/editor/src/store/editor-store.ts` 中 `addDiff` 函数
**根因**: 创建 diff 虚拟 tab 时 `language` 被硬编码为 `"plaintext"`

### InlineDiffView 行号溢出
**位置**: `packages/ui/src/components/diff-summary/DiffSummaryCard.tsx` 中 `DiffLineRow` 组件
**问题**: 行号宽度固定为 `w-[42px]`，三位数行号可能溢出

### InlineDiffView 无语法高亮
**位置**: `packages/ui/src/components/diff-summary/DiffSummaryCard.tsx`
**问题**: 代码内容直接渲染为纯文本，仅有增删行背景色
