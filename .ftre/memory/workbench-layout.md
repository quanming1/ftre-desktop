# Workbench 布局与 Resize 系统

> 四面板布局（sessions/sidebar/editor/chat）支持拖拽排序和自定义宽度调整

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/app/Workbench.tsx` | 布局容器，面板渲染、resize handle 管理 |
| `packages/renderer/src/components/LayoutSwitcher.tsx` | 面板切换按钮（在 TitleBar 顶部） |
| `packages/renderer/src/app/TitleBar.tsx` | 承载 LayoutSwitcher，位于窗口顶部 |
| `packages/ui/src/components/ResizeHandle.tsx` | 通用拖拽手柄组件，视觉反馈设计 |
| `packages/renderer/src/stores/layout.ts` | PanelId 定义、`panelOrder` 状态管理 |
| `docs/workbench-layout-mode-prd.md` | 布局模式 PRD 文档（设计决策与实现方案） |

## 面板布局结构

```
┌───────────┬───────────┬───────────────────┬───────────┐
│ Sessions  │ Sidebar   │ Editor            │ Chat      │
│ (固定宽)  │ (固定宽)  │ (弹性比例)         │ (弹性比例) │
└───────────┴───────────┴───────────────────┴───────────┘
         ↑            ↑                   ↑
     resize      resize             resize
```

- **固定宽度面板**: sessions、sidebar，通过 `width` style 控制
- **弹性面板**: editor、chat，通过 `flex-grow` + `centerRatio` 比例分配剩余空间
- **ResizeHandle**: 位于每个面板之后（最后一个面板不显示）

## Layout Mode（双模式切换）

> 从自由组合模式简化为 Chat/Agent 双模式，减少认知负担

### PRD 文档

完整的设计决策与实现方案见：`docs/workbench-layout-mode-prd.md`

### 模式定义

| 模式 | 面板顺序 | 适用场景 |
|------|----------|----------|
| **Chat** | sessions → sidebar → editor → chat | 代码开发（文件树 + 编辑器 + 对话） |
| **Agent** | sessions → chat | AI 对话（专注对话流） |

### 设计决策

- **简化交互**: 移除拖拽排序，改为双按钮切换，降低认知负担
- **固定布局**: 每种模式有预定义的面板组合和顺序，不支持自定义
- **宽度保持**: 切换模式时保留各面板的宽度设置

### 数据结构

```typescript
type LayoutMode = 'chat' | 'agent'
type PanelId = 'sessions' | 'sidebar' | 'editor' | 'chat'

// layout store
{
  layoutMode: LayoutMode;            // 当前模式
  panelOrder: PanelId[];             // 由 layoutMode 决定，非用户可编辑
  panelVisible: Record<PanelId, boolean>;  // 由 layoutMode 决定
  sessionsWidth: number;
  sidebarWidth: number;
  centerRatio: number;               // editor:chat 比例，仅在 chat 模式有效
}

// 预定义配置 (MODE_CONFIGS in layout.ts)
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
}
```

### 迁移策略

旧版使用 `panelOrder` 和 `panelVisible` 存储用户自定义配置。迁移时（见 `restore()` 方法）：

1. 检测 `layoutMode` 字段是否存在
2. 若不存在，从 `panelVisible` 推断模式：
   - 如果 `sidebar=false` 且 `editor=false` → 推断为 `'agent'` 模式
   - 否则 → 默认为 `'chat'` 模式
3. 保留 `sessionsWidth`、`sidebarWidth`、`centerRatio` 等宽度设置
4. `setLayoutMode()` 调用会同时更新 `layoutMode`、`panelOrder` 和 `panelVisible`

## LayoutSwitcher (面板切换器)

> 位于 **TitleBar 顶部**，task/群聊/终端/设置按钮的左边

**注意区分**：LayoutSwitcher ≠ WorkspaceSwitcher
- **LayoutSwitcher**: TitleBar 顶部的模式切换按钮（Chat/Agent）
- **WorkspaceSwitcher**: SessionPanel 内部的工作区切换下拉按钮

### 位置与结构

```
┌─────────────────────────────────────────────────────────┐
│ TitleBar                                                │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [Logo]  [Chat | Agent]      [Task 群聊 终端 设置] [🔍]│ │
│ │           ↑ 双模式切换                              │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 组件特性

- **双按钮切换**: Chat / Agent 两个模式按钮，显示当前激活模式
- **点击切换**: 点击按钮直接切换布局模式
- **状态指示**: 激活模式显示高亮样式

### 与旧版区别

| 特性 | 旧版（自由组合） | 新版（双模式） |
|------|-----------------|---------------|
| 面板数量 | 4 个拖拽排序按钮 | 2 个模式切换按钮 |
| 用户控制 | 可自定义面板顺序和显隐 | 只能选择预定义模式 |
| 依赖 | @dnd-kit (拖拽库) | 无外部依赖 |
| 复杂度 | 高（边界情况多） | 低（固定组合） |

## ResizeHandle 使用方式

### 组件导入

```tsx
import { ResizeHandle } from "@ftre/ui";
```

### 正确的包裹方式

**必须**给 ResizeHandle 的父容器添加 `shrink-0`，否则在 flex 布局中会被压缩导致分割线不可见：

```tsx
// ❌ 错误：没有 shrink-0，分割线在 flex 布局中会被压缩
<div className="h-full">
  <ResizeHandle direction="horizontal" onResize={handler} />
</div>

// ✅ 正确：父容器必须有 shrink-0
<div className="h-full shrink-0">
  <ResizeHandle direction="horizontal" onResize={handler} />
</div>
```

