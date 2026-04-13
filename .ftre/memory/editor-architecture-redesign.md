# 编辑器架构 (VSCode 风格)

> 已完全采用 VSCode 三层架构（Model → Widget → Pane）。旧架构代码（Document + SlotPool，以及 TextModelService）已彻底删除。

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
| `packages/editor/src/workbench/textModelResolverService.ts` | 文本模型解析服务 | - |

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

### 文件外部变更刷新 (fs:fileChanged)
```
fs:fileChanged event (packages/electron/src/ipc/watcher.ts)
  ↓
EditorArea.tsx onFileChanged 回调
  → getTextModelResolverService().updateContent(path, newContent)
  ↓
TextModelResolverService.updateContent()
  → 更新 Monaco ITextModel 内容
  → fire onDidChangeContent
```

### 状态恢复后点击非 active tab（延迟加载）
```
App 启动 → 从 localStorage restore 编辑器状态
  ↓
所有文件 loaded: false（仅 active 文件会 hydrate）
  ↓
用户点击非 active tab → setActive(path)
  ↓
EditorArea.tsx hydrateFileIfNeeded() effect
  → 检测 loaded === false 且 activeFile === path
  → 调用 fs.readFile() 读取内容
  → hydrateFileContent(path, content) 更新 store
  → loaded: true，编辑器正常显示
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

### 6. ViewState 清理时机选择
```typescript
// 方案对比：

// ❌ 不推荐：依赖 onWillDispose
editor.onWillDispose(() => {
  this.clearEditorState(resource);
});
// 问题：dispose 时机不确定，可能在不需要清理时触发

// ✅ 推荐：在 onWillCloseEditor 时处理
setEditorVisible(visible: boolean, group: IEditorGroup) {
  if (!visible) {
    // 保存 ViewState（文件编辑器保留）
    this.saveViewState();
  }
}

// 或者使用 onWillCloseEditor 回调
onWillCloseEditor(editor: EditorInput) {
  // 关闭时执行清理逻辑
  this.clearEditorState();
}
```
- **VSCode 实践**: 在 `handleOnDidCloseEditor` 或 `setEditorVisible(false)` 时处理 ViewState
- **文件编辑器**: 保留 ViewState 以便重新打开（通过 `tracksDisposedEditorViewState()` 控制）
- **非文件编辑器**: 关闭时可选择清理 ViewState

### 7. 延迟加载策略（loaded 字段）
```typescript
// OpenFile 结构中的 loaded 字段
interface OpenFile {
  path: string;
  name: string;
  language: string;
  content: string;
  modified: boolean;
  pinned: boolean;
  loaded: boolean;  // 是否已加载文件内容
}
```
- **目的**: 避免 App 启动时加载所有历史 tab 的内容
- **策略**: restore 时仅 hydrate active 文件，其他文件标记为 `loaded: false`
- **UI 层处理**: `EditorArea.tsx` 通过 effect 检测未加载的 activeFile 并触发加载
- **实现位置**: `EditorArea.tsx` 中的 `hydrateFileIfNeeded()` 和对应的 `useEffect`

### 8. 延迟加载修复方案（历史文件 tab 一直 loading）

**问题根因**: 状态恢复时只有 activeFile 会被加载，其他 tab 切换到它们时不会自动加载内容

**修复位置**: `packages/renderer/src/features/editor/EditorArea.tsx`

**修复逻辑**:
```typescript
// EditorArea.tsx 添加 hydrateFileIfNeeded effect
useEffect(() => {
  hydrateFileIfNeeded(activeFilePath);
}, [activeFilePath]);

