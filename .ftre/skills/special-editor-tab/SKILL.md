---
name: special-editor-tab
description: |
  创建特殊编辑器 Tab 的架构指南（VSCode EditorInput 模式）。
  触发场景：
  - 需要在编辑器区域显示非文件内容（如 Settings、Keybindings、Welcome）
  - 实现类似 VSCode 的虚拟编辑器 Tab
  - 扩展 EditorArea 支持新的 EditorInput 类型
---

# Special Editor Tab 架构

参考 VSCode 的 EditorInput + EditorPane 模式，在 React + Zustand 环境下的简化实现。

## 架构图

```
TitleBar [按钮]
    │ onClick
    ▼
Editor Store
    │ openXxx() → 单例检查 → 创建/聚焦 OpenFile
    │
    │ OpenFile {
    │   path: "ftre://xxx",    // 虚拟 URI
    │   type: "xxx",           // EditorInputType
    │ }
    ▼
EditorArea
    │ 根据 path 分发
    ▼
┌─────────────────────────┐
│ if (path === SETTINGS)  │ → <SettingsPanel />
│ if (path === KEYBINDS)  │ → <KeybindingsPanel />
│ if (path.startsWith("diff:")) │ → <DiffViewer />
│ else                    │ → <ManagedEditor />
└─────────────────────────┘
```

## 核心类型

```typescript
// packages/editor/src/store/types.ts

type EditorInputType = "file" | "settings" | "keybindings" | ...;

interface OpenFile {
  path: string;           // 文件路径或虚拟 URI (ftre://xxx)
  name: string;           // Tab 显示名
  type?: EditorInputType; // 编辑器类型
  // ... 其他字段
}

// 虚拟路径常量
const SETTINGS_PATH = "ftre://settings";
const KEYBINDINGS_PATH = "ftre://keybindings";
```

## 添加新类型的步骤

### 1. 定义类型和路径

```typescript
// packages/editor/src/store/types.ts
export type EditorInputType = "file" | "settings" | "newtype";
export const NEWTYPE_PATH = "ftre://newtype";
```

### 2. 导出

```typescript
// packages/editor/src/store/index.ts
export type { EditorInputType } from "./types";
export { SETTINGS_PATH, NEWTYPE_PATH } from "./types";

// packages/editor/src/index.ts
export type { EditorInputType } from "./store";
export { SETTINGS_PATH, NEWTYPE_PATH } from "./store";
```

### 3. 添加 Store 方法

```typescript
// packages/editor/src/store/editor-store.ts

// EditorActions 接口
openNewType: () => void;

// createEditorActions 实现
openNewType: () => {
  const state = get();

  // 单例检查：遍历所有 group 查找已存在的 tab
  for (const g of state.groups) {
    const existing = g.openFiles.find((f) => f.path === NEWTYPE_PATH);
    if (existing) {
      // 聚焦到已有 tab
      const groups = updateGroup(state.groups, g.id, (group) => ({
        ...group,
        activeFile: NEWTYPE_PATH,
      }));
      set({ groups, activeGroupId: g.id, ...syncTopLevel(groups, g.id) });
      return;
    }
  }

  // 创建新 tab
  const group = getActiveGroup(state);
  const newFile: OpenFile = {
    path: NEWTYPE_PATH,
    name: "NewType",
    language: "newtype",
    content: "",
    modified: false,
    pinned: false,
    loaded: true,
    type: "newtype",
  };

  const groups = updateGroup(state.groups, group.id, (g) => ({
    ...g,
    openFiles: [...g.openFiles, newFile],
    activeFile: NEWTYPE_PATH,
  }));
  set({ groups, ...syncTopLevel(groups, state.activeGroupId) });
},
```

### 4. 排除持久化

```typescript
// packages/editor/src/store/editor-store.ts persist()
openFiles.filter(
  (f) =>
    !f.path.startsWith("diff:") &&
    !f.path.startsWith("untitled:") &&
    !f.path.startsWith("ftre://"),  // 所有虚拟路径都不持久化
)
```

### 5. 创建面板组件

```typescript
// packages/renderer/src/features/newtype/NewTypePanel.tsx
export function NewTypePanel() {
  return (
    <div className="h-full overflow-auto bg-surface">
      {/* 面板内容 */}
    </div>
  );
}

// packages/renderer/src/features/newtype/index.ts
export { NewTypePanel } from "./NewTypePanel";
```

### 6. EditorArea 分发

```typescript
// packages/renderer/src/features/editor/EditorArea.tsx
import { SETTINGS_PATH, NEWTYPE_PATH } from "@/stores/editor";
import { NewTypePanel } from "@/features/newtype";

// 在渲染逻辑中
if (currentFile.path === SETTINGS_PATH) {
  return <SettingsPanel />;
}
if (currentFile.path === NEWTYPE_PATH) {
  return <NewTypePanel />;
}
// ... diff viewer
// ... normal file editor
```

### 7. Tab 图标

```typescript
// packages/editor/src/ui/file-icons.ts
import { NewIcon } from "lucide-react";

export const VIRTUAL_PATH_MAP: Record<string, FileIconResult> = {
  "ftre://settings": { icon: Settings, color: "#9da5b4" },
  "ftre://newtype": { icon: NewIcon, color: "#..." },
};
```

### 8. 入口按钮（可选）

```typescript
// packages/renderer/src/app/TitleBar.tsx
<Tooltip content="NewType" side="bottom">
  <button onClick={() => useEditor.getState().openNewType()}>
    <NewIcon size={14} />
  </button>
</Tooltip>
```

## 关键特性

| 特性 | 实现 |
|------|------|
| 单例模式 | `openXxx()` 先遍历检查是否已存在 |
| 虚拟 URI | `ftre://xxx` 格式，不对应真实文件 |
| 不持久化 | `ftre://` 前缀在 persist() 中被过滤 |
| 专用图标 | `VIRTUAL_PATH_MAP` 映射 |
| 条件渲染 | EditorArea 根据 path 分发组件 |

## 与 VSCode 对比

| VSCode | ftre |
|--------|------|
| `EditorInput` 类继承 | `OpenFile.type` 字段 |
| `EditorPane` 类继承 | React 函数组件 |
| `EditorPaneDescriptor` 注册表 | `if/switch` 条件分发 |
| DI 服务注入 | Zustand store |
| `vscode-settings://` | `ftre://settings` |

简化原则：**类型字段 + 条件渲染**，符合 React 习惯，减少抽象层级。
