# Editor 重构：仿照 VSCode 三层架构

## 目标

完全仿照 VSCode 的编辑器架构，从零重构 ftre 的编辑器模块。

## VSCode 三层架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Layer 1: Model Service                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ModelService (全局单例)                                              │   │
│  │ - models: Map<URI, ITextModel>                                       │   │
│  │ - createModel(value, language, uri)                                  │   │
│  │ - getModel(uri): ITextModel | null                                   │   │
│  │ - destroyModel(uri)                                                  │   │
│  │                                                                       │   │
│  │ ITextModel (Monaco 原生)                                             │   │
│  │ - 内容、语言、undo/redo 栈                                           │   │
│  │ - getAlternativeVersionId() — 用于 dirty 判断                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↑
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Layer 2: TextFileEditorModel                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ TextFileEditorModelManager (全局单例)                                │   │
│  │ - models: Map<URI, TextFileEditorModel>                              │   │
│  │ - resolve(uri, options): TextFileEditorModel                         │   │
│  │ - get(uri): TextFileEditorModel | undefined                          │   │
│  │ - 监听文件变化，自动 reload                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      ↓                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ TextFileEditorModel (每个文件一个)                                   │   │
│  │                                                                       │   │
│  │ 状态:                                                                 │   │
│  │ - dirty: boolean                                                      │   │
│  │ - bufferSavedVersionId: number                                        │   │
│  │ - inConflictMode / inOrphanMode / inErrorMode                        │   │
│  │                                                                       │   │
│  │ 方法:                                                                 │   │
│  │ - resolve(): 从磁盘加载                                               │   │
│  │ - save(): 保存到磁盘                                                  │   │
│  │ - revert(): 放弃修改                                                  │   │
│  │ - isDirty(): versionId !== bufferSavedVersionId                      │   │
│  │                                                                       │   │
│  │ 事件:                                                                 │   │
│  │ - onDidChangeContent                                                  │   │
│  │ - onDidChangeDirty                                                    │   │
│  │ - onDidSave / onDidRevert                                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ↑
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Layer 3: EditorPane                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ EditorPanes (每个 EditorGroup 一个)                                  │   │
│  │ - editorPanes: EditorPane[]  // 按类型复用                           │   │
│  │ - activeEditorPane: EditorPane | null                                │   │
│  │                                                                       │   │
│  │ openEditor(input, options):                                          │   │
│  │   1. descriptor = getEditorPaneDescriptor(input)                     │   │
│  │   2. pane = doInstantiateEditorPane(descriptor)  // 按类型复用       │   │
│  │   3. pane.setInput(input, options)               // 切换内容         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      ↓                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ TextCodeEditor (EditorPane 实现)                                     │   │
│  │ - editorControl: CodeEditorWidget                                    │   │
│  │                                                                       │   │
│  │ setInput(input):                                                      │   │
│  │   model = await input.resolve()                                       │   │
│  │   this.editorControl.setModel(model.textEditorModel)                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      ↓                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ CodeEditorWidget (Monaco Editor 封装)                                │   │
│  │ - setModel(model): 切换显示的 ITextModel                             │   │
│  │ - saveViewState() / restoreViewState()                               │   │
│  │ - 不销毁 DOM，只换 model                                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## ftre 实现映射

| VSCode | ftre | 说明 |
|--------|------|------|
| `ModelService` | `ModelService` | 全局 ITextModel 管理 |
| `TextFileEditorModel` | `TextFileModel` | 文件状态机 + dirty |
| `TextFileEditorModelManager` | `TextFileModelManager` | 管理所有 TextFileModel |
| `EditorPanes` | `EditorPanes` | 每个 Group 一个，按类型复用 |
| `TextCodeEditor` | `TextEditorPane` | 文本编辑器 Pane |
| `CodeEditorWidget` | `CodeEditorWidget` | Monaco Editor 封装 |
| `EditorInput` | `EditorInput` | Tab 的数据模型 |

## 关键设计决策

### 1. Dirty 判断：versionId vs hash

**采用 VSCode 的 versionId 方案**

```typescript
class TextFileModel {
  private bufferSavedVersionId: number;
  
  isDirty(): boolean {
    return this.model.getAlternativeVersionId() !== this.bufferSavedVersionId;
  }
  
  // 保存后更新
  markSaved(): void {
    this.bufferSavedVersionId = this.model.getAlternativeVersionId();
  }
}
```

优点：
- Undo 回到保存点自动变 clean
- 无需计算 hash，性能更好

### 2. EditorPane 按类型复用

**每个 EditorGroup 只需 1-2 个 Pane**

```typescript
class EditorPanes {
  private editorPanes: EditorPane[] = [];  // text, diff, settings...
  
  private doInstantiateEditorPane(descriptor: EditorPaneDescriptor): EditorPane {
    // 查找同类型的已有 Pane
    const existing = this.editorPanes.find(p => descriptor.describes(p));
    if (existing) return existing;
    
    // 创建新的
    const pane = descriptor.instantiate();
    this.editorPanes.push(pane);
    return pane;
  }
}
```

