# Settings Tab (设置面板)

> 参考 VSCode 的 EditorInput + EditorPanes 架构实现的 Settings Tab，用于可视化配置 AgentDef 等用户定义

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/editor/src/store/types.ts` | `EditorInputType` 和 `SETTINGS_PATH` 定义 |
| `packages/editor/src/store/editor-store.ts` | `openSettings()` 方法实现 |
| `packages/renderer/src/app/TitleBar.tsx` | 右上角设置按钮入口 |
| `packages/renderer/src/features/editor/EditorArea.tsx` | SettingsPanel 挂载和可见性控制 |
| `packages/renderer/src/features/settings/SettingsPanel.tsx` | Settings 面板基础组件 |
| `packages/renderer/src/features/settings/AgentDefSettings.tsx` | AgentDef 配置页面 |
| `packages/renderer/src/features/settings/constants.ts` | 工具列表常量（暂时写死） |
| `packages/ui/src/components/SearchableMultiSelect.tsx` | 可搜索多选组件（参考 ModelSelector 风格） |
| `packages/editor/src/ui/SettingsEditorWidget.tsx` | Settings Editor Widget（简化版实现） |
| `.ftre/specs/settings-editor-pane/` | SettingsEditorPane 完整架构规范（方向B） |

## 架构设计

### 当前实现（简化版）

实际采用 **CSS display 控制** 的折中方案，而非完整的 VSCode EditorPane 架构：

```
EditorArea
  ├── CodeEditorWidget (正常 EditorPane)
  └── SettingsEditorWidget (React Root 挂载，display 控制显隐)
        └── SettingsPanel
              └── AgentDefSettings / SkillsSettings / ...
```

**关键实现**：`SettingsEditorWidget` 组件始终挂载，通过 `display: block/none` 控制显示/隐藏：

```tsx
// packages/renderer/src/features/editor/EditorArea.tsx
<div className={cn("h-full", activeType === 'settings' ? 'block' : 'hidden')}>
  <SettingsEditorWidget />
</div>
```

**状态保持原理**：
- 组件不卸载 → useState/useReducer 状态自然保留
- 切换 Tab 只是 CSS 显隐切换，React 组件树保持完整

### 理想方案（方向B - SettingsEditorPane）

将 SettingsPanel 完全纳入 EditorPanes 架构，与 VSCode 完全对齐：

```
EditorParts (多窗口)
  └── EditorPart (单窗口)
        └── EditorGroupView (编辑器组)
              ├── EditorTitleControl (Tab 栏)
              └── EditorPanes (Pane 复用池)
                    └── SettingsEditorPane (实现 EditorPane 接口)
                          └── SettingsPanel (React 组件)
```

**完整三层架构**：
1. `SettingsEditorInput` - EditorInput 子类，标识设置编辑器
2. `SettingsEditorPane` - 实现 EditorPane 接口，管理生命周期
3. `SettingsEditorWidget` - React 组件，实际 UI 渲染

**已确认的设计决策**（见 `.ftre/specs/settings-editor-pane/requirements.md`）：

| 问题 | 决策 |
|------|------|
| **Q1: React-DOM 集成** | **D-1: createRoot 挂载** - Pane 内部管理 React 生命周期，dispose 时 unmount |
| **Q2: 表单状态持久化** | **D-2: 组件内部保留** - 通过 setVisible 控制，组件不卸载，useState 自然保留 |
| **Q3: 多 Group 行为** | **D-3: 每 Group 独立** - 与 CodeEditor 一致，支持分屏 |
| **Q4: SettingsPanel 重构** | **D-4: 保持原样** - 最小改动，依赖复用机制 |

### EditorInputType

```typescript
// packages/editor/src/store/types.ts
export type EditorInputType = "file" | "settings";
export const SETTINGS_PATH = "ftre://settings";

export interface OpenFile {
  path: string;
  name: string;
  type?: EditorInputType;
  // ...
}
```

### 单例模式

Settings tab 是单例，重复点击设置按钮会聚焦到已有 tab。

## 状态保持机制

### 问题背景

切换 Tab 时 SettingsPanel 被卸载会导致子页面状态（如当前在 Agents 页面、搜索词、表单数据）重置。

### 方案演进

#### 方案一：CSS Keep-Alive（实际采用）

使用 CSS 控制可见性而非条件渲染：

```tsx
// EditorArea.tsx
<div className={cn("h-full", isSettingsActive ? 'block' : 'hidden')}>
  <SettingsPanel />
