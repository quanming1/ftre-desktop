# @ftre/editor 架构文档

本包参考 VSCode 编辑器架构设计，提供代码编辑器的核心功能。

## 目录结构（对标 VSCode）

```
packages/editor/src/
├── common/                           # 通用模块（对标 vs/editor/common）
│   │                                 # 与平台无关的编辑器核心接口和类型
│   ├── editorCommon.ts              # 编辑器通用接口定义
│   │                                 # - ITextModel, IEditor, IEditorContribution
│   │                                 # - ICodeEditorViewState, ICursorState
│   │                                 # - 编辑操作、事件类型等
│   └── index.ts                      # 模块导出
│
├── browser/                          # 浏览器模块（对标 vs/editor/browser）
│   │                                 # 浏览器环境下的编辑器接口
│   ├── editorBrowser.ts             # 浏览器编辑器接口定义
│   │                                 # - ICodeEditor, IDiffEditor
│   │                                 # - IContentWidget, IOverlayWidget
│   │                                 # - 鼠标/键盘事件类型
│   └── index.ts                      # 模块导出
│
├── workbench/                        # 工作台模块（对标 vs/workbench/browser/parts/editor）
│   │                                 # 编辑器工作台相关的核心抽象
│   ├── editorInput.ts               # EditorInput 抽象
│   │                                 # - EditorInput 基类
│   │                                 # - FileEditorInput, UntitledEditorInput
│   │                                 # - EditorInputCapabilities
│   ├── editorMemento.ts             # ViewState 持久化
│   │                                 # - EditorMemento (LRU + localStorage)
│   │                                 # - 按编辑器组存储状态
│   ├── editorPane.ts                # EditorPane 基类
│   │                                 # - 编辑器面板生命周期管理
│   │                                 # - ViewState 保存/恢复时机
│   ├── editorPanes.ts               # EditorPanes 面板管理器
│   │                                 # - EditorPane 实例复用池
│   │                                 # - 编辑器打开/切换逻辑
│   └── index.ts                      # 模块导出
│
├── core/                             # 核心实现（兼容旧 API）
│   ├── text-model.ts                # TextModelService 文本模型服务
│   ├── view-state-manager.ts        # ViewStateManager（简化版）
│   ├── code-editor.ts               # CodeEditor 包装类
│   └── index.ts
│
├── ui/                               # UI 组件（React）
│   ├── SimpleEditor.tsx             # 简化版编辑器组件
│   ├── MonacoDiffViewer.tsx         # Diff 查看器
│   ├── DiffBar.tsx                  # Diff 统计栏
│   ├── TabBar.tsx                   # 标签栏（已移至 renderer）
│   ├── Breadcrumb.tsx               # 面包屑
│   ├── theme-registry.ts            # 主题注册
│   ├── file-icons.ts                # 文件图标
│   └── themes/                       # 主题定义
│       ├── darcula.ts
│       ├── ftre-neon.ts
│       └── index.ts
│
├── store/                            # 状态管理
│   ├── types.ts                     # 类型定义
│   ├── editor-store.ts              # 编辑器状态 store
│   └── index.ts
│
├── runtime/                          # 运行时
│   ├── host-bridge.ts               # 主进程桥接
│   ├── save-file.ts                 # 文件保存
│   ├── save-tracker.ts              # 保存追踪
│   └── index.ts
│
├── utils/                            # 工具函数
│   ├── path-utils.ts
│   ├── breadcrumb-utils.ts
│   └── index.ts
│
└── index.ts                          # 主导出
```

## 核心概念（对标 VSCode）

