# Settings 面板

> 客户端设置功能：右上角设置按钮 → 创建 VSCode 风格的 Settings Tab（非弹窗，可关闭/拖拽）

## 核心文件

| 文件 | 职责 |
|------|------|
| `renderer/components/TitleBar.tsx` | 右上角添加设置按钮，点击触发 openSettings() |
| `renderer/components/EditorArea.tsx` | 根据 OpenFile.type 分发渲染：'file' → MonacoEditor, 'settings' → SettingsPanel |
| `renderer/stores/editor-store.ts` | EditorStore 核心，扩展 OpenFile 类型支持 type 字段 |
| `renderer/components/TabBar.tsx` | Tab 系统，支持关闭/切换 Settings Tab |

## 技术方案

### OpenFile 类型扩展
```typescript
interface OpenFile {
  path: string;
  type: 'file' | 'settings' | 'diff';
  // ... 其他字段
}
```

### EditorArea 渲染分发
```typescript
// EditorArea.tsx 根据 type 决定渲染哪个组件
if (activeFile.type === 'settings') {
  return <SettingsPanel />;
}
return <MonacoEditor file={activeFile} />;
```

### VSCode 实现参考
VSCode 使用**虚拟 URI + EditorInput 类型分发**模式：
- Settings: `vscode-settings://` URI scheme
- 对应 `SettingsEditor2Input` 类
- `EditorPane` 根据 `EditorInput` 类型渲染 `SettingsEditor2` 组件

## 业务流程

### 打开 Settings Tab
TitleBar:设置按钮点击 → editorStore:openSettings() → TabBar:新增 Tab → EditorArea:检测到 type='settings' → 渲染 SettingsPanel

## 设计决策

- **非弹窗形式**：遵循 VSCode 模式，Settings 是可关闭/拖拽的 Tab，而非模态弹窗
- **type 字段分发**：扩展 OpenFile 增加 type 字段，EditorArea 根据 type 决定渲染组件
- **虚拟文件路径**：Settings Tab 使用特殊路径如 `__settings__` 或虚拟 URI

## 遗留问题

- Settings Tab 是否单例（同一时刻只允许一个 Settings Tab）
- 初期设置项范围（主题、字体、快捷键等）
- Settings 数据持久化方案（本地文件/数据库）