</div>
```

**优点**：
- 实现简单，代码侵入性小
- 组件不卸载，useState 自然保持
- 切换 Tab 无重新渲染开销

**缺点**：
- 组件长期挂载占用内存
- 与 React 的声明式理念略有冲突
- 无法利用组件卸载/挂载的清理机制

**现状**：当前实际采用的方案，作为向完整 EditorPane 架构过渡的折中实现。

#### 方案二：状态外置（考虑中）

参考 VSCode 的 EditorMemento 模式，将状态提升到组件外部：

```typescript
// useSettingsStore.ts
interface SettingsViewState {
  currentView: 'home' | 'agents' | 'skills';
  agentsSearchQuery: string;
  // ...
}
```

**VSCode 核心理念**：
1. 组件可以卸载/挂载（这是 React/DOM 的正常行为）
2. 状态存在组件外部（EditorMemento），与组件生命周期解耦
3. 组件挂载时从外部恢复状态，卸载前保存状态

#### 方案三：SettingsEditorPane（理想方案，规划中）

将 SettingsPanel 纳入 EditorPanes 架构，与 VSCode 完全对齐：

1. 创建 `SettingsEditorPane` 类实现 EditorPane 接口
2. 在 `createEditor()` 中使用 `React.createRoot` 挂载 SettingsPanel
3. 通过 `setVisible(true/false)` 控制显示/隐藏（不卸载组件）
4. 通过 `getViewState()` / `setViewState()` 持久化状态

### VSCode EditorPanes 复用机制参考

VSCode 采用实例池实现 EditorPane 复用：

```typescript
// EditorPanes 内部实现
doInstantiateEditorPane(descriptor) {
  // 1. 先从池中查找
  const existing = this.editorPanes.find(p => descriptor.describes(p));
  if (existing) return existing;  // 复用！
  
  // 2. 不存在才创建
  const pane = descriptor.instantiate(...);
  this.editorPanes.push(pane);  // 加入池
  return pane;
}

// 切换时隐藏而非销毁
doHideActiveEditorPane() {
  this._activeEditorPane?.setVisible(false);
  hide(container);  // CSS 隐藏
  // 注意：没有 dispose！
}
```

**两层状态机制**：

| 层级 | 机制 | 作用 |
|------|------|------|
| **EditorPane 复用** | `editorPanes` 实例池 | 同一类型 Pane 只创建一次，切换时 `setVisible(true/false)` |
| **EditorMemento** | LRU Cache | 跨会话保持状态（搜索词、target 等） |

```typescript
// VSCode SettingsEditor2 状态定义
interface ISettingsEditor2State {
  searchQuery: string;
  target: SettingsTarget;
}
```

## AgentDef 配置

### 核心组件

#### SearchableMultiSelect

```typescript
// packages/ui/src/components/SearchableMultiSelect.tsx
interface SelectOption {
  value: string;
  label: string;
  group?: string;
}
```

- 下拉面板 + 搜索框（参考 chat 面板 ModelSelector 交互风格）
- 支持多选、分组显示
- 已选项以 Tag/Chip 形式显示
- 键盘导航（↑↓ 移动高亮，Enter 选择，Esc 关闭）

#### AgentDefSettings

```typescript
interface AgentDefFormData {
  id: string;
  name: string;
  description: string;
  tools: string[];
}
```

### 保存机制

- **格式**：YAML frontmatter + Markdown body
- **路径**：`{workspace}/.ftre/agents_def/{id}/AGENT.md`
- **方式**：IPC `fs:writeFile`
- **tools 列表**：前端暂时写死（见 `constants.ts`）

## 设计决策

### 为什么当前用 CSS display 而非完整 EditorPane？

**过渡方案**：
- 实现成本低，快速解决状态丢失问题
- 与现有 React 组件体系兼容性好
- 为后续完整 EditorPane 架构演进预留接口

**未来演进**：`SettingsEditorWidget` 已按 EditorPane 接口风格设计，便于后续替换为完整的 `SettingsEditorPane`。

### 状态外置 vs Keep-Alive

| 维度 | 状态外置 | Keep-Alive (CSS display) |
|------|----------|--------------------------|
| 内存占用 | 低（组件可卸载） | 高（组件常驻） |
| 状态管理复杂度 | 高（需手动同步） | 低（useState 自然保持） |
| 实现难度 | 中 | 低 |
| 与 React 理念 | 更契合 | 略有冲突 |
| 跨会话持久化 | 容易 | 需额外实现 |

### SettingsEditorPane 的完整价值

- 与 VSCode 架构完全对齐
- 统一处理多 Group、状态持久化
- 支持复杂编辑器（Diff、Binary 等）的扩展
- 更好的内存管理（Pane 级生命周期控制）

## 扩展方式

### 添加新的设置子页面

1. 在 `SettingsPanel.tsx` 中注册新路由
2. 创建对应的设置组件（如 `KeybindingsSettings.tsx`）
3. 在首页添加入口卡片

### 添加新的特殊编辑器

如需添加类似 Settings 的特殊编辑器（如 Keybindings、Extensions）：

1. 在 `EditorInputType` 添加新类型
2. 定义虚拟路径常量（如 `KEYBINDINGS_PATH = "ftre://keybindings"`）
3. 在 `editor-store.ts` 添加打开方法
4. 在 `EditorArea.tsx` 添加渲染分支（复用 SettingsEditorWidget 模式）
5. 在 `VIRTUAL_PATH_MAP` 添加图标映射
6. **未来**：创建对应的 EditorPane 类，纳入 EditorPanes 管理

## VSCode 参考对照

| VSCode 概念 | ftre 当前实现 | ftre 理想方案 (SettingsEditorPane) |
|-------------|---------------|-----------------------------------|
| `SettingsEditor2Input` | `OpenFile { type: 'settings' }` | `SettingsEditorInput` 类 |
| `SettingsEditor2` | `SettingsPanel` 组件 | `SettingsEditorPane` 类 |
| EditorPane 复用 | CSS display 控制显隐 | 实例池 + `setVisible()` |
| EditorMemento | useState 内部保持 | `getViewState()` / `setViewState()` |
