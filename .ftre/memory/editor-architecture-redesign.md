# 编辑器架构 (VSCode 风格)

> 已完全采用 VSCode 三层架构（Model → Widget → Pane）。旧架构代码（Document + SlotPool）已删除。

**📄 正式设计文档：** `.ftre/specs/editor-vscode-architecture/design.md`

---

## 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Layer 1: Model Service                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ModelService (全局单例)                                              │   │
│  │ - 按 URI 管理所有 ITextModel                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                  ↓ getModel()                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ TextFileModel (文件状态机)                                          │   │
│  │ - 包装 ITextModel                                                   │   │
│  │ - versionId 判断 dirty (Undo 回保存点自动变 clean)                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    getModel()
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Layer 2: Widget Layer                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ CodeEditorWidget (Monaco 封装)                                      │   │
│  │ - 封装 Monaco Editor 实例                                           │   │
│  │ - 支持 setModel() 切换内容                                          │   │
│  │ - 管理 ViewState                                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    this.editorControl
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Layer 3: Pane Layer                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ EditorPanes (按类型复用)                                            │   │
│  │ - 每个 EditorGroup 一个实例                                         │   │
│  │ - 按 EditorPane 类型复用（不是按文件路径）                          │   │
│  │ - 切换 tab 时调用 pane.setInput()                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                  ↓ setInput()                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ TextEditorPane (文本编辑器 Pane)                                    │   │
│  │ - 持有 CodeEditorWidget                                             │   │
│  │ - 处理 FileEditorInput                                              │   │
│  │ - 管理 ViewState 保存/恢复                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 核心文件

### 基础层

| 层级 | 文件 | 职责 | 对标 VSCode |
|------|------|------|-------------|
| Model | `packages/editor/src/core/model-service.ts` | 全局 ITextModel 管理 | `ModelService` |
| Model | `packages/editor/src/core/text-file-model.ts` | 文件状态机 + versionId dirty 判断 | `TextFileEditorModel` |
| Model | `packages/editor/src/core/text-file-model-manager.ts` | 管理所有 TextFileModel | `TextFileEditorModelManager` |
| Widget | `packages/editor/src/widget/code-editor-widget.ts` | Monaco Editor 封装，支持 setModel | `CodeEditorWidget` |
| Pane | `packages/editor/src/panes/editor-pane.ts` | EditorPane 基类 | `EditorPane` |
| Pane | `packages/editor/src/panes/text-editor-pane.ts` | 文本编辑器 Pane 实现 | `TextCodeEditor` |
| Pane | `packages/editor/src/panes/editor-panes.ts` | 按类型复用 EditorPane | `EditorPanes` |
| Input | `packages/editor/src/input/editor-input.ts` | EditorInput 基类 | `EditorInput` |
| Input | `packages/editor/src/input/file-editor-input.ts` | 文件编辑器 Input | `FileEditorInput` |

### Workbench 层 (EditorGroup)

| 文件 | 职责 | 对标 VSCode |
|------|------|-------------|
| `packages/editor/src/workbench/editorGroup.ts` | 编辑器组管理（打开/关闭/切换） | `EditorGroupView` |
| `packages/editor/src/workbench/editorGroupModel.ts` | 编辑器数据模型 | `EditorGroupModel` |
| `packages/editor/src/workbench/editorMemento.ts` | ViewState 持久化 (LRU + localStorage) | `EditorMemento` |
| `packages/editor/src/workbench/editorPart.ts` | 多组网格布局管理 | `EditorPart` |

### UI 集成层

| 文件 | 职责 |
|------|------|
| `packages/editor/src/ui/EditorGroupPane.tsx` | 单个 Group 的编辑器组件，与 editor-store 集成 |
| `packages/renderer/src/features/editor/EditorArea.tsx` | 主编辑器区域（已迁移到新架构） |
| `packages/renderer/src/hooks/useMonaco.ts` | Monaco 全局实例 hook |

### 运行时层

| 文件 | 职责 |
|------|------|
| `packages/editor/src/runtime/save-file.ts` | 统一保存入口，操作 TextFileModel |
| `packages/editor/src/runtime/host-bridge.ts` | 宿主通信桥接 |

### 状态管理

| 文件 | 职责 |
|------|------|
| `packages/editor/src/store/editor-store.ts` | Zustand store，管理 groups/tabs，操作 ModelManager |

---

## 调用链路

### 打开文件
```
FileEditorInput
  → EditorPanes.openEditor()
  → EditorPanes.doShowEditorPane() (按类型复用)
  → TextEditorPane.setInput()
  → FileEditorInput.resolve()
  → TextFileModelManager.resolve()
  → TextFileModel.resolve()
  → ModelService.createModel()
  → CodeEditorWidget.setModel()
```

### 保存文件
```
TextFileModel.save()
  → fileReader.write() (HostBridge)
  → markSaved() (更新 bufferSavedVersionId)
  → setDirty(false)
  → fire onDidChangeDirty
```