切换 tab 时：
```typescript
async openEditor(input: EditorInput) {
  const pane = this.doInstantiateEditorPane(descriptor);
  await pane.setInput(input);  // 只切换内容，不销毁 Pane
}
```

### 3. Model 生命周期

**Model 由 TextFileModelManager 管理，不随 Tab 关闭**

```typescript
class TextFileModelManager {
  private models = new Map<string, TextFileModel>();
  
  async resolve(uri: string): Promise<TextFileModel> {
    let model = this.models.get(uri);
    if (!model) {
      model = new TextFileModel(uri);
      await model.resolve();
      this.models.set(uri, model);
    }
    return model;
  }
  
  // Tab 关闭时检查是否需要销毁
  maybeDispose(uri: string): void {
    if (noTabReferences(uri) && !isDirty(uri)) {
      this.models.get(uri)?.dispose();
      this.models.delete(uri);
    }
  }
}
```

### 4. ViewState 保存

**每个 Tab 保存自己的 ViewState**

```typescript
class TextEditorPane {
  private viewStateMap = new Map<string, ICodeEditorViewState>();
  
  async setInput(input: EditorInput) {
    // 保存旧的 viewState
    if (this.input) {
      const state = this.editor.saveViewState();
      this.viewStateMap.set(this.input.uri, state);
    }
    
    // 切换 model
    const model = await input.resolve();
    this.editor.setModel(model.textEditorModel);
    
    // 恢复新的 viewState
    const viewState = this.viewStateMap.get(input.uri);
    if (viewState) {
      this.editor.restoreViewState(viewState);
    }
    
    this.input = input;
  }
}
```

## 文件结构

```
packages/editor/src/
├── core/
│   ├── model-service.ts          # ModelService: ITextModel 管理
│   ├── text-file-model.ts        # TextFileModel: 文件状态机
│   ├── text-file-model-manager.ts # TextFileModelManager
│   └── types.ts
├── panes/
│   ├── editor-panes.ts           # EditorPanes: 按类型复用
│   ├── editor-pane.ts            # EditorPane 基类
│   ├── text-editor-pane.ts       # TextEditorPane: 文本编辑器
│   └── diff-editor-pane.ts       # DiffEditorPane
├── widget/
│   ├── code-editor-widget.ts     # CodeEditorWidget: Monaco 封装
│   └── diff-editor-widget.ts
├── input/
│   ├── editor-input.ts           # EditorInput 基类
│   ├── file-editor-input.ts      # FileEditorInput
│   └── diff-editor-input.ts
└── index.ts
```

## 迁移步骤

### Phase 1: Model 层

1. 实现 `ModelService` — 管理 ITextModel
2. 实现 `TextFileModel` — 文件状态机 + dirty (versionId)
3. 实现 `TextFileModelManager` — 管理所有 TextFileModel

### Phase 2: Widget 层

4. 实现 `CodeEditorWidget` — 封装 Monaco，支持 setModel
5. 简化 `SlotPool` — 只负责 DOM 容器管理

### Phase 3: Pane 层

6. 实现 `EditorPane` 基类
7. 实现 `TextEditorPane` — 持有 CodeEditorWidget
8. 实现 `EditorPanes` — 按类型复用

### Phase 4: Input 层

9. 实现 `EditorInput` 基类
10. 实现 `FileEditorInput` — 关联 TextFileModel

### Phase 5: 集成

11. 重构 `editor-store.ts` — 使用新架构
12. 重构 `EditorArea.tsx` — 使用 EditorPanes
13. 删除旧代码 (`editor-core.ts`, `editor-manager.ts`, `Document`, etc.)

## 关键代码参考

### TextFileModel (参考 textFileEditorModel.ts:615-639)

```typescript
private onModelContentChanged(model: ITextModel): void {
  if (model.getAlternativeVersionId() === this.bufferSavedVersionId) {
    // Undo 回到保存点
    this.setDirty(false);
    this._onDidRevert.fire();
  } else {
    this.setDirty(true);
  }
  this._onDidChangeContent.fire();
}
```

### EditorPanes 按类型复用 (参考 editorPanes.ts:394-407)

```typescript
private doInstantiateEditorPane(descriptor: IEditorPaneDescriptor): EditorPane {
  const existingEditorPane = this.editorPanes.find(
    editorPane => descriptor.describes(editorPane)
  );
  if (existingEditorPane) {
    return existingEditorPane;
  }
  
  const editorPane = this._register(descriptor.instantiate(this.instantiationService));
  this.editorPanes.push(editorPane);
  return editorPane;
}
```

### CodeEditorWidget.setModel (参考 codeEditorWidget.ts:506-548)

```typescript
public setModel(model: ITextModel | null): void {
  if (this._modelData?.model === model) return;
  
  this._onWillChangeModel.fire({ oldModelUrl, newModelUrl });
  
  const detachedModel = this._detachModel();
  this._attachModel(model);
  
  this._onDidChangeModel.fire({ oldModelUrl, newModelUrl });
}
```
