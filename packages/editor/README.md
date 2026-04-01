# @ftre/editor

> 编辑器核心包 — Monaco Editor 的独立封装与状态管理

## 📖 历史

`@ftre/editor` 包诞生于 FTRE Desktop 项目的架构重构过程。最初，所有编辑器相关代码都耦合在 `@ftre/renderer` 包中，包括：

- Monaco Editor 组件
- 编辑器状态管理 (Zustand store)
- 文件打开/保存逻辑
- 标签栏和面包屑导航
- 主题注册

随着项目规模增长，这种耦合带来了以下问题：

1. **业务层与编辑器运行时耦合** — 难以独立优化 Monaco 性能
2. **竞态问题难定位** — 文件打开链路涉及多个模块，状态同步复杂
3. **难以复用** — 编辑器能力无法被其他应用使用

2024 年，我们启动了编辑器独立包拆分计划，分 5 个阶段渐进迁移：

- **Phase 1**: 迁移 `editorCore` 非响应式内核
- **Phase 2**: 迁移 `saveFile` 和 `HostBridge` 运行时管道
- **Phase 3**: 迁移 Monaco UI 组件
- **Phase 4**: 迁移 TabBar 和 Breadcrumb 导航组件
- **Phase 5**: 收口 Editor Store 状态管理

现在，`@ftre/editor` 是一个完全独立的编辑器包，通过 `HostBridge` 和 `EditorStoreHost` 接口与宿主应用解耦。

## 🎯 定位

`@ftre/editor` 是一个**框架无关**的编辑器核心库，设计目标：

- **独立性** — 不依赖宿主应用的 store 或 IPC 实现
- **可复用性** — 可被任何 React 应用集成
- **高性能** — Monaco 生命周期和缓存策略完全可控
- **类型安全** — 完整的 TypeScript 类型定义

## 🏗 架构

```
@ftre/editor/
├── core/           # 非响应式内核
│   └── editor-core.ts
├── runtime/        # 运行时管道
│   ├── host-bridge.ts
│   └── save-file.ts
├── store/          # 状态管理
│   ├── types.ts
│   └── editor-store.ts
├── ui/             # React 组件
│   ├── MonacoEditor.tsx
│   ├── MonacoDiffViewer.tsx
│   ├── DiffBar.tsx
│   ├── TabBar.tsx
│   ├── Breadcrumb.tsx
│   ├── file-icons.ts
│   └── theme-registry.ts
└── utils/          # 工具函数
    ├── path-utils.ts
    └── breadcrumb-utils.ts
```

### 核心模块

#### `@ftre/editor/core`

非响应式编辑器内核，使用原生 `Map` 管理数据，不触发 React 渲染：

```typescript
import { editorCore } from "@ftre/editor/core";

// 内容缓存
editorCore.setContent(path, content);
editorCore.setDiskContent(path, content);
editorCore.isDirty(path);

// Monaco 实例注册
editorCore.registerInstance(path, editor);
editorCore.getInstance(path);

// 视图状态 (scroll/cursor/selections)
editorCore.saveViewState(path, state);
editorCore.getViewState(path);
```

#### `@ftre/editor/runtime`

运行时管道，通过 `HostBridge` 与宿主解耦：

```typescript
import { registerHostBridge, saveFile } from "@ftre/editor/runtime";

// 宿主注册桥接实现
registerHostBridge({
  readFile: (path) => window.desktop.fs.readFile(path),
  writeFile: (path, content) => window.desktop.fs.writeFile(path, content),
  // ...
});

// 保存文件
await saveFile(path, name, () => editor.getValue());
```

#### `@ftre/editor/store`

状态管理核心，提供工厂函数与任何状态库集成：

```typescript
import { 
  createEditorActions, 
  createInitialEditorState,
  registerEditorStoreHost 
} from "@ftre/editor/store";

// 注册宿主
registerEditorStoreHost({
  readFile: (path) => fs.readFile(path),
  writeFile: (path, content) => fs.writeFile(path, content),
  storageGet: (key) => localStorage.getItem(key),
  storageSet: (key, value) => localStorage.setItem(key, value),
});

// 与 Zustand 集成
const useEditor = create((set, get) => ({
  ...createInitialEditorState(),
  ...createEditorActions(set, get),
}));
```

#### `@ftre/editor/ui`

Props-based React 组件，不直接依赖任何 store：

```typescript
import { MonacoEditor, TabBar, Breadcrumb } from "@ftre/editor/ui";

// MonacoEditor 通过 HostBridge 获取宿主能力
<MonacoEditor file={file} minimapEnabled={true} />

// TabBar 通过 props 接收所有依赖
<TabBar
  groups={groups}
  activeGroupId={activeGroupId}
  setActive={setActive}
  closeFile={closeFile}
  // ...
/>
```

## 📦 导出结构

```typescript
// 主入口
import { editorCore, saveFile, MonacoEditor, ... } from "@ftre/editor";

// 子路径导入
import { editorCore } from "@ftre/editor/core";
import { saveFile, registerHostBridge } from "@ftre/editor/runtime";
import { MonacoEditor, TabBar, Breadcrumb } from "@ftre/editor/ui";
import { createEditorActions, type EditorStore } from "@ftre/editor/store";
import { workspaceHash, parseBreadcrumbSegments } from "@ftre/editor/utils";
```

## 🔌 宿主集成

宿主应用需要实现两个接口：

### HostBridge (运行时)

```typescript
interface HostBridge {
  // 文件系统
  readFile(path: string): Promise<{ content: string; language: string; error?: string }>;
  writeFile(path: string, content: string): Promise<{ success: boolean; error?: string }>;
  showSaveDialog(opts?: { defaultName?: string }): Promise<{ path: string | null }>;

  // 编辑器状态
  openFile(meta: { path: string; name: string; language: string; content: string }): void;
  closeFile(path: string): void;
  markSaved(path: string): void;
  hydrateFileContent(path: string, content: string, language: string): void;
  setModified(path: string, modified: boolean): void;
  setFileLanguage(path: string, language: string): void;

  // Chat 集成
  addUserMessage(message: string): void;
  getActiveFile(): string | null;
  getMinimapEnabled(): boolean;

  // 通知
  notifyError(message: string): void;
}
```

### EditorStoreHost (状态持久化)

```typescript
interface EditorStoreHost {
  readFile(path: string): Promise<{ content: string; language: string; error?: string }>;
  writeFile(path: string, content: string): Promise<{ success: boolean; error?: string }>;
  storageGet(key: string): string | null;
  storageSet(key: string, value: string): void;
}
```

## 🛠 开发

```bash
# 类型检查
pnpm --filter @ftre/editor build

# 监听模式
pnpm --filter @ftre/editor dev
```

## 📄 许可

私有包，仅供 FTRE Desktop 项目内部使用。