### 1. 三层架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         View Layer (视图层)                          │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  ViewParts: Lines, Cursors, Decorations, Minimap, etc.      │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                              ▲                                       │
│                              │ ViewEvent                             │
├─────────────────────────────────────────────────────────────────────┤
│                     ViewModel Layer (视图模型层)                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  IViewModel                                                  │   │
│   │  ├── coordinatesConverter (Model ↔ View 坐标转换)            │   │
│   │  ├── viewLayout (布局计算)                                   │   │
│   │  └── cursorConfig (光标配置)                                 │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                              ▲                                       │
│                              │ ModelEvent → ViewEvent                │
├─────────────────────────────────────────────────────────────────────┤
│                       Model Layer (模型层)                           │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  ITextModel                                                  │   │
│   │  ├── 文本内容 (lines, EOL)                                   │   │
│   │  ├── 装饰 (decorations)                                      │   │
│   │  ├── 词法分析 (tokenization)                                 │   │
│   │  └── 撤销/重做栈 (undo/redo)                                 │   │
│   └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2. 编辑器层级结构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EditorPart                                   │
│   (管理窗口内的编辑器组网格布局)                                       │
│   ├── gridWidget: Grid<EditorGroup>                                 │
│   └── groups: Map<GroupId, EditorGroup>                             │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         EditorGroup                                  │
│   (单个编辑器组，包含多个标签)                                         │
│   ├── model: EditorGroupModel (编辑器列表)                           │
│   ├── titleControl: EditorTabs (标签栏)                              │
│   └── editorPanes: EditorPanes (面板管理器)                          │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         EditorPanes                                  │
│   (EditorPane 实例池，支持复用)                                       │
│   ├── panes: EditorPane[] (已创建的面板)                             │
│   └── activePane: EditorPane | null                                 │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         EditorPane                                   │
│   (单个编辑器面板)                                                    │
│   ├── input: EditorInput (当前编辑内容)                              │
│   ├── control: ICodeEditor (Monaco 编辑器实例)                       │
│   └── group: EditorGroup (所属组)                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 3. 核心接口

#### EditorInput (编辑器输入)

```typescript
abstract class EditorInput {
  // 标识
  abstract get typeId(): string;
  abstract get resource(): string | undefined;
  
  // 状态
  isDirty(): boolean;
  isReadonly(): boolean;
  
  // 能力
  get capabilities(): EditorInputCapabilities;
  hasCapability(capability: EditorInputCapabilities): boolean;
  
  // 比较
  matches(other: EditorInput): boolean;
  
  // 序列化
  abstract serialize(): ISerializedEditorInput;
  
  // 生命周期
  onWillDispose: Event<void>;
  dispose(): void;
}
```

#### EditorPane (编辑器面板)

```typescript
abstract class EditorPane extends Disposable {
  readonly group: IEditorGroup;
  
  // 生命周期
  protected abstract createEditor(parent: HTMLElement): void;
  abstract setInput(input: EditorInput, options: IEditorOptions, context: IEditorOpenContext): Promise<void>;
  clearInput(): void;
  
  // 可见性
  protected setEditorVisible(visible: boolean): void;
  
  // 状态
  getViewState(): IEditorViewState | undefined;
  
  // 焦点
  focus(): void;
  
  // 布局
  layout(dimension: IDimension): void;
}
```

#### EditorMemento (ViewState 存储)

```typescript
class EditorMemento<T> {
  // LRU 缓存 + localStorage 持久化
  saveEditorState(group: GroupIdentifier, resource: string, state: T): void;
  loadEditorState(group: GroupIdentifier, resource: string): T | undefined;
  clearEditorState(resource: string, group?: GroupIdentifier): void;
  moveEditorState(source: string, target: string): void;
  saveState(): void;
}
```

### 4. ViewState 管理

#### 保存时机
1. `clearInput()` - 切换文件前
2. `onWillCloseEditor` - 关闭编辑器前
3. `saveState()` - 窗口关闭前

#### 恢复时机
1. `setInput()` 后 - 打开文件时
2. 条件：`shouldRestoreEditorViewState(input, context)` 为 true

### 5. 文件切换流程

