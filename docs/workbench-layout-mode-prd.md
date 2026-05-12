# Workbench 布局模式 PRD

## 1. 概述与目标

### 1.1 项目背景

当前 ftre-desktop 的顶部工具栏包含一个 `LayoutSwitcher` 组件，支持用户通过拖拽排序和切换按钮来自由控制四个面板（Sessions、Sidebar、Editor、Chat）的显示/隐藏与排列顺序。

虽然灵活性很高，但实际用户调研表明：
- 大多数用户只需要两种固定布局
- 复杂的拖拽操作增加了认知负担
- 多面板组合存在大量边界问题难以覆盖

### 1.2 目标

将 `LayoutSwitcher` 从「自由组合模式」简化为「双模式切换」：
- **Chat 模式**：文件树 + 代码编辑器 + SessionList（三栏布局，适合代码开发）
- **Agent 模式**：SessionList + Chat 面板（双栏布局，适合 AI 对话）

同时保持两种模式内部面板的可调整大小能力。

---

## 2. 功能规格

### 2.1 模式定义

| 模式 | 面板顺序（从左到右） | 面板可见性 | 场景 |
|------|---------------------|-----------|------|
| `chat` | sessions → sidebar → editor → chat | 全部显示 | 代码开发、文件编辑 |
| `agent` | sessions → chat | sidebar=隐藏, editor=隐藏 | AI 对话专注 |

### 2.2 UI 交互

#### 2.2.1 模式切换按钮

将现有的 4 个拖拽排序按钮替换为 2 个模式切换按钮：

```
[💬 Chat] [🤖 Agent]
```

- 图标：MessageSquare（Chat）、Bot（Agent）
- 状态：当前激活模式按钮高亮（bg-white/[0.12]）
- 点击：切换到对应模式

#### 2.2.2 状态持久化

| 字段 | 类型 | 说明 |
|------|------|------|
| `layoutMode` | `'chat' \| 'agent'` | 当前布局模式 |

默认值为 `'chat'`。

### 2.3 模式内部的面板调整

#### 2.3.1 Chat 模式

- `sessions`：左侧固定宽度，可拖拽调整
- `sidebar`：中间固定宽度，可拖拽调整
- `editor` 与 `chat` 分隔线可拖拽，通过 `centerRatio` 控制比例

#### 2.3.2 Agent 模式

- `sessions` 与 `chat` 分隔线可拖拽，通过 `centerRatio` 控制比例

### 2.4 向后兼容

保留 `layout store` 中现有的 `panelOrder` 和 `panelVisible` 状态，但：
- 当 `layoutMode` 变更时，自动设置对应的 panelOrder 和 panelVisible
- 用户在模式内部调整宽度/比例时，正常持久化

---

## 3. 技术规格

### 3.1 状态定义

在 `packages/renderer/src/stores/layout.ts` 中新增：

```typescript
export type LayoutMode = 'chat' | 'agent';

interface LayoutState extends PersistedLayoutData {
    layoutMode: LayoutMode;
    setLayoutMode: (mode: LayoutMode) => void;
    // ... existing
}

const DEFAULT_LAYOUT_MODE: LayoutMode = 'chat';

const MODE_CONFIGS: Record<LayoutMode, {
    panelOrder: PanelId[];
    panelVisible: Record<PanelId, boolean>;
}> = {
    chat: {
        panelOrder: ['sessions', 'sidebar', 'editor', 'chat'],
        panelVisible: { sessions: true, sidebar: true, editor: true, chat: true },
    },
    agent: {
        panelOrder: ['sessions', 'chat'],
        panelVisible: { sessions: true, sidebar: false, editor: false, chat: true },
    },
};
```

### 3.2 状态持久化

```typescript
interface PersistedLayoutData {
    // ... existing
    layoutMode: LayoutMode;  // 新增
}
```

默认 `layoutMode` 为 `'chat'`。

### 3.3 组件变更

#### 3.3.1 LayoutSwitcher 重构

**文件**：`packages/renderer/src/components/LayoutSwitcher.tsx`

**变更**：
- 移除 `dnd-kit` 相关的拖拽排序逻辑
- 移除 `SortableContext`、`useSortable` 等依赖
- 新增两个模式按钮，点击切换 `layoutMode`

