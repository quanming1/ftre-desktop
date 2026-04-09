# Diff View (差异对比视图)

> Diff 预览视图，用于展示代码变更对比，支持并排/内联模式切换，提供"跳转到源文件"等功能。

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/editor/src/ui/DiffBar.tsx` | Diff 工具栏，显示变更统计和操作按钮 |
| `packages/editor/src/ui/MonacoDiffViewer.tsx` | Monaco DiffEditor 封装，渲染差异对比 |
| `packages/renderer/src/features/editor/EditorArea.tsx` | 集成 DiffBar 和 MonacoDiffViewer，管理 diff 状态 |

## 数据流

### DiffEntry 数据结构
```typescript
interface DiffEntry {
  id: string;
  tabPath: string;      // 虚拟路径 ftre://diff/{id}
  filePath: string;     // 实际文件路径
  original: string;     // 原始内容
  modified: string;     // 修改后内容
  language: string;
}
```

### 业务流程

**打开 Diff 视图**：
1. 创建 DiffEntry → 添加到 `pendingDiffs` 列表
2. `openFile({ path: diffEntry.tabPath, isDiff: true })`
3. EditorArea 检测到 `isDiff` 渲染 DiffBar + MonacoDiffViewer

**接受变更**：
DiffBar:onAccept → writeFile → markSaved(filePath) → rejectDiff(id)

**拒绝/关闭变更**：
DiffBar:onReject/onClose → rejectDiff(id) → 关闭 diff tab

**跳转到源文件**：
DiffBar:onOpenSourceFile → openFile(filePath) → rejectDiff(id)

## 设计决策

- **虚拟路径**：Diff tab 使用 `ftre://diff/{id}` 虚拟路径，避免与实际文件冲突
- **tabPath vs filePath**：tabPath 用于编辑器标签页标识，filePath 指向实际文件
- **渲染条件**：EditorArea 通过 `isDiff` 标志和 `pendingDiffs` 查找决定是否渲染 diff 组件

## 注意事项

- **自定义事件陷阱**：旧代码使用 `ftre:open-file` 自定义事件，但无监听者导致功能失效。应直接调用 store 方法
- **DiffEditor 清理**：关闭 diff tab 时需确保 Monaco DiffEditor 正确清理，避免内存泄漏
- **语言映射**：MonacoDiffViewer 内置 `typescriptreact→typescript` 等语言映射