```
用户点击标签
    │
    ▼
EditorGroup.openEditor(input, options)
    │
    ├── 1. 触发 onWillOpenEditor 事件
    ├── 2. 更新 EditorGroupModel
    │
    ▼
EditorPanes.openEditor(input, options)
    │
    ├── 1. 获取描述符 (getDescriptor)
    ├── 2. 显示面板 (doShowEditorPane) - 复用或创建
    │
    ▼
EditorPanes.doSetInput(pane, input)
    │
    ├── 1. 检查 input.matches() - 避免重复设置
    ├── 2. pane.clearInput() - 清除旧输入 (保存旧 ViewState)
    ├── 3. pane.setInput() - 设置新输入
    │
    ▼
TextCodeEditor.setInput(input)
    │
    ├── 1. 解析 input 获取 model
    ├── 2. editor.setModel(model)
    ├── 3. loadEditorViewState() - 加载 ViewState
    ├── 4. editor.restoreViewState(viewState) - 同步恢复！
    └── 5. applyTextEditorOptions() - ScrollType.Immediate
```

## 与旧实现的对应关系

| VSCode 概念 | 新实现 | 旧实现 |
|-------------|--------|--------|
| `ITextModel` | `common/editorCommon.ts` | `core/text-model.ts` |
| `ICodeEditor` | `browser/editorBrowser.ts` | Monaco's `IStandaloneCodeEditor` |
| `EditorInput` | `workbench/editorInput.ts` | `store/types.ts` OpenFile |
| `EditorMemento` | `workbench/editorMemento.ts` | `core/view-state-manager.ts` |
| `EditorPane` | `workbench/editorPane.ts` | `ui/SimpleEditor.tsx` |
| `EditorPanes` | `workbench/editorPanes.ts` | - (需要实现) |

## 性能关键点

1. **编辑器复用** - EditorPanes 管理 EditorPane 实例池，不销毁重建
2. **Model 复用** - TextModel 按 URI 缓存，多视图共享
3. **ViewState 同步恢复** - 使用 `ScrollType.Immediate`，不延迟
4. **不调用 `revealPositionInCenter()`** - ViewState 已包含滚动信息
5. **事件合并** - 使用防抖保存，避免频繁 IO

## 迁移计划

### Phase 1: ✅ 核心抽象 (已完成)
- [x] 创建 `common/editorCommon.ts` - 定义核心接口
- [x] 创建 `browser/editorBrowser.ts` - 浏览器接口
- [x] 创建 `workbench/editorInput.ts` - EditorInput 抽象
- [x] 创建 `workbench/editorMemento.ts` - ViewState 存储
- [x] 创建 `workbench/editorPane.ts` - EditorPane 基类
- [x] 创建 `workbench/editorPanes.ts` - 面板复用池

### Phase 2: ✅ 编辑器实现 (已完成)
- [x] 创建 `workbench/textCodeEditorPane.ts` - 代码编辑器 EditorPane
- [x] 创建 `workbench/textModelResolverService.ts` - TextModel 解析服务

### Phase 3: ✅ React 组件集成 (已完成)
- [x] 创建 `ui/CodeEditorPaneFactory.ts` - EditorPane 工厂
- [x] 创建 `ui/CodeEditorWidget.tsx` - 基于新架构的编辑器组件
- [x] 实现编辑器复用机制

### Phase 4: ✅ 编辑器组 (已完成)
- [x] 创建 `workbench/editorGroup.ts` - 编辑器组
- [x] 创建 `workbench/editorPart.ts` - 编辑器部分
- [x] 创建 `ui/EditorPartView.tsx` - EditorPart 的 React 包装
- [x] 实现分屏功能

### Phase 5: ✅ 集成和清理 (已完成)
- [x] 创建 `workbench/viewStateCompat.ts` - ViewState 兼容层
- [x] 更新所有导出

### Phase 6: ✅ 旧版兼容去除 (已完成)
- [x] 删除 `core/view-state-manager.ts` - 被 EditorMemento 替代
- [x] 删除 `ui/SimpleEditor.tsx` - 被 CodeEditorWidget 替代
- [x] 更新 `renderer/EditorArea.tsx` - 使用 CodeEditorWidget
- [x] 更新 `renderer/stores/workspace.ts` - 使用 saveAllViewStates
- [x] 清理所有旧版 API 导出

🎉 **架构迁移已完成！代码库已简化！**