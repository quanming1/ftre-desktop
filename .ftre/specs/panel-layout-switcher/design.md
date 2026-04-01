# 技术设计：面板布局切换器

## 涉及文件

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| 修改 | `packages/renderer/src/stores/layout.ts` | 新增 panelOrder 状态和 setter |
| 修改 | `packages/renderer/src/app/TitleBar.tsx` | 新增布局切换按钮 |
| 新建 | `packages/renderer/src/components/LayoutSwitcher.tsx` | 拖拽排序面板组件 |
| 修改 | `packages/renderer/src/app/Workbench.tsx` | 根据 panelOrder 渲染面板 |

## 架构决策

### 决策 1：使用原生 HTML5 Drag and Drop

**选择：** 使用原生 `draggable` + `onDragStart/onDragOver/onDrop` 事件

**原因：**
- 只有 3 个元素，逻辑简单，不需要 react-dnd 等库
- 减少依赖，保持轻量
- 对于简单的排序场景足够用

### 决策 2：panelOrder 替代 splitMode

**选择：** 新增 `panelOrder: PanelId[]` 字段，逐步废弃 `splitMode`

**原因：**
- `splitMode` 只能表示两种状态（ai-center/code-center），无法表示三面板任意排列
- `panelOrder` 是一个有序数组，可表示所有 6 种排列（3! = 6）
- 保留 `splitMode` 字段做迁移兼容

### 决策 3：简化宽度比例

**选择：** 保持 `centerRatio` 不变，但将其语义改为「中间面板占比」

**原因：**
- 三面板场景下，边缘两个面板共享剩余宽度
- 用户可以通过 ResizeHandle 微调各面板宽度
- 避免引入过多新的 ratio 字段

## 数据结构

```typescript
// packages/renderer/src/stores/layout.ts

export type PanelId = 'sidebar' | 'editor' | 'chat';

interface PersistedLayoutData {
  // ... 现有字段 ...
  panelOrder: PanelId[];  // 新增：面板排列顺序，从左到右
  // splitMode 保留用于迁移
}

const defaults: PersistedLayoutData = {
  // ... 现有默认值 ...
  panelOrder: ['sidebar', 'editor', 'chat'],
};
```

## 组件设计

### LayoutSwitcher 组件

```tsx
// packages/renderer/src/components/LayoutSwitcher.tsx

interface LayoutSwitcherProps {
  open: boolean;
  onClose: () => void;
  panelOrder: PanelId[];
  onChange: (order: PanelId[]) => void;
}

// 渲染一个 Popover，内含 3 个可拖拽卡片
// 每个卡片显示面板名称和图标
// 拖拽时高亮目标位置
```

### TitleBar 集成

```tsx
// TitleBar.tsx 右侧按钮区域

{/* 布局切换按钮 — 和悬浮窗按钮有分隔线区分 */}
<button onClick={() => setLayoutSwitcherOpen(true)} title="调整面板布局">
  <LayoutGrid size={14} />
</button>
<div className="w-[1px] h-[14px] bg-border mx-1" />  {/* 分隔线 */}

{/* 悬浮窗按钮组 */}
<button onClick={toggleTaskPanel}>...</button>
<button onClick={toggleAgentChat}>...</button>
<button onClick={toggleTerminal}>...</button>
```

### Workbench 渲染逻辑

```tsx
// Workbench.tsx

const panelOrder = useLayout((s) => s.panelOrder);

// 根据 panelOrder 渲染面板
const renderPanel = (id: PanelId, width: string) => {
  switch (id) {
    case 'sidebar':
      return sidebarVisible ? <Sidebar /> : null;
    case 'editor':
      return <EditorArea />;
    case 'chat':
      return <ChatPanel />;
  }
};

return (
  <div className="flex-1 flex overflow-hidden">
    <ActivityBar />
    {panelOrder.map((id, index) => (
      <Fragment key={id}>
        {renderPanel(id, getWidthForPanel(id))}
        {index < panelOrder.length - 1 && <ResizeHandle />}
      </Fragment>
    ))}
  </div>
);
```

## 宽度计算

三面板宽度分配策略：

1. **Sidebar**：固定宽度 `sidebarWidth`（可拖拽调整，140-400px）
2. **Editor + Chat**：共享剩余空间，按 `centerRatio` 比例分配
   - 如果 Editor 在中间：Editor 占 `centerRatio%`，Chat 占 `100 - centerRatio%`
   - 如果 Chat 在中间：Chat 占 `centerRatio%`，Editor 占 `100 - centerRatio%`
   - 如果 Sidebar 在中间：特殊处理（少见场景）

简化方案：
- Sidebar 始终使用固定宽度 `sidebarWidth`
- 其余两个面板使用 flex-1 均分，或沿用 centerRatio

## 迁移逻辑

```typescript
// layout.ts restore() 中

if (parsed.splitMode && !parsed.panelOrder) {
  // 从 splitMode 迁移到 panelOrder
  if (parsed.splitMode === 'ai-center') {
    parsed.panelOrder = ['sidebar', 'chat', 'editor'];
  } else {
    parsed.panelOrder = ['sidebar', 'editor', 'chat'];
  }
}
```

## UI 细节

### 拖拽卡片样式

```
┌─────────────────────────────────────┐
│  调整面板布局                        │
├─────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│  │ 📁      │  │ 📝      │  │ 💬      │  │
│  │ 文件树  │  │ 编辑器  │  │ Chat   │  │
│  │ ⋮⋮      │  │ ⋮⋮      │  │ ⋮⋮      │  │
│  └─────────┘  └─────────┘  └─────────┘  │
└─────────────────────────────────────┘
```

- 卡片有拖拽手柄图标（6 点网格）
- 拖拽时卡片半透明 + 阴影
- 目标位置显示蓝色插入线

### 按钮位置

```
[Logo] [Git] ─────── 项目名 — 文件名 ─────── [布局] │ [任务] [群聊] [终端] │ [─] [□] [×]
                                              ↑        ↑
                                          布局按钮   悬浮窗组
```