### 在 Workbench 中的完整用法

```tsx
{panelVisible.sessions && isResizeHandleVisible("sessions") && (
  <div className="h-full shrink-0" style={{ order: getResizeHandleOrder("sessions") }}>
    <ResizeHandle direction="horizontal" onResize={getResizeHandler("sessions")} />
  </div>
)}
```

### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `direction` | `'horizontal' \| 'vertical'` | 拖拽方向 |
| `onResize` | `(delta: number) => void` | 拖拽回调，delta 为像素位移 |

## ResizeHandle 视觉设计

ResizeHandle 采用三层视觉结构，默认始终可见分割线，hover/drag 时提供明显视觉反馈：

### 层级结构

```
┌─────────────────────────────────────┐
│  扩展点击区域 (Extended click area) │  ← 实际可拖拽区域，比视觉线宽
│  ┌───────────────────────────────┐  │
│  │     Glow 圆形光晕 (32px)      │  │  ← hover/drag 时放大显现
│  │   ┌─────────────────────┐     │  │
│  │   │    2px 分割线        │     │  │  ← 始终可见，hover 变亮
│  │   └─────────────────────┘     │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### 状态样式

| 状态 | 容器宽度 | 分割线 | 背景 | Glow 效果 |
|------|---------|--------|------|----------|
| **默认** | w-2 (8px) | 2px 灰色 | 透明 | 隐藏 (opacity 0) |
| **Hover** | w-2 | 2px neon/80 | neon/10 | 圆形 glow (32px) scale-100，opacity 1 |
| **Dragging** | w-2 | 2px neon/80 | neon/10 | glow 保持可见 |

### 实现细节

- **容器尺寸**: `w-2` (水平方向) / `h-2` (垂直方向)
- **分割线**: 始终可见 `2px`，使用 `--ftre-border` 颜色默认，`neon/80` hover
- **圆形 glow**: `h-8 w-[6px]` (水平) 或 `w-8 h-[6px]` (垂直)，hover 从 `scale-75` 放大到 `scale-100`
- **扩展点击区域**: `inset-y-0 -left-1 -right-1` 扩大可点击范围

## Resize Handler 实现

**工厂函数模式**：Workbench 使用 `createFixedPanelResizeHandler` 和 `createCenterResizeHandler` 创建 resize 回调，传入 `afterPanelId` 参数用于方向判定。

```typescript
// 关键：在 handler 内部通过 getState() 读取最新状态
// 不能依赖闭包捕获的 state 值！
const createFixedPanelResizeHandler = (targetPanel: PanelId, afterPanelId: PanelId) => {
  return (delta: number) => {
    const { panelOrder } = useLayout.getState();  // ✅ 读取最新值
    const index = panelOrder.indexOf(afterPanelId);
    const nextPanelId = panelOrder[index + 1];
    // 如果目标面板在 handle 右边，需要反转 delta
    const adjustedDelta = nextPanelId === targetPanel ? -delta : delta;
    // ... 应用调整
  };
};

const createCenterResizeHandler = (afterPanelId: PanelId) => {
  return (delta: number) => {
    const { centerRatio, panelOrder, panelVisible } = useLayout.getState();  // ✅
    // ... 计算比例调整
  };
};
```

## 关键数据结构

```typescript
type PanelId = 'sessions' | 'sidebar' | 'editor' | 'chat'
type LayoutMode = 'chat' | 'agent'

// layout store
{
  layoutMode: LayoutMode;           // 当前布局模式
  panelOrder: PanelId[];            // 面板顺序（由 layoutMode 决定）
  sessionsWidth: number;            // 固定面板宽度
  sidebarWidth: number;
  centerRatio: number;              // editor:chat 比例 (10-90)
  panelVisible: Record<PanelId, boolean>;
}
```

## 常见坑点

- **UI 包需要构建**：`@ftre/ui` 修改后必须运行 `npm run build` 重新构建 dist 目录，renderer 才能使用最新组件
- **父容器缺少 shrink-0**：ResizeHandle 的父容器必须加 `shrink-0`，否则在 flex 布局中会被压缩，导致分割线不可见
- **闭包捕获旧值**：resize handler 必须用 `useLayout.getState()` 在回调内部读取最新状态，不能依赖工厂函数参数捕获的 state。否则连续拖拽时尺寸不会更新（每次都基于初始值计算）
- **方向判定错误**：不能用 `isLast` 判断是否反转 delta，必须根据面板在 handle 的左右位置决定
- **复制粘贴错误**：`onCenterResize` 的 if-else 分支曾出现完全相同代码的问题，需要根据 `afterPanelId === firstPanel` 决定是否反转 delta
- **Resize handle 可见性**：最后一个可见面板不显示 resize handle（`index < visiblePanels.length - 1`）
- **Flex 比例限制**：`centerRatio` 限制在 10-90 之间，确保两个面板都有最小空间
- **面板内部 min-width 限制**：chat 面板内部组件（如 ChatHeader、MessageList）如果有 `min-w-*` Tailwind 类，可能导致面板无法缩小到预期尺寸，需检查 `packages/renderer/src/features/chat/*.tsx`
- **组件名称混淆**：LayoutSwitcher（面板切换器）和 WorkspaceSwitcher（工作区切换器）容易混淆，前者在 TitleBar 顶部，后者在 SessionPanel 内部
