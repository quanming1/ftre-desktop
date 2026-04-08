# Settings Tab (设置面板)

> 参考 VSCode 的 EditorInput 模式实现的 Settings Tab

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/editor/src/store/types.ts` | `EditorInputType` 和 `SETTINGS_PATH` 定义 |
| `packages/editor/src/store/editor-store.ts` | `openSettings()` 方法实现 |
| `packages/renderer/src/app/TitleBar.tsx` | 右上角设置按钮入口 |
| `packages/renderer/src/features/editor/EditorArea.tsx` | 根据 path 分发渲染 SettingsPanel |
| `packages/renderer/src/features/settings/SettingsPanel.tsx` | Settings 面板 UI 组件 |
| `packages/editor/src/ui/file-icons.ts` | `VIRTUAL_PATH_MAP` 支持虚拟路径图标 |

## 架构设计

基于 VSCode 的 EditorInput + EditorPane 模式简化实现：

### EditorInputType
```typescript
// packages/editor/src/store/types.ts
export type EditorInputType = "file" | "settings";

export interface OpenFile {
  path: string;
  name: string;
  type?: EditorInputType;  // 新增
  // ...
}

export const SETTINGS_PATH = "ftre://settings";
```

### EditorPane 分发
```typescript
// EditorArea.tsx
if (currentFile.path === SETTINGS_PATH) {
  return <SettingsPanel />;
}
// ... diff viewer
// ... normal file editor
```

## 关键特性

### 1. 单例模式
Settings tab 是单例，重复点击设置按钮会聚焦到已有 tab：
```typescript
openSettings: () => {
  // 检查是否已打开
  for (const g of state.groups) {
    const existing = g.openFiles.find((f) => f.path === SETTINGS_PATH);
    if (existing) {
      // 聚焦到已有 tab
      return;
    }
  }
  // 创建新 tab
}
```

### 2. 不持久化
Settings tab 不会被保存到 localStorage：
```typescript
openFiles.filter(
  (f) =>
    !f.path.startsWith("diff:") &&
    !f.path.startsWith("untitled:") &&
    !f.path.startsWith("ftre://"),  // 排除虚拟路径
)
```

### 3. 专用图标
```typescript
// file-icons.ts
export const VIRTUAL_PATH_MAP: Record<string, FileIconResult> = {
  "ftre://settings": { icon: Settings, color: "#9da5b4" },
};
```

## VSCode 参考

| VSCode 概念 | ftre 实现 |
|-------------|-----------|
| `SettingsEditor2Input` | `OpenFile { type: 'settings', path: 'ftre://settings' }` |
| `SettingsEditor2` (EditorPane) | `SettingsPanel` 组件 |
| `vscode-settings://` scheme | `ftre://` scheme |
| `EditorPaneDescriptor` 注册 | `EditorArea` 中直接 switch/if 判断 |

## 扩展方式

如需添加更多特殊编辑器（如 Keybindings、Welcome）：

1. 在 `EditorInputType` 添加新类型
2. 定义虚拟路径常量（如 `KEYBINDINGS_PATH = "ftre://keybindings"`）
3. 在 `editor-store.ts` 添加打开方法（如 `openKeybindings()`）
4. 在 `EditorArea.tsx` 添加渲染分支
5. 在 `VIRTUAL_PATH_MAP` 添加图标映射
