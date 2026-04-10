# Notification Stack (消息弹窗)

> 左下角消息弹窗组件，支持 info/warning/error/success 四种级别，支持拖动关闭，固定最多显示 3 条

## 架构分层

项目采用双层架构，实际使用的是 Renderer 包的封装层：

```
Renderer 封装层 → UI 基础组件
```

- **Renderer 封装层**：连接业务 store（`useNotification`），提供应用级功能
- **UI 基础组件**：纯展示组件，通过 `@ftre/ui` 导出复用

## 核心文件

### UI 基础组件目录

| 文件 | 职责 |
|------|------|
| `packages/ui/src/components/NotificationStack/types.ts` | 类型定义（NotificationLevel, NotificationItem, NotificationAction, NotificationStackProps） |
| `packages/ui/src/components/NotificationStack/config.ts` | levelConfig、positionClasses、样式常量、MAX_VISIBLE |
| `packages/ui/src/components/NotificationStack/NotificationCard.tsx` | 单个通知卡片，含计时器、拖拽、hover 暂停 |
| `packages/ui/src/components/NotificationStack/NotificationStack.tsx` | 通知堆叠主组件，限制最多 3 条 |
| `packages/ui/src/components/NotificationStack/index.ts` | 统一导出 |
| `packages/ui/src/components/index.ts` | 主导出入口，导出 NotificationStack 及所有类型 |

### Renderer 封装层

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/components/NotificationStack.tsx` | 实际使用的封装层，连接 useNotification store |
| `packages/ui/src/hooks/useDragToDismiss.ts` | 拖拽关闭交互 hook |

## 使用方式

Renderer 层封装示例：

```tsx
import { NotificationStack as BaseNotificationStack } from "@ftre/ui";
import { useNotification } from "@/stores/notification";

export function NotificationStack() {
  const notifications = useNotification((s) => s.notifications);
  const removeNotification = useNotification((s) => s.removeNotification);

  return (
    <BaseNotificationStack
      notifications={notifications}
      onDismiss={removeNotification}
    />
  );
}
```

## 数据结构

```typescript
// 通知级别（新增导出类型）
type NotificationLevel = "info" | "warning" | "error" | "success";

NotificationItem: {
  id: string,
  level: NotificationLevel,
  message: string,
  actions?: NotificationAction[]
}

NotificationAction: {
  label: string,
  onClick: () => void
}

NotificationStackProps: {
  notifications: NotificationItem[],
  onDismiss: (id: string) => void,
  autoDismissMs?: number,  // 默认 5000
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left",
  className?: string
}
```

## 级别配置

| Level | 图标 | 边框颜色 |
|-------|------|----------|
| `info` | Info | `#58a6ff` (蓝) |
| `warning` | AlertTriangle | `#d29922` (黄) |
| `error` | XCircle | `#f85149` (红) |
| `success` | CheckCircle | `#3fb950` (绿) |

## 定位配置

| Position | 样式类 |
|----------|--------|
| `bottom-left` (默认) | `bottom-8 left-6` |
| `bottom-right` | `bottom-8 right-6` |
| `top-right` | `top-10 right-6` |
| `top-left` | `top-10 left-6` |

- `z-index: 9998`
- 固定定位 `position: fixed`
- **MAX_VISIBLE = 3**：最多同时显示 3 条通知，超出自动截断（新的保留，旧的移除）

## 业务流程

### 通知生命周期

NotificationStack:渲染 → NotificationCard:挂载启动计时器 → (hover 暂停) → 超时/点击关闭 → onDismiss 回调 → AnimatePresence 退出动画

### 拖拽关闭流程

handleMouseDown → useDragToDismiss:追踪移动 → 计算距离/透明度 → 释放判断阈值 → 超过 threshold 触发 onDismiss → 飞出动画

## 交互特性

### 拖动关闭

- **整卡可拖**：无需专门手柄，按住卡片任意位置即可拖动
- **事件绑定**：`mousemove`/`mouseup` 绑定到 `document`，鼠标移动快也不会丢失
- **方向限制**：NotificationStack 限制为 **只能左右拖动** (`axis: "x"`)
- **触发阈值**：拖够 **100px** 后释放自动关闭
- **视觉反馈**：
  - 从 **40px** 开始渐隐，给用户距离感知的直觉反馈
  - 拖动距离越远透明度越低，到达 **120px** 时完全透明
- **飞出动画**：消失时沿拖拽方向飞出，而非固定方向
- **回弹动画**：未超过阈值时弹回原位

### useDragToDismiss Hook

通用拖拽关闭交互 hook，支持鼠标和触摸事件，可限制拖拽方向：

```typescript
useDragToDismiss(options: UseDragToDismissOptions) => {
  handleMouseDown: (e: React.MouseEvent) => void,
  state: DragToDismissState
}

interface UseDragToDismissOptions {
  threshold?: number;     // 默认 100px
  deadZone?: number;      // 默认 3px
  fadeStart?: number;     // 默认 40px
  fadeEnd?: number;       // 默认 120px
  minScale?: number;      // 默认 0.92
  axis?: "x" | "y" | "both";  // 默认 "both"
  onDismiss: () => void;
  ignoreSelectors?: string[];
  touch?: boolean;
}
```

### 自动消失

- 默认 5 秒 (`autoDismissMs = 5000`)
- error 级别不会自动消失
- 鼠标悬停时暂停计时（isHovered 状态控制）

### 关闭按钮

- 尺寸 `w-6 h-6`，hover 时显示背景色
- 点击立即关闭
- 阻止事件冒泡避免触发拖拽

## 设计决策

- **模块化拆分**：原单体 `NotificationStack.tsx` 拆分为目录结构，职责更清晰
  - `types.ts`：类型定义
  - `config.ts`：配置常量（levelConfig, positionClasses, CARD_STYLES, ANIMATION）
  - `NotificationCard.tsx`：单个通知逻辑（计时器、拖拽、hover 暂停）
  - `NotificationStack.tsx`：堆叠容器逻辑（MAX_VISIBLE 截断、AnimatePresence）
  - `index.ts`：统一导出
- **MAX_VISIBLE = 3 固定**：超出部分自动截断（`notifications.slice(-MAX_VISIBLE)`），避免堆积过多通知
- **保留深色硬编码**：暂不引入主题系统，保持简单
- **success 类型**：使用 CheckCircle 图标 + 绿色主题，用于操作成功反馈
- **error 不自动消失**：重要错误需要用户手动确认
- **新增 NotificationLevel 导出**：主 `index.ts` 导出该类型供外部使用

## 注意事项

- 拖动关闭是 UI 层内部实现，Renderer 层无需关心
- 位置改为左下角是为了遵循 VSCode 美学设计
- 卡片堆叠间距 8px (`gap-2`)
- `useDragToDismiss` 可复用于其他需要拖拽关闭的组件
- **framer-motion x/y 偏移必须同时绑定**，否则拖拽方向受限
- NotificationCard 拖拽时禁用过渡动画 (`duration: 0`)，获得更跟手的体验
