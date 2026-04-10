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
| `packages/renderer/src/features/chat/ToolCallCard.tsx` | edit tool 卡片，edit 完成后默认展开 diff |

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

## 已废弃文件

```
packages/renderer/src/features/chat/diff/DiffView.tsx (已删除)
packages/renderer/src/features/chat/diff/index.ts (已删除)
```

删除原因：与 `DiffSummaryCard` 功能重复，统一使用 `@ftre/ui` 包实现。

## DiffSummaryCard 架构

### 数据源
```typescript
interface DiffSummaryCardProps {
  diffLines: DiffLine[];    // 直接传入解析后的 diff 数据
  filePath?: string;        // 可选：用于显示文件路径
}
```

### 渲染流程
```
unified diff text
  ↓ parseUnifiedDiffLines (调用方处理)
DiffLine[]
  ↓ 传入 DiffSummaryCard props
DiffSummaryCard 纯渲染
```

### 样式实现
使用 Tailwind CSS 纯样式渲染，无语法高亮依赖：
```typescript
// 根据行类型应用不同样式
<div className={cn(
  "font-mono text-xs leading-5 whitespace-pre",
  line.type === "add" && "bg-green-500/10 text-green-400",
  line.type === "del" && "bg-red-500/10 text-red-400",
  line.type === "hunk" && "text-yellow-500/70 italic"
)}>
  {line.text}
</div>
```

## 核心数据结构

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
  isCollapsed: boolean;     // 是否折叠
  canCollapse: boolean;     // 是否可折叠
}
```

### DiffStats
```typescript
interface DiffStats {
  segments: number;         // 变更块数
  additions: number;        // 新增行数
  deletions: number;        // 删除行数
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

### Chat Diff
**统一使用 DiffSummaryCard**:
- edit tool 编辑完成后**默认展开**显示 diff
- 调用方使用 `parseUnifiedDiffLines()` 或 `computeDiffLines()` 解析 diff 数据
- 解析结果传入 `InlineDiffView` 或 `DiffSummaryCard` 渲染

## Diff 核心函数

```typescript
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
  onLineClick?: (lineNo: number) => void;  // 点击行号回调
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
- **纯展示组件**: `DiffSummaryCard` / `InlineDiffView` 解耦为纯展示组件
  - 接收 `DiffLine[]` 作为 props
  - 不自行调用 API 加载 diff 数据
  - 导出所有子组件供外部复用
- **默认展开**: edit tool 编辑完成后默认展开 diff 展示
  - 原因：用户需要立即看到修改结果
  - ToolCallCard 中使用 `InlineDiffView` 直接渲染，无需点击"查看 diff"
- **交互控制**: InlineDiffView 提供上下文切换、批量折叠、行号点击等交互
  - 原因：提升 diff 浏览效率，支持不同查看需求
- **编辑器 Diff**: 继续使用 Monaco DiffEditor
  - 原因: 功能完善，与编辑器体验一致

## 已知问题

### MonacoDiffViewer 无语法高亮
**位置**: `packages/editor/src/store/editor-store.ts` 中 `addDiff` 函数
**根因**: 创建 diff 虚拟 tab 时 `language` 被硬编码为 `"plaintext"`
```typescript
// packages/editor/src/store/editor-store.ts addDiff()
const virtualFile: OpenFile = {
  path: diff.tabPath,
  name: `${fileName} (Diff)`,
  language: "plaintext",    // ← 硬编码导致 Monaco DiffEditor 无语法高亮
  content: "",
  // ...
};
```
**修复方向**: 根据 `diff.filePath` 的扩展名推断语言

### InlineDiffView 行号溢出
**位置**: `packages/ui/src/components/diff-summary/DiffSummaryCard.tsx` 中 `DiffLineRow` 组件
**问题**: 行号宽度固定为 `w-[42px]`，当行号为三位数（100+）时可能溢出或重叠
**代码**:
```tsx
<span className="shrink-0 w-[42px] text-right pr-1 ...">
  {line.lineNo}
</span>
```
**修复方向**: 使用 `min-w-[42px]` 或动态计算行号位数

### InlineDiffView 无语法高亮
**位置**: `packages/ui/src/components/diff-summary/DiffSummaryCard.tsx`
**问题**: 代码内容直接渲染为纯文本，仅有增删行的背景色（红/绿），无语法高亮
**代码**:
```tsx
<span className={cn("whitespace-pre pr-4", textClass)}>
  {line.text}  {/* 纯文本，无高亮 */}
</span>
```
**修复方向**: 集成 `prism-react-renderer` 或 Monaco Editor 的轻量高亮模式

## 注意事项

- **包依赖**: `@ftre/renderer` 使用 `@ftre/ui` 的 `DiffSummaryCard` / `InlineDiffView`
- **样式配置**: 通过 Tailwind 类名直接控制，无需覆盖第三方库样式
- **语言检测**: 根据文件扩展名自动检测 30+ 语言
- **DiffEditor 清理**: 关闭 diff tab 时需确保 Monaco DiffEditor 正确清理
