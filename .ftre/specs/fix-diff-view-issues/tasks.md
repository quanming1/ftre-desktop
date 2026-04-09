# 任务清单：修复 Diff View 相关问题

> **目标：** 修复 Diff 预览视图的多个问题
> **技术栈：** React, TypeScript, Monaco Editor, Tailwind CSS
> **并行策略：** Task 1-3 可并行执行

---

## Task 1: 修复"跳转到源文件"功能 [可并行]

**文件：** `packages/renderer/src/features/editor/EditorArea.tsx`

### 问题根因

`handleOpenSourceFile` 函数派发了 `ftre:open-file` 自定义事件，但项目中**没有任何地方监听这个事件**。

### 修复方案

直接调用 editor store 的方法打开文件，而不是使用自定义事件。

### 实现步骤

1. 找到 `handleOpenSourceFile` 函数（约第 178-183 行）

2. 修改实现：

```typescript
// 修改前
const handleOpenSourceFile = useCallback((filePath: string) => {
  // 打开源文件
  window.dispatchEvent(
    new CustomEvent("ftre:open-file", { detail: { path: filePath } }),
  );
}, []);

// 修改后
const handleOpenSourceFile = useCallback(async (filePath: string) => {
  try {
    // 1. 读取文件内容
    const result = await window.desktop.fs.readFile(filePath);
    if (result.error) {
      console.error("Failed to read file:", result.error);
      return;
    }

    // 2. 关闭 diff tab
    useEditor.getState().rejectDiff(filePath);

    // 3. 打开源文件
    useEditor.getState().openFile({
      path: filePath,
      name: filePath.split(/[\\/]/).pop() ?? filePath,
      language: result.language,
      content: result.content,
    });
  } catch (error) {
    console.error("Failed to open source file:", error);
  }
}, []);
```

### 验证

1. 运行类型检查：`cd packages/renderer && pnpm typecheck`
2. 手动测试：
   - 打开一个 diff 视图
   - 点击 DiffBar 的"打开源文件"按钮（FileText 图标）
   - 预期：diff tab 关闭，源文件在编辑器中打开

---

## Task 2: 优化 DiffBar UI 样式 [可并行]

**文件：** `packages/editor/src/ui/DiffBar.tsx`

### 优化目标

- 提升视觉层次感
- 优化颜色对比度
- 增强交互反馈

### 实现步骤

审查并优化以下样式：

1. **容器样式**（第 55 行）：
   - 当前：`bg-elevated/90 border-b border-border`
   - 考虑调整背景色、边框、内边距

2. **统计数字样式**（第 70-81 行）：
   - 当前：`text-green-400 bg-green-500/10 border border-green-500/25`
   - 考虑调整颜色饱和度、边框样式

3. **按钮样式**（第 89-108 行）：
   - 当前：`hover:bg-white/6`
   - 考虑增强悬停效果

4. **工具名称样式**（第 84-86 行）：
   - 当前：`text-t-muted` / `text-t-primary`
   - 考虑调整信息层次

### 参考设计

可参考 VSCode 的 diff 视图工具栏样式。

### 验证

1. 运行构建：`cd packages/editor && pnpm build`
2. 视觉检查：启动应用，打开 diff 视图，检查样式是否美观

---

## Task 3: 排查 MonacoDiffViewer 其他问题 [可并行]

**文件：** `packages/editor/src/ui/MonacoDiffViewer.tsx`

### 检查清单

1. **差异内容显示**：
   - [ ] original 和 modified 内容是否正确传入
   - [ ] 语言高亮是否正确

2. **side-by-side/inline 模式切换**：
   - [ ] `renderSideBySide` prop 是否正确传递
   - [ ] 切换时是否有 UI 闪烁

3. **自动跳转到第一个 diff**：
   - [ ] `onDidUpdateDiff` 监听是否正常工作
   - [ ] `revealLineInCenter` 是否正确执行

4. **组件卸载清理**：
   - [ ] model dispose 逻辑是否正确
   - [ ] 是否有内存泄漏风险

5. **性能**：
   - [ ] 大文件时是否有性能问题
   - [ ] `automaticLayout: true` 是否会导致频繁重排

### 输出

- 列出发现的问题
- 如果有问题，直接修复

---

## Task 4: Code Review [依赖 Task 1-3]

**检查清单**：

- [ ] Task 1 的修复是否正确实现
- [ ] Task 2 的样式优化是否美观
- [ ] Task 3 是否发现并修复了其他问题
- [ ] 类型检查通过：`cd packages/renderer && pnpm typecheck`
- [ ] 编辑器包构建通过：`cd packages/editor && pnpm build`
