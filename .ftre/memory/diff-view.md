# Diff View (差异对比视图)

> 差异对比存在两套实现：编辑器内使用 Monaco DiffEditor，Chat 消息列表中使用自研 DiffSummaryCard。

## 核心文件

### 编辑器 Diff (Monaco)
| 文件 | 职责 |
|------|------|
| `packages/editor/src/ui/DiffBar.tsx` | Diff 工具栏，显示变更统计和操作按钮 |
| `packages/editor/src/ui/MonacoDiffViewer.tsx` | Monaco DiffEditor 封装，渲染差异对比 |
| `packages/editor/src/ui/themes/darcula.ts` | Monaco Darcula 主题定义 |
| `packages/renderer/src/features/editor/EditorArea.tsx` | 集成 DiffBar 和 MonacoDiffViewer，管理 diff 状态 |

### Chat Diff (自研组件)
| 文件 | 职责 |
|------|------|
| `packages/renderer/src/features/chat/diff/DiffView.tsx` | Diff 核心算法：解析、比较、分段 |
| `packages/ui/src/components/diff-summary/DiffSummaryCard.tsx` | 自研 diff 卡片组件，纯 CSS 样式 |
| `packages/renderer/src/features/chat/ToolCallCard.tsx` | edit tool 卡片，使用 DiffSummaryCard 展示 diff |

## 依赖

**无额外依赖** - diff 算法内联在 renderer 包中，UI 组件纯 CSS 实现。

## 已废弃的依赖

```bash
# 以下依赖已移除
npm uninstall react-diff-viewer-continued prism-react-renderer
```

移除原因：
- `prism-react-renderer@2.4.1` 与 React 19 不兼容（`useCallback` null 错误）
- `react-diff-viewer-continued` 样式不够灵活，用户反馈"丑"
- 尝试提取 diff 算法到 `@ftre/shared` 后**完全回退**，保持原有架构

## DiffSummaryCard 架构

### 数据源
- unified diff 文本（后端 git diff 输出）
- 解析函数 `parseUnifiedDiffLines()` 转为 `DiffLine[]` 数组

### 渲染流程
```
unified diff text
  ↓ parseUnifiedDiffLines
DiffLine[] (type: ctx|del|add|hunk)
  ↓ 按类型渲染
纯 CSS 样式 diff 行
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

### DiffLine (renderer)
```typescript
type DiffLineType = "ctx" | "del" | "add" | "hunk";

interface DiffLine {
  type: DiffLineType;
  text: string;
  lineNo: number | null;
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
**DiffSummaryCard**:
- 数据源: unified diff 文本
- 解析: `parseUnifiedDiffLines` 转为 `DiffLine[]`
- 渲染: 纯 CSS 样式，根据 `type` 字段应用不同颜色和背景

## Diff 核心函数

位于 `packages/renderer/src/features/chat/diff/DiffView.tsx`：

```typescript
// 解析 unified diff 文本
export function parseUnifiedDiffLines(diffText: string): DiffLine[]

// 从文件路径检测语言（用于 Monaco 编辑器）
export function getLanguage(filePath: string): string

// LCS 算法计算两行文本的差异
export function computeDiffLines(oldStr: string, newStr: string): DiffLine[]
```

## 设计决策

- **Chat Diff 选型**: 自研实现，放弃 `react-diff-viewer-continued`
  - 原因: React 19 兼容性问题、样式不够灵活
  - 方案: 纯 CSS + 内联 diff 算法（位于 renderer 包）
- **不提取到 shared 包**: 
  - 原因: 避免引入不必要的依赖复杂度，当前架构已满足需求
  - 历史: 曾尝试提取到 `packages/shared/src/diff.ts`，后完全回退
- **样式方案**: Tailwind CSS 纯样式
  - 原因: 无需额外依赖，与现有设计系统一致
- **编辑器 Diff**: 继续使用 Monaco DiffEditor
  - 原因: 功能完善，与编辑器体验一致

## 注意事项

- **依赖移除**: `react-diff-viewer-continued` 和 `prism-react-renderer` 已从 `@ftre/ui` 移除
- **样式配置**: 通过 Tailwind 类名直接控制，无需覆盖第三方库样式
- **包依赖**: `@ftre/ui` 不依赖 `@ftre/shared` 获取 diff 算法
- **语言检测**: `getLanguage()` 根据文件扩展名自动检测 30+ 语言
- **自定义事件陷阱**: 旧代码使用 `ftre:open-file` 自定义事件，但无监听者导致功能失效
- **DiffEditor 清理**: 关闭 diff tab 时需确保 Monaco DiffEditor 正确清理
- **React 19 兼容性**: 避免使用 `prism-react-renderer@2.4.1`，存在 Hook 报错
