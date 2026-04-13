# Notification Stack (消息弹窗)

> 基于 sonner 的消息弹窗系统，支持 info/warning/error/success 四种级别

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/stores/notification.ts` | notification store，封装 sonner 的 toast API |
| `packages/renderer/src/app/Workbench.tsx` | 全局 Toaster 组件挂载点 |
| `packages/renderer/src/styles/global.css` | 关闭按钮样式覆盖 |
| `packages/renderer/src/main.tsx` | sonner CSS 样式导入入口 |

## 使用方式

```tsx
import { useNotification } from "@/stores/notification";

// 在组件中使用
const { addNotification } = useNotification();

addNotification({
  level: "error",
  message: "操作失败",
  actions: [{ label: "重试", onClick: () => {} }]
});
```

## 架构变更历史

### 当前实现 (sonner)
- 使用 sonner 库 (`^2.0.7`)
- 无需自定义 UI 组件，开箱即用
- 全局 `<Toaster />` 组件挂载在 Workbench
- 样式导入：`import "sonner/dist/styles.css"`（在 `packages/renderer/src/main.tsx`）

### 旧实现 (已废弃)
- 双层架构：`@ftre/ui NotificationStack` + renderer 封装层
- 废弃原因：Tailwind 样式类在组件库构建时不生效
- **问题症状**：高度仅文本高度、定位在左上角、黑底黑字完全不可见
- **根本原因**：`@ftre/ui` 作为独立组件包，Tailwind 任意值类（如 `w-[640px]`、`min-h-[80px]`）在构建时未被正确解析
- 已删除文件：
  - `packages/renderer/src/components/NotificationStack.tsx`
  - `packages/renderer/src/components/NotificationStack.test.tsx`

## Sonner 迁移步骤

1. 安装依赖：`npm install sonner`
2. 修改 `packages/renderer/src/stores/notification.ts` - 替换为 sonner API
3. `packages/renderer/src/app/Workbench.tsx` - 添加 `<Toaster />` 组件
4. `packages/renderer/src/main.tsx` - 导入 sonner CSS：`import "sonner/dist/styles.css"`
5. `packages/renderer/src/styles/global.css` - 添加关闭按钮样式覆盖
6. 删除旧组件文件

## 配置

### Workbench.tsx Toaster 配置

```tsx
<Toaster
  position="bottom-left"
  theme="dark"
  richColors
  closeButton
  expand={false}
  style={{ fontFamily: "var(--font-sans)" }}
  toastOptions={{
    style: {
      minHeight: "56px",
      padding: "12px 16px",
    },
    className: "group",
  }}
/>
```

### 关闭按钮样式覆盖 (global.css)

sonner 默认关闭按钮悬浮在 toast 外侧，需通过 CSS 覆盖改为内部右侧：

```css
/* Sonner Toast 样式覆盖 - 关闭按钮移到内部右侧 */
[data-close-button] {
  position: static !important;
  right: auto !important;
  top: auto !important;
  transform: none !important;
  margin-left: 12px;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

[data-close-button]:hover {
  background: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.9);
}

[data-sonner-toast] {
  min-height: 56px !important;
  padding: 14px 16px !important;
}

[data-sonner-toast] [data-content] {
  flex: 1;
}
```

## 数据结构

```typescript
type NotificationLevel = "info" | "warning" | "error" | "success";

interface NotificationItem {
  id: string;
  level: NotificationLevel;
  message: string;
  actions?: { label: string; onClick: () => void; }[];
  createdAt: number;
}
```

## 注意事项

- sonner 自动处理动画、堆叠、关闭按钮等交互
- error 级别不会自动消失（需手动关闭）
- 位置固定为 bottom-left，遵循 VSCode 美学
- **不要在组件库中使用 Tailwind 任意值类**（如 `w-[640px]`），构建时易出样式问题
- 关闭按钮位置无法通过组件 props 配置，必须通过 CSS 覆盖 `[data-close-button]` 实现
- 样式覆盖要使用 `!important`，否则可能被 sonner 默认样式覆盖
