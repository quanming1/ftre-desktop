# Editor 迁移指南

## 从旧架构迁移到 VSCode 风格新架构

### 架构对比

| 旧架构 | 新架构 | 说明 |
|--------|--------|------|
| `editorCore` | `TextFileModel` | 文件状态管理 |
| `editorManager` | `EditorPanes` + `CodeEditorWidget` | 编辑器实例管理 |
| `Document` + `DocumentManager` | `TextFileModel` + `TextFileModelManager` | 文件生命周期 |
| `SlotPool` | `EditorPanes` (按类型复用) | 编辑器复用策略 |
| `ManagedEditor` | `TextEditorPane` | 文本编辑器组件 |

### 快速开始

#### 1. 初始化

```tsx
import {
  getModelService,
  getTextFileModelManager,
  EditorPanes,
} from "@ftre/editor";
import * as monaco from "monaco-editor";

// 初始化 Model 服务
const modelService = getModelService();
modelService.init(monaco);

// 初始化 TextFileModel 管理器
const modelManager = getTextFileModelManager();
modelManager.init(monaco, {
  read: async (uri: string) => {
    const content = await fs.readFile(uri);
    return { content };
  },
});

// 创建 EditorPanes
const container = document.getElementById("editor-container");
const editorPanes = new EditorPanes(container, monaco);
```

#### 2. 打开文件

```tsx
import { createFileEditorInput } from "@ftre/editor";

// 创建 FileEditorInput
const input = createFileEditorInput("/path/to/file.ts", {
  saveHandler: async (uri, content) => {
    await fs.writeFile(uri, content);
  },
  readHandler: async (uri) => {
    return await fs.readFile(uri);
  },
});

// 打开编辑器
await editorPanes.openEditor(input, {
  preserveFocus: false,
  selection: { startLineNumber: 10, startColumn: 1 },
});
```

#### 3. 监听 dirty 变化

```tsx
modelManager.setEventListeners({
  onDidChangeDirty: (model) => {
    console.log(`File ${model.uri} is ${model.isDirty ? "dirty" : "clean"}`);
  },
  onDidSave: (model) => {
    console.log(`File ${model.uri} saved`);
  },
});
```

#### 4. 保存文件

```tsx
const model = modelManager.get("/path/to/file.ts");
if (model && model.isDirty) {
  const content = model.getContentForSave();
  await fs.writeFile(model.uri, content);
  model.markSaved();
}
```

### 使用 EditorAreaV2 组件

```tsx
import { EditorAreaV2 } from "@ftre/editor";

function MyEditorArea() {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [monacoInstance, setMonacoInstance] = useState<typeof Monaco | null>(null);

  // 加载 Monaco
  useEffect(() => {
    import("monaco-editor").then(setMonacoInstance);
  }, []);

  if (!monacoInstance) return <div>Loading...</div>;

  return (
    <EditorAreaV2
      monaco={monacoInstance}
      activeFilePath={activeFile}
      openFiles={openFiles}
      onSaveFile={async (path, content) => {
        await window.desktop.fs.writeFile(path, content);
      }}
      onReadFile={async (path) => {
        const result = await window.desktop.fs.readFile(path);
        return result.content;
      }}
      onDirtyChange={(path, dirty) => {
        setOpenFiles((files) =>
          files.map((f) =>
            f.path === path ? { ...f, modified: dirty } : f
          )
        );
      }}
      minimapEnabled={true}
    />
  );
}
```

### 核心优势

1. **Dirty 判断用 versionId**
   - Undo 回到保存点自动变 clean
   - 无需计算 hash

2. **EditorPane 按类型复用**
   - 每个 Group 只需 1-2 个 Pane
   - 切换文件只调用 setModel，不销毁 DOM

3. **Model 可被多个 Editor 共享**
   - 同一文件在 split view 中共享 Model
   - 编辑同步、ViewState 独立

4. **清晰的三层架构**
   - Model 层：内容管理
   - Widget 层：UI 封装
   - Pane 层：类型分发

### 逐步迁移策略

1. **Phase 1**：新文件使用新架构 ✅
2. **Phase 2**：重构 EditorArea 使用 EditorAreaNew ✅
3. **Phase 3**：删除旧代码 (editorCore, editorManager, Document, SlotPool)

### 当前状态

已完成：
- `packages/editor/src/core/model-service.ts` — ModelService
- `packages/editor/src/core/text-file-model.ts` — TextFileModel
- `packages/editor/src/core/text-file-model-manager.ts` — TextFileModelManager
- `packages/editor/src/widget/code-editor-widget.ts` — CodeEditorWidget
- `packages/editor/src/panes/editor-pane.ts` — EditorPane 基类
- `packages/editor/src/panes/text-editor-pane.ts` — TextEditorPane
- `packages/editor/src/panes/editor-panes.ts` — EditorPanes
- `packages/editor/src/input/editor-input.ts` — EditorInput 基类
- `packages/editor/src/input/file-editor-input.ts` — FileEditorInput
- `packages/editor/src/ui/EditorGroupPane.tsx` — 集成组件
- `packages/renderer/src/features/editor/EditorAreaNew.tsx` — 新 EditorArea

启用新架构：
```bash
# 在 .env 中设置
VITE_USE_NEW_EDITOR=true
```

或在代码中直接使用：
```tsx
import { EditorAreaNew } from "@/features/editor/EditorAreaNew";
```
