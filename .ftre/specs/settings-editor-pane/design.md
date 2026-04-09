# Settings EditorPane 设计文档

## 技术上下文

### 现有架构

```
packages/editor/src/workbench/
├── editorPane.ts           # EditorPane 基类 ✓
├── editorPanes.ts          # EditorPanes 实例池 ✓
├── editorInput.ts          # EditorInput 基类 ✓
├── editorMemento.ts        # ViewState 持久化 ✓
├── textCodeEditorPane.ts   # 代码编辑器 Pane ✓
└── settingsEditorPane.ts   # 【新增】设置编辑器 Pane

packages/renderer/src/features/settings/
├── SettingsPanel.tsx       # 设置面板 UI（保持不变）
├── AgentDefSettings.tsx    # Agent 配置页面
└── constants.ts            # 工具列表常量
```

### 依赖关系

- `EditorPane` 基类已实现，参考 VSCode 设计
- `EditorPanes` 实例池已实现，支持复用
- `CodeEditorWidget` 已使用此架构，可参考

## 数据模型

### SettingsEditorInput

```typescript
// packages/editor/src/workbench/settingsEditorInput.ts

export class SettingsEditorInput extends EditorInput {
  static readonly TYPE_ID = 'workbench.editors.settingsEditor';
  
  readonly typeId = SettingsEditorInput.TYPE_ID;
  
  getName(): string {
    return 'Settings';
  }
  
  getDescription(): string {
    return '';
  }
  
  matches(other: EditorInput): boolean {
    return other instanceof SettingsEditorInput;
  }
}
```

### ISettingsViewState

```typescript
// 由于采用 setVisible 模式，ViewState 可以很简单
// React 组件内部的 useState 会自然保留

interface ISettingsViewState {
  // 预留，未来可扩展
  // 当前通过组件不卸载来保持状态
}
```

## 实现设计

### 1. SettingsEditorPane

```typescript
// packages/editor/src/workbench/settingsEditorPane.ts

import { EditorPane, type IEditorGroup, type IEditorOpenContext, type IEditorOptions, type IDimension } from './editorPane';
import type { EditorInput } from './editorInput';

export class SettingsEditorPane extends EditorPane {
  static readonly ID = 'workbench.editors.settingsEditor';
  
  private _root: Root | null = null;
  private _renderCallback: ((container: HTMLElement) => void) | null = null;
  
  constructor(group: IEditorGroup) {
    super(SettingsEditorPane.ID, group);
  }
  
  /**
   * 设置渲染回调（由 React 层提供）
   */
  setRenderCallback(callback: (container: HTMLElement) => void): void {
    this._renderCallback = callback;
  }
  
  protected createEditor(parent: HTMLElement): void {
    // 创建容器
    parent.style.cssText = 'width: 100%; height: 100%; overflow: hidden;';
    
    // 调用渲染回调（由 React 层注入）
    if (this._renderCallback) {
      this._renderCallback(parent);
    }
  }
  
  async setInput(
    input: EditorInput,
    options: IEditorOptions | undefined,
    context: IEditorOpenContext,
  ): Promise<void> {
    this._input = input;
    this._options = options;
  }
  
  protected setEditorVisible(visible: boolean): void {
    super.setEditorVisible(visible);
    // 容器 display 由 EditorPanes 控制
  }
  
  layout(dimension: IDimension): void {
    // Settings 面板自适应，无需额外布局
  }
  
  focus(): void {
    // 可选：聚焦搜索框
  }
  
  override dispose(): void {
    // React 组件会随容器一起销毁
    super.dispose();
  }
}
```

### 2. React 集成层

```typescript
// packages/editor/src/ui/SettingsEditorWidget.tsx

import { useRef, useEffect, useLayoutEffect, memo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorPanes, SettingsEditorInput, SettingsEditorPane } from '../workbench';

interface SettingsEditorWidgetProps {
  groupId: number;
  renderSettings: () => React.ReactNode;
}

export const SettingsEditorWidget = memo(function SettingsEditorWidget({
  groupId,
  renderSettings,
}: SettingsEditorWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorPanesRef = useRef<EditorPanes | null>(null);
  const rootRef = useRef<Root | null>(null);
  
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || editorPanesRef.current) return;
    
    // 创建工厂
    const factory = createSettingsEditorPaneFactory((paneContainer) => {
      // 在 pane 容器中挂载 React
      rootRef.current = createRoot(paneContainer);
      rootRef.current.render(renderSettings());
    });
    
    // 创建 EditorPanes
    const group = createSimpleEditorGroup(groupId);
    const panes = new EditorPanes(group, factory);
    panes.create(container);
    editorPanesRef.current = panes;
    
    // 打开 Settings
    const input = new SettingsEditorInput();
    panes.openEditor(input, undefined, {});
    
    return () => {
      rootRef.current?.unmount();
      panes.dispose();
    };
  }, [groupId]);
  
  return <div ref={containerRef} className="w-full h-full" />;
});
```

### 3. EditorArea 集成

```tsx
// packages/renderer/src/features/editor/EditorArea.tsx 变更

// 移除条件渲染 SettingsPanel
// 改为使用 SettingsEditorWidget

{currentFile.path === SETTINGS_PATH ? (
  <SettingsEditorWidget
    groupId={group.id}
    renderSettings={() => <SettingsPanel />}
  />
) : (
  <CodeEditorWidget ... />
)}
```

## 实施阶段

### Phase 1: 基础架构

1. 创建 `SettingsEditorInput` 类
2. 创建 `SettingsEditorPane` 类
3. 创建 `SettingsEditorPaneDescriptor`
4. 导出到 workbench/index.ts

### Phase 2: React 集成

1. 创建 `SettingsEditorWidget` 组件
2. 实现 createRoot 挂载逻辑
3. 实现 dispose 时的 unmount

### Phase 3: EditorArea 迁移

1. 移除现有的 CSS display hack
2. 集成 SettingsEditorWidget
3. 测试 Tab 切换状态保持

### Phase 4: 清理

1. 移除 EditorArea 中的条件渲染代码
2. 更新导出
3. 验证功能完整性

## 测试要点

1. **状态保持**：Settings → 代码 → Settings，视图状态应保持
2. **表单保持**：编辑 Agent 表单 → 切换 Tab → 切回，表单数据应在
3. **多 Group**：左右分屏各开一个 Settings，状态独立
4. **销毁**：关闭 Settings Tab，资源应正确释放
