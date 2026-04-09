# Settings EditorPane 架构对齐

## 概述

将 SettingsPanel 纳入 EditorPanes 架构，与 VSCode 的设计模式对齐。

## 背景

### 当前问题

- `SettingsPanel` 是独立的 React 组件，通过条件渲染切换
- 切换 Tab 后组件被卸载，内部 `useState` 状态丢失
- 当前的 CSS `display: none` hack 不够规范

### VSCode 的设计

VSCode 使用统一的 EditorPanes 架构管理所有编辑器类型：
- `TextCodeEditorPane` - 代码编辑器
- `SettingsEditor2` - 设置编辑器
- `DiffEditorPane` - Diff 编辑器

核心机制：
1. **EditorPanes 实例池** - 相同类型的 Pane 只创建一次
2. **setVisible(true/false)** - 切换时隐藏/显示，不销毁
3. **EditorMemento** - 状态持久化，支持跨 Tab 切换恢复

### 我们已有的架构

```
packages/editor/src/workbench/
├── editorPane.ts        # EditorPane 基类 ✓
├── editorPanes.ts       # EditorPanes 实例池 ✓
├── editorInput.ts       # EditorInput 基类 ✓
├── editorMemento.ts     # ViewState 持久化 ✓
├── textCodeEditorPane.ts # 代码编辑器 Pane ✓
└── (缺少 SettingsEditorPane)
```

## 目标

1. 创建 `SettingsEditorPane` 继承 `EditorPane`
2. 创建 `SettingsEditorInput` 继承 `EditorInput`
3. 将 SettingsPanel 的渲染逻辑迁移到 SettingsEditorPane
4. 在 EditorArea 中统一使用 EditorPanes 管理

## 功能需求

### FR-1: SettingsEditorInput

- [ ] 创建 `SettingsEditorInput` 类
- [ ] `typeId` 为 `"settings"`
- [ ] 单例模式（Settings Tab 全局唯一）
- [ ] `getTitle()` 返回 "Settings"

### FR-2: SettingsEditorPane

- [ ] 继承 `EditorPane<ISettingsViewState>`
- [ ] 实现 `createEditor()` - 创建 React 渲染容器
- [ ] 实现 `setInput()` - 设置输入并恢复 ViewState
- [ ] 实现 `getViewState()` - 返回当前视图状态
- [ ] 使用 EditorMemento 持久化状态

### FR-3: ISettingsViewState

状态结构：
```typescript
interface ISettingsViewState {
  currentView: 'home' | 'agents' | 'editor' | 'appearance' | 'shortcuts' | 'window';
  scrollPosition?: number;
  searchQuery?: string;
}
```

### FR-4: EditorArea 集成

- [ ] 注册 SettingsEditorPane 到 EditorPaneFactory
- [ ] 移除 SettingsPanel 的条件渲染
- [ ] 统一走 EditorPanes.openEditor() 流程

## 非功能需求

### NFR-1: 状态保持

- 切换 Tab 后返回 Settings，视图状态必须恢复
- 包括：当前视图、滚动位置、搜索内容

### NFR-2: 性能

- SettingsPane 实例只创建一次
- 切换时通过 setVisible 控制，不重建 DOM

### NFR-3: 架构一致性

- 与 TextCodeEditorPane 使用相同的生命周期
- 遵循 VSCode 的 EditorPane 模式

## 范围外

- [ ] Settings 内容的具体实现（已有 SettingsPanel 组件）
- [ ] 其他特殊 Tab（Welcome、Keybindings）的迁移
- [ ] 跨 session 持久化（关闭应用后恢复）

## 假设条件

1. SettingsPanel 组件保持现有结构，只是渲染位置变化
2. 每个 EditorGroup 可以独立打开 Settings Tab（非单例）
3. 组件通过 setVisible 控制显示/隐藏，不销毁

## 设计决策

### D-1: React-DOM 集成模式

**决策**：采用 **createRoot 挂载** 模式

在 `SettingsEditorPane.createEditor()` 中使用 `React.createRoot` 挂载 SettingsPanel 组件。EditorPane 内部管理 React 生命周期，在 dispose 时调用 unmount。

这与 VSCode 的模式对齐（VSCode 不用 React，但原理相同：Pane 管理内部视图的生命周期）。

### D-2: 表单编辑状态持久化

**决策**：采用 **组件内部保留** 模式

通过 `setVisible(true/false)` 控制显示隐藏，组件不卸载，表单状态自然保留在 React 组件内部。

这依赖 EditorPane 的复用机制：
- 切换 Tab 时只调用 `setVisible(false)`，不销毁组件
- 切回来时调用 `setVisible(true)`，组件状态保持

### D-3: 多 Group 场景行为

**决策**：采用 **每 Group 独立** 模式

每个 EditorGroup 可以有自己的 Settings Tab，状态独立。

理由：
- 支持分屏场景（左边 Settings，右边代码）
- 与 CodeEditor 行为一致（同一文件可以在多个 Group 打开）
- 实现更简单（无需全局单例检查）

### D-4: SettingsPanel 组件重构范围

**决策**：**SettingsPanel 保持原样**

SettingsPanel 仍用 `useState` 管理 `currentView`。由于 D-2 决定组件不卸载（通过 setVisible 控制），useState 状态自然保留，无需重构。

EditorPane 只负责：
- 创建 React 渲染容器
- 控制 visible 状态
- 在 dispose 时 unmount