// hydrateFileIfNeeded 实现
async function hydrateFileIfNeeded(filePath: string) {
  if (!filePath) return;
  
  const group = groups.find(g => g.id === activeGroupId);
  const file = group?.openFiles.find(f => f.path === filePath);
  
  // 只有未加载且是当前 active 的文件才加载
  if (!file || file.loaded || activeFile !== filePath) return;
  
  try {
    const result = await window.desktop.fs.readFile(filePath);
    if (!result.error) {
      useEditor.getState().hydrateFileContent(
        filePath, 
        result.content, 
        result.language
      );
    }
  } catch (error) {
    console.error("Failed to hydrate file:", error);
  }
}
```

**关键点**:
- 监听 `activeFile` 变化触发加载
- 检查 `file.loaded === false` 才触发读取
- 通过 `hydrateFileContent()` 更新 store 状态
- 注意：还需处理文件不存在等边界情况

---

## 注意事项

1. **versionId 的局限性**: Undo 回保存点自动变 clean，但无法检测"改回原样"
2. **EditorPane 复用**: 每个 Group 只需 1-2 个 Pane，大大减少 Monaco 实例数量
3. **ViewState 管理**: setModel 不自动保存/光标位置，需手动调用 `saveViewState`/`restoreViewState`
4. **Model 共享**: ModelService 全局按 URI 管理，支持 split view 共享同一文件
5. **FileReader 接口**: `TextFileModelManager` 依赖宿主层实现文件读写
6. **EditorInput dispose 时机**: 关闭 tab 时必须调用 `editor.dispose()` 才能触发 ViewState 清理，仅 `model.closeEditor()` 不够
7. **跨组 Editor 共享**: 同一文件在多个 group 打开时，`canDispose()` 检查必不可少，避免过早 dispose 影响其他 group
8. **ViewState 清理时机陷阱**: 不要依赖 `onWillDispose` 清理 ViewState，应在 `onWillCloseEditor` 或 `setEditorVisible(false)` 时处理
9. **文件编辑器保留 ViewState**: 参考 VSCode `tracksDisposedEditorViewState()`，文件关闭后可选择保留 ViewState 以便快速重新打开
10. **延迟加载陷阱**: App 恢复时非 active tab 显示 Loading... 是正常的，需要在 `EditorArea.tsx` 添加 effect 自动加载未 hydrate 的文件内容。具体实现参考上面的"延迟加载修复方案"

---

## 历史版本

### v2: TextModelService → TextModelResolverService 迁移（已删除）
**删除时间**: 架构重构完成后
**删除的文件**: `packages/editor/src/core/text-model.ts`, `packages/editor/src/core/code-editor.ts`

这两份文件是旧架构残留，与当前 Workbench 层的 `TextModelResolverService` 并行存在，混用会导致：
- edit tool 编辑后编辑器不刷新（旧服务有 isDirty 检查且 model 不在其 Map 中）
- 关闭 Tab 后重开仍是旧内容

**已迁移的使用者**:
- `packages/editor/src/store/editor-store.ts` - refreshFile, closeFile, save, rename, delete
- `packages/editor/src/runtime/save-file.ts` - untitled 文件保存后的 dispose
- `packages/renderer/src/app/main.tsx` - 初始化
- `packages/renderer/src/features/explorer/FileTreeItem.tsx` - 移除预取逻辑
- `packages/renderer/src/services/memory-monitor.ts` - dirty 统计

**API 差异**:
| 旧 (TextModelService) | 新 (TextModelResolverService) | 说明 |
|----------------------|------------------------------|------|
| `getTextModelService()` | `getTextModelResolverService()` | 导入路径不同 |
| `dispose(uri)` | `disposeModel(uri)` | 方法名变化 |
| `disposeAll()` | `disposeAllModels()` | 方法名变化 |
| `has(uri)` | `hasModel(uri)` | 方法名变化 |
| `get(uri)` | `getModel(uri)` | 方法名变化 |

**导出路径变化**:
```typescript
// 旧（已删除）
import { getTextModelService } from "@ftre/editor/core";

// 新
import { getTextModelResolverService } from "@ftre/editor/workbench";
```

**相关 issue**: edit tool 编辑文件后编辑器内容不更新，根因是 `refreshFile` 仍调用旧服务。

---

### v1: Document + SlotPool 架构（已删除）
- 按路径缓存最多 8 个 Slot
- hash 判断 dirty
- 切换时 detach/attach DOM
- **删除时间**: 架构重构完成后直接删除，无兼容层
- **删除的文件**: `editor-core.ts`, `editor-manager.ts`, `document.ts`, `document-manager.ts`, `slot-pool.ts`, `types.ts`
