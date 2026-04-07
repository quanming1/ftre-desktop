# UI 组件库拆分 (@ftre/ui)

> 独立发布的 React 组件库，纯 UI 与业务逻辑完全解耦

## 包结构

```
packages/ui/
├── src/
│   ├── components/
│   │   ├── ContextMenu.tsx       # 右键菜单
│   │   ├── ConfirmDialog.tsx     # 确认对话框
│   │   ├── FloatingWindow.tsx    # 浮动窗口（拖拽/缩放）
│   │   ├── ResizeHandle.tsx      # 拖拽调整手柄
│   │   ├── CommandPalette.tsx    # 命令面板（泛型）
│   │   ├── NotificationStack.tsx # 通知栈（受控组件）
│   │   └── index.ts
│   ├── hooks/
│   │   └── useThrottledValue.ts
│   ├── utils/
│   │   ├── cn.ts                 # tailwind-merge
│   │   └── menu-position.ts      # 菜单位置计算
│   ├── index.ts                  # 主入口
│   └── tailwind-preset.ts        # Tailwind CSS 预设
├── dist/                         # 构建产物
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

## 导出清单

| 类别 | 导出项 | 路径 |
|------|--------|------|
| 组件 | `ContextMenu`, `ConfirmDialog`, `FloatingWindow`, `ResizeHandle`, `CommandPalette`, `NotificationStack` | `@ftre/ui` |
| 类型 | `ContextMenuItem`, `DialogButton`, `CommandItem`, `NotificationItem` 等 | `@ftre/ui` |
| Hooks | `useThrottledValue` | `@ftre/ui` |
| 工具 | `cn`, `adjustMenuPosition` | `@ftre/ui` |
| 样式 | `ftreUiPreset` | `@ftre/ui/tailwind` |

## renderer 适配方案

### 纯重导出组件
直接转发，零业务逻辑：
```typescript
// packages/renderer/src/components/ConfirmDialog.tsx
export { ConfirmDialog, type DialogButton, type ConfirmDialogProps } from "@ftre/ui";
```

适用：`ContextMenu`, `ConfirmDialog`, `FloatingWindow`, `ResizeHandle`

### 业务适配层
保留业务逻辑，props 传递给 UI 组件：
```typescript
// packages/renderer/src/components/NotificationStack.tsx
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

适用：`NotificationStack`, `CommandPalette`

### 保持原样
完全业务耦合，暂不解耦：
- `FilePalette` → 依赖 `@/stores/workspace`, `@/services/file-index-service`
- `LayoutSwitcher` → 依赖 `@/stores/layout`, `@dnd-kit`
- `PixelLogo` → 项目专属 Logo

## 主题系统

组件使用 CSS 变量，支持自定义主题：
```css
:root {
  --ftre-base-bg: #1e1e1e;
  --ftre-surface: #252526;
  --ftre-border: #3c3c3c;
  --ftre-text-primary: #cccccc;
  --ftre-text-secondary: #999999;
  --ftre-neon: #00ff9d;
  --ftre-neon-ghost: rgba(0, 255, 157, 0.1);
}
```

可选导入 Tailwind 预设：
```typescript
// tailwind.config.ts
import { ftreUiPreset } from "@ftre/ui/tailwind";
export default { presets: [ftreUiPreset], ... };
```

## 依赖关系

```
@ftre/ui (peerDependencies)
├── react >= 18.0.0
├── react-dom >= 18.0.0
└── tailwindcss >= 4.0.0

@ftre/ui (dependencies)
├── framer-motion
├── lucide-react
├── clsx
└── tailwind-merge

@ftre/renderer
├── @ftre/ui (workspace:*)
├── @ftre/editor
└── @ftre/shared
```

## 关键设计决策

1. **纯 UI 组件无状态** - 所有数据通过 props 传递，不依赖任何 store
2. **CSS 变量主题** - 不绑定特定配色，通过变量支持任意主题
3. **tsup 打包** - 输出 ESM + DTS，支持 Tree-shaking
4. **业务组件保留适配层** - 不解耦到面目全非，保持 renderer 使用习惯

## 已迁移组件

- [x] ContextMenu
- [x] ConfirmDialog
- [x] FloatingWindow
- [x] ResizeHandle
- [x] CommandPalette (泛型重构)
- [x] NotificationStack (受控化重构)
- [x] useThrottledValue
- [x] cn / menu-position

## 未来扩展

可考虑迁移（需抽象）：
- `FilePalette` → 抽象为 `SearchPalette<T>` 泛型组件
- `LayoutSwitcher` → 抽象为 `SortableToggleGroup`