### 切换 Tab
```
EditorPanes.openEditor(newInput)
  → 找到当前 active pane
  → pane.setInput(newInput) (不换 pane！)
  → save 旧 input 的 ViewState
  → CodeEditorWidget.setModel(newModel)
  → restore 新 input 的 ViewState
```

### 关闭 Tab → 清理 ViewState
```
EditorGroup.closeEditor(input)
  → _model.closeEditor(editor)        // 从 model 移除
  → _editorPanes.closeActiveEditor()  // 关闭 pane
  → this._closingEditor = editor      // 标记正在关闭
  → editor.dispose()                  // 触发 onWillDispose
       → editorMemento.onWillDispose  // 清理 ViewState
  → this._closingEditor = undefined   // 清理标记
```

---

## 设计决策

### 1. 用 versionId 判断 Dirty
```typescript
// text-file-model.ts
private bufferSavedVersionId: number = 0;

markSaved(): void {
  this.bufferSavedVersionId = this.textEditorModel.getAlternativeVersionId();
}

get isDirty(): boolean {
  return this.textEditorModel.getAlternativeVersionId() !== this.bufferSavedVersionId;
}
```
- **优点**: Undo 回保存点自动变 clean，性能更好
- **缺点**: 无法检测"改回原样"（修改后 Undo 再修改回来）

### 2. EditorPane 按类型复用
```typescript
// editor-panes.ts
doShowEditorPane(descriptor): EditorPane {
  const existing = this.editorPanes.find(p => descriptor.describes(p));
  if (existing) return existing;  // 复用！
  return this.instantiateEditorPane(descriptor);
}
```
- 每个 Group 只需 1 个 TextEditorPane
- 切换 tab 时不销毁 Pane，只换 Input

### 3. setModel 切换内容
```typescript
// code-editor-widget.ts
setModel(model: ITextModel | null): void {
  this._detachModel();
  this._attachModel(model);
}
```
- 不销毁 CodeEditorWidget，切换更快
- 需要手动管理 ViewState

### 4. EditorInput dispose 触发 ViewState 清理
```typescript
// editorMemento.ts
clearEditorStateOnDispose(resource: string, editor: EditorInput): void {
  const disposable = editor.onWillDispose(() => {
    this.clearEditorState(resource);
    this._editorDisposables?.delete(editor);
  });
  this._editorDisposables.set(editor, disposable);
}

// editorGroup.ts - closeEditor 中调用 dispose
async closeEditor(input: EditorInput): Promise<void> {
  // ... 关闭逻辑 ...
  this._closingEditor = editor;   // 标记防止重复
  editor.dispose();                // 触发 onWillDispose
  this._closingEditor = undefined;
}
```
- **参考 VSCode**: `EditorGroupView.handleOnDidCloseEditor` 中调用 `editor.dispose()`
- **关键点**: 必须在 `closeEditor` 中显式调用 `dispose()`，仅移除 model 不够

### 5. canDispose 检查避免跨组重复 dispose
```typescript
// 参考 VSCode 的 canDispose 机制
handleOnDidCloseEditor(editor: EditorInput) {
  // 检查 editor 是否在其他 group 中仍然打开
  if (this.canDispose(editor)) {
    editor.dispose();  // 安全 dispose
  }
}

private canDispose(editor: EditorInput): boolean {
  // 遍历所有 group，检查 editor 是否在其他地方打开
  for (const group of this.groups) {
    if (group.contains(editor)) return false;
  }
  return true;
}
```
- **场景**: Split view 同一文件在多个 group 中打开
- **问题**: 关闭其中一个 tab 时不能 dispose，否则影响其他 group
- **方案**: 关闭时先 `canDispose()` 检查，只有所有 group 都关闭后才 dispose
- **VSCode 参考**: `editorPart.ts` → `handleOnDidCloseEditor` → `canDispose`

---

## 注意事项

1. **versionId 的局限性**: Undo 回保存点自动变 clean，但无法检测"改回原样"
2. **EditorPane 复用**: 每个 Group 只需 1-2 个 Pane，大大减少 Monaco 实例数量
3. **ViewState 管理**: setModel 不自动保存/光标位置，需手动调用 `saveViewState`/`restoreViewState`
4. **Model 共享**: ModelService 全局按 URI 管理，支持 split view 共享同一文件
5. **FileReader 接口**: `TextFileModelManager` 依赖宿主层实现文件读写
6. **EditorInput dispose 时机**: 关闭 tab 时必须调用 `editor.dispose()` 才能触发 ViewState 清理，仅 `model.closeEditor()` 不够
7. **跨组 Editor 共享**: 同一文件在多个 group 打开时，`canDispose()` 检查必不可少，避免过早 dispose 影响其他 group

---

## 历史版本

### v1: Document + SlotPool 架构（已删除）
- 按路径缓存最多 8 个 Slot
- hash 判断 dirty
- 切换时 detach/attach DOM
- **删除时间**: 架构重构完成后直接删除，无兼容层
- **删除的文件**: `editor-core.ts`, `editor-manager.ts`, `document.ts`, `document-manager.ts`, `slot-pool.ts`, `types.ts`
