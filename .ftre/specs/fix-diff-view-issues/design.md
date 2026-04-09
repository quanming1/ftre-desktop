# 技术设计：修复 Diff View 相关问题

> **架构概要：** 修复 DiffBar "跳转到源文件"功能，添加缺失的事件监听；优化 DiffBar UI 样式

## 涉及文件

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| 修改 | `packages/renderer/src/features/editor/EditorArea.tsx` | 修复 handleOpenSourceFile 逻辑 |
| 修改 | `packages/editor/src/ui/DiffBar.tsx` | 优化 UI 样式 |
| 审查 | `packages/editor/src/ui/MonacoDiffViewer.tsx` | 检查是否有其他问题 |

## 现有代码意图分析

### 问题 1：跳转到源文件无效

**根因分析**：

EditorArea.tsx 中的 `handleOpenSourceFile` 函数：
```typescript
const handleOpenSourceFile = useCallback((filePath: string) => {
  window.dispatchEvent(
    new CustomEvent("ftre:open-file", { detail: { path: filePath } }),
  );
}, []);
```

这个函数派发了 `ftre:open-file` 自定义事件，但**项目中没有任何地方监听这个事件**！

**修复方案**：

不使用自定义事件，直接调用 editor store 的方法打开文件：
```typescript
const handleOpenSourceFile = useCallback(async (filePath: string) => {
  // 1. 读取文件内容
  const result = await window.desktop.fs.readFile(filePath);
  if (result.error) return;
  
  // 2. 打开源文件
  useEditor.getState().openFile({
    path: filePath,
    name: filePath.split(/[\\/]/).pop() ?? filePath,
    language: result.language,
    content: result.content,
  });
  
  // 3. 关闭 diff（可选，或者让用户手动关闭）
  useEditor.getState().rejectDiff(filePath);
}, []);
```

### 问题 2：DiffBar UI 样式

**当前样式问题**：
- 整体视觉层次不够清晰
- 可以优化颜色对比度和间距

**优化方向**：
- 调整背景色和边框
- 优化统计数字的样式
- 增强按钮的悬停效果

## 接口设计

### editor store 相关方法（已存在）

```typescript
interface EditorActions {
  // 打开文件
  openFile: (file: Omit<OpenFile, "modified" | "pinned" | "loaded">) => void;
  // 拒绝 diff（关闭 diff tab）
  rejectDiff: (filePath: string) => void;
}
```

## 与现有逻辑的关系

```
用户点击"打开源文件"按钮
    ↓
DiffBar 调用 onOpenSourceFile(diff.filePath)
    ↓
EditorArea.handleOpenSourceFile
    ↓
1. 读取文件内容 (IPC: fs:readFile)
2. 调用 useEditor.getState().openFile()
3. 可选：关闭 diff
    ↓
编辑器显示源文件
```