**伪代码**：
```tsx
interface LayoutSwitcherProps {
    layoutMode: LayoutMode;
    onLayoutModeChange: (mode: LayoutMode) => void;
}

function ModeButton({ mode, active, onClick }: ModeButtonProps) {
    const Icon = mode === 'chat' ? MessageSquare : Bot;
    return (
        <button
            className={active ? 'bg-white/[0.12]' : ''}
            onClick={onClick}
        >
            <Icon size={14} />
            <span>{mode === 'chat' ? 'Chat' : 'Agent'}</span>
        </button>
    );
}

export function LayoutSwitcher({ layoutMode, onLayoutModeChange }: LayoutSwitcherProps) {
    return (
        <div className="flex items-center h-full">
            <ModeButton
                mode="chat"
                active={layoutMode === 'chat'}
                onClick={() => onLayoutModeChange('chat')}
            />
            <ModeButton
                mode="agent"
                active={layoutMode === 'agent'}
                onClick={() => onLayoutModeChange('agent')}
            />
        </div>
    );
}
```

#### 3.3.2 TitleBar 联动

**文件**：`packages/renderer/src/app/TitleBar.tsx`

**变更**：
- 从 layout store 读取 `layoutMode`
- 向 `LayoutSwitcher` 传递 `layoutMode` 和 `setLayoutMode`

#### 3.3.3 Workbench 兼容

`Workbench.tsx` 中的面板渲染逻辑无需修改：
- 现有 `panelOrder` + `panelVisible` 机制已支持动态面板组合
- `getPanelStyle()` 自动处理任意面板组合的 flex 布局

### 3.4 迁移策略

在 `layout store` 的 `restore()` 中处理旧数据：

```typescript
restore: () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        const parsed = JSON.parse(raw);
        
        // 新字段
        if (parsed.layoutMode) {
            // 直接使用
        } else {
            // 从旧数据推断
            if (parsed.panelVisible?.sidebar === false && parsed.panelVisible?.editor === false) {
                parsed.layoutMode = 'agent';
            } else {
                parsed.layoutMode = 'chat';
            }
        }
        // ...
    }
}
```

---

## 4. 验收标准

| ID | 检查项 | 验证方式 |
|----|--------|----------|
| VAC-1 | 默认加载应用时，顶部显示 Chat/Agent 两个按钮，Chat 高亮 | 启动应用，目视检查 |
| VAC-2 | 点击 Agent 按钮，切换到 Agent 模式，只显示 Sessions 和 Chat | 点击切换，目视检查 |
| VAC-3 | 点击 Chat 按钮，切换回 Chat 模式，显示全部四个面板 | 点击切换，目视检查 |
| VAC-4 | 切换模式后刷新页面，模式保持 | 刷新并检查 |
| VAC-5 | Chat 模式下，sessions、sidebar 宽度可调整 | 拖拽分隔线 |
| VAC-6 | Agent 模式下，sessions 与 chat 的比例可调整 | 拖拽分隔线 |
| VAC-7 | 旧版本 localStorage 数据迁移后默认进入 Chat 模式 | 清除 localStorage 后重启 |

---

## 5. 依赖变更

### 5.1 移除依赖

从 `LayoutSwitcher.tsx` 中移除：
- `@dnd-kit/core`
- `@dnd-kit/sortable`

### 5.2 包清理

确认项目中无其他组件使用 `@dnd-kit` 后，可从 `package.json` 中移除：
- `@dnd-kit/core`
- `@dnd-kit/sortable`

---

## 6. 里程碑

| 阶段 | 内容 |
|------|------|
| Phase 1 | 创建 layoutMode 状态，配置模式默认值 |
| Phase 2 | 重构 LayoutSwitcher 组件 |
| Phase 3 | 联动 TitleBar，添加切换逻辑 |
| Phase 4 | 实现 localStorage 迁移 |
| Phase 5 | 移除废弃依赖 |
| Phase 6 | 验收测试 |

---

## 7. 附录：当前 LayoutSwitcher DOM 结构

```html
<div class="flex items-center h-full">
  <!-- Sessions 按钮 -->
  <button class="h-full px-3 flex items-center justify-center...">
    <svg><!-- MessagesSquare icon --></svg>
  </button>
  <!-- Sidebar 按钮 -->
  <button class="h-full px-3 flex items-center justify-center...">
    <svg><!-- FolderTree icon --></svg>
  </button>
  <!-- Editor 按钮 -->
  <button class="h-full px-3 flex items-center justify-center...">
    <svg><!-- Code2 icon --></svg>
  </button>
  <!-- Chat 按钮 -->
  <button class="h-full px-3 flex items-center justify-center...">
    <svg><!-- MessageSquare icon --></svg>
  </button>
</div>
```

新结构将简化为两个模式切换按钮。
