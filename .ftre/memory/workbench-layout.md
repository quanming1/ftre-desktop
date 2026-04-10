# Workbench 布局与 Resize 系统

> 四面板布局（sessions/sidebar/editor/chat）支持拖拽排序和自定义宽度调整

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/app/Workbench.tsx` | 布局容器，面板渲染、resize handle 管理 |
| `packages/renderer/src/components/LayoutSwitcher.tsx` | 四面板切换按钮（在 TitleBar 顶部） |
| `packages/renderer/src/app/TitleBar.tsx` | 承载 LayoutSwitcher，位于窗口顶部 |
| `packages/ui/src/components/ResizeHandle.tsx` | 通用拖拽手柄组件，视觉反馈设计 |
| `packages/renderer/src/stores/layout.ts` | PanelId 定义、`panelOrder` 状态管理 |

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

## LayoutSwitcher (面板切换器)

> 位于 **TitleBar 顶部**，task/群聊/终端/设置按钮的左边

**注意区分**：LayoutSwitcher ≠ WorkspaceSwitcher
- **LayoutSwitcher**: TitleBar 顶部的四面板切换按钮（sessions/sidebar/editor/chat）
- **WorkspaceSwitcher**: SessionPanel 内部的工作区切换下拉按钮（ftre-desktop 等）

### 位置与结构

```
┌─────────────────────────────────────────────────────────┐
│ TitleBar                                                │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [Logo]  [LayoutSwitcher]   [Task 群聊 终端 设置] [🔍]│ │
│ │                          ↑ 这里                     │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 样式规范

**设计决策**：LayoutSwitcher 样式与右侧按钮（task/群聊/终端/设置）保持一致。

| 状态 | 样式类名 |
|------|----------|
| **按钮基础** | `h-full px-3` |
| **激活态** | `text-t-primary bg-white/[0.06]` |
| **默认态** | `text-t-dim hover:bg-white/[0.06] hover:text-t-muted` |

**过渡方案对比**：

| 属性 | 旧样式 | 新样式（与右侧一致） |
|------|--------|---------------------|
| 按钮尺寸 | `w-7 h-7 rounded` (28px 方块) | `h-full px-3`（高度撑满） |
| 激活态 | `text-neon hover:bg-neon/10` + 底部指示条 | `text-t-primary bg-white/[0.06]` |
| 默认态 | `text-t-ghost hover:text-t-muted` | `text-t-dim hover:bg-white/[0.06]` |
| 容器间距 | `gap-0.5` | 无 gap，靠 px-3 控制间距 |

### 组件特性

- **平铺式按钮**: 四个按钮水平排列，显示对应图标（folder, code, message, messages）
- **可拖拽排序**: 支持拖拽调整面板顺序
- **点击显隐**: 点击按钮切换对应面板的显示/隐藏
- **指示条**: 当前激活面板下方显示小横条指示器

### 与 SessionPanel 的区别

| 组件 | 位置 | 功能 |
|------|------|------|
| LayoutSwitcher | TitleBar 顶部 | 切换 sessions/sidebar/editor/chat 四个面板的显隐 |
| WorkspaceSwitcher | SessionPanel Header 内 | 切换当前工作区（ftre-desktop/omni-flow 等） |

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

// layout store
{
  panelOrder: PanelId[];           // 面板顺序，可拖拽调整
  sessionsWidth: number;           // 固定面板宽度
  sidebarWidth: number;
  centerRatio: number;             // editor:chat 比例 (10-90)
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
