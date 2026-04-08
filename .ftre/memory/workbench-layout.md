# Workbench 布局与 Resize 系统

> 四面板布局（sessions/sidebar/editor/chat）支持拖拽排序和自定义宽度调整

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/app/Workbench.tsx` | 布局容器，面板渲染、resize handle 管理 |
| `packages/ui/src/components/ResizeHandle.tsx` | 通用拖拽手柄组件 |
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

## 常见坑点

- **闭包捕获旧值**：resize handler 必须用 `useLayout.getState()` 在回调内部读取最新状态，不能依赖工厂函数参数捕获的 state。否则连续拖拽时尺寸不会更新（每次都基于初始值计算）
- **方向判定错误**：不能用 `isLast` 判断是否反转 delta，必须根据面板在 handle 的左右位置决定
- **复制粘贴错误**：`onCenterResize` 的 if-else 分支曾出现完全相同代码的问题，需要根据 `afterPanelId === firstPanel` 决定是否反转 delta
- **Resize handle 可见性**：最后一个可见面板不显示 resize handle（`index < visiblePanels.length - 1`）
- **Flex 比例限制**：`centerRatio` 限制在 10-90 之间，确保两个面板都有最小空间
- **面板内部 min-width 限制**：chat 面板内部组件（如 ChatHeader、MessageList）如果有 `min-w-*` Tailwind 类，可能导致面板无法缩小到预期尺寸，需检查 `packages/renderer/src/features/chat/*.tsx`

## ResizeHandle 使用方式

```tsx
<ResizeHandle
  direction="horizontal"
  onResize={createFixedPanelResizeHandler('sessions', 'sessions')}
/>
```

`afterPanelId` 参数表示该 resize handle 位于哪个面板之后，用于判定面板相对位置。
