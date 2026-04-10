# Notification Stack (消息弹窗)

> 左下角消息弹窗组件，支持 info/warning/error 三种级别，支持拖动关闭

## 架构分层

项目采用双层架构，实际使用的是 Renderer 包的封装层：

```
Renderer 封装层 → UI 基础组件
```

- **Renderer 封装层**：连接业务 store（`useNotification`），提供应用级功能
- **UI 基础组件**：纯展示组件，通过 `@ftre/ui` 导出复用

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/components/NotificationStack.tsx` | 实际使用的封装层，连接 useNotification store |
| `packages/ui/src/components/NotificationStack.tsx` | UI 基础组件，纯展示 + 拖动交互 |

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
NotificationItem: {
  id: string,
  level: "info" | "warning" | "error",
  message: string,
  actions?: NotificationAction[]
}

NotificationAction: {
  label: string,
  onClick: () => void
}
```

## 定位配置

| Position | 样式类 |
|----------|--------|
| `bottom-left` (默认) | `bottom-8 left-6` |
| `bottom-right` | `bottom-8 right-6` |
| `top-right` | `top-10 right-6` |
| `top-left` | `top-10 left-6` |

- `z-index: 9998`
- 固定定位 `position: fixed`

## 交互特性

### 拖动关闭
- 按住卡片可拖动
- 拖出超过 100px 后释放自动关闭
- 拖动时有视觉反馈（透明度降低）
- 鼠标悬停显示抓取手柄图标 (`GripHorizontal`)

### 自动消失
- 默认 5 秒 (`autoDismissMs`)
- error 级别不会自动消失
- 鼠标悬停时暂停计时

### 关闭按钮
- 尺寸 `w-6 h-6`，hover 时显示背景色
- 点击立即关闭

## 样式

- **背景**: 不透明 `bg-[#1a1b1d]`（原半透明已移除）
- **边框**: 实色边框，对应级别颜色
- **动画**: framer-motion，从底部滑入
- **配色**: 
  - info: 蓝色 `#58a6ff`
  - warning: 黄色 `#d29922`
  - error: 红色 `#f85149`

## 注意事项

- 拖动关闭是 UI 层内部实现，Renderer 层无需关心
- 位置改为左下角是为了遵循 VSCode 美学设计
- 卡片堆叠间距 8px (`gap-2`)
