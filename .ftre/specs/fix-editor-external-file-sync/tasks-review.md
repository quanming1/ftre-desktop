# Code Review 任务：编辑器外部文件同步修复

> **目标：** 审查 EditorArea.tsx 的修复变更，并排查项目中是否存在类似的 TextModelService vs TextModelResolverService 混用问题

---

## Part 1: 审查 EditorArea.tsx 变更

### 检查清单

- [ ] **import 语句正确**：确认 `getTextModelResolverService` 已正确导入
- [ ] **file-renamed 处理**：确认调用了 `getTextModelResolverService()` 和 `rename()` 方法
- [ ] **file-deleted 处理**：确认调用了 `disposeModel()` 而非 `dispose()`
- [ ] **save-all 处理**：确认 `getContentForSave()` 的返回值检查是 `!== undefined`
- [ ] **onFileChanged 非 dirty 分支**：确认调用了正确的服务
- [ ] **onFileChanged dirty 分支**：确认使用 `updateContent()` 替代了直接操作 model
- [ ] **类型检查通过**：运行 `cd packages/renderer && pnpm typecheck`

---

## Part 2: 排查类似问题

### 排查目标

搜索项目中所有使用 `getTextModelService` 的地方，检查是否应该使用 `getTextModelResolverService`。

### 排查逻辑

1. **如果代码涉及 Monaco 编辑器的 model 操作**（如更新内容、检查 dirty 状态、保存等）：
   - 应该使用 `getTextModelResolverService`（新架构，Monaco 实际使用的）
   
2. **如果代码是旧架构的遗留代码且不涉及 Monaco**：
   - 可能需要迁移或清理

### 需要搜索的模式

```
getTextModelService
TextModelService
```

### 重点排查的文件/目录

- `packages/renderer/src/` - 渲染进程代码
- `packages/editor/src/store/` - 编辑器状态管理
- `packages/editor/src/ui/` - UI 组件

### 排查结果模板

对于每个发现的使用点，记录：

| 文件 | 行号 | 使用场景 | 是否需要修复 | 修复建议 |
|------|------|----------|--------------|----------|
| ... | ... | ... | ... | ... |

---

## Part 3: 输出报告

完成审查后，输出以下内容：

1. **EditorArea.tsx 变更审查结果**：通过/问题列表
2. **类似问题排查结果**：发现的其他需要修复的地方
3. **如果发现问题**：直接修复，或说明修复建议
