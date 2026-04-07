# UI 组件库拆分 (@ftre/ui)

> 基于 Radix UI 的 React 组件库，遵循 ftre 设计规范

## 包结构

```
packages/ui/
├── src/
│   ├── components/
│   │   ├── Button.tsx             # 按钮 (primary/secondary/ghost/danger)
│   │   ├── Input.tsx              # 输入框
│   │   ├── Tooltip.tsx            # 工具提示 (@radix-ui/react-tooltip)
│   │   ├── Dialog.tsx             # 对话框 (@radix-ui/react-dialog)
│   │   ├── AlertDialog.tsx        # 确认对话框 (@radix-ui/react-alert-dialog)
│   │   ├── DropdownMenu.tsx       # 下拉菜单 (@radix-ui/react-dropdown-menu)
│   │   ├── ContextMenu.tsx        # 右键菜单 (命令式 API，向后兼容)
│   │   ├── ContextMenuRadix.tsx   # 右键菜单 (Radix 声明式 API)
│   │   ├── Select.tsx             # 下拉选择 (@radix-ui/react-select)
│   │   ├── Switch.tsx             # 开关 (@radix-ui/react-switch)
│   │   ├── Checkbox.tsx           # 复选框 (@radix-ui/react-checkbox)
│   │   ├── Tabs.tsx               # 标签页 (@radix-ui/react-tabs)
│   │   ├── FloatingWindow.tsx     # 浮动窗口（拖拽/缩放）
│   │   ├── ResizeHandle.tsx       # 拖拽调整手柄
│   │   ├── CommandPalette.tsx     # 命令面板（泛型）
│   │   ├── NotificationStack.tsx  # 通知栈（受控组件）
│   │   ├── ConfirmDialog.tsx      # [deprecated] 使用 AlertDialog
│   │   ├── diff-summary/          # Diff 摘要卡片
│   │   └── index.ts
│   ├── hooks/
│   │   └── useThrottledValue.ts
│   ├── utils/
│   │   ├── cn.ts                  # tailwind-merge
│   │   └── menu-position.ts       # 菜单位置计算
│   ├── index.ts                   # 主入口
│   ├── styles.css                 # CSS 变量定义
│   └── tailwind-preset.ts         # Tailwind CSS 预设
├── dist/                          # 构建产物
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

## 组件分类

### 基于 Radix UI 的组件

| 组件 | Radix 包 | 说明 |
|------|----------|------|
| `Button` | - | 按钮（primary/secondary/ghost/danger） |
| `Input` | - | 输入框 |
| `Tooltip` | @radix-ui/react-tooltip | 工具提示 |
| `Dialog` | @radix-ui/react-dialog | 对话框 |
| `AlertDialog` | @radix-ui/react-alert-dialog | 确认对话框 |
| `DropdownMenu` | @radix-ui/react-dropdown-menu | 下拉菜单 |
| `ContextMenuRadix` | @radix-ui/react-context-menu | 右键菜单（声明式） |
| `Select` | @radix-ui/react-select | 下拉选择 |
| `Switch` | @radix-ui/react-switch | 开关 |
| `Checkbox` | @radix-ui/react-checkbox | 复选框 |
| `Tabs` | @radix-ui/react-tabs | 标签页 |

### 自定义组件

| 组件 | 说明 |
|------|------|
| `ContextMenu` | 命令式 API，向后兼容（传入 items/position/onClose） |
| `FloatingWindow` | 可拖拽浮动窗口 |
| `ResizeHandle` | 拖拽调整大小 |
| `CommandPalette` | 命令面板 |
| `NotificationStack` | 通知堆栈 |
| `DiffSummaryCard` | Diff 摘要卡片 |

## 导出清单

| 类别 | 导出项 | 路径 |
|------|--------|------|
| 基础组件 | `Button`, `Input`, `Tooltip`, `TooltipProvider` | `@ftre/ui` |
| 对话框 | `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `AlertDialog`, `AlertDialogContent`, `AlertDialogAction`, `AlertDialogCancel` 等 | `@ftre/ui` |
| 菜单 | `DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem`, `ContextMenu` (命令式), `ContextMenuRadix` (声明式) 等 | `@ftre/ui` |
| 表单 | `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `Switch`, `Checkbox`, `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | `@ftre/ui` |
| 自定义 | `FloatingWindow`, `ResizeHandle`, `CommandPalette`, `NotificationStack`, `DiffSummaryCard` | `@ftre/ui` |
| Hooks | `useThrottledValue` | `@ftre/ui` |
| 工具 | `cn`, `adjustMenuPosition` | `@ftre/ui` |
| 样式 | `ftreUiPreset` | `@ftre/ui/tailwind` |
| CSS | CSS 变量 | `@ftre/ui/styles.css` |

## 主题系统

组件使用 CSS 变量，支持自定义主题：

```css
:root {
  /* 背景层级 */
  --ftre-base: #1e1e1e;
  --ftre-surface: #252526;
  --ftre-elevated: #2d2d2d;
  --ftre-panel: #333333;

  /* 品牌色（霓虹绿） */
  --ftre-accent: #00ff88;
  --ftre-accent-hover: #00cc6e;
  --ftre-accent-dim: rgba(0, 255, 136, 0.12);
  --ftre-accent-ghost: rgba(0, 255, 136, 0.06);

  /* 边框 */
  --ftre-border: #3c3c3c;

  /* 文字 */
  --ftre-text-primary: #e8e8e8;
  --ftre-text-secondary: #cccccc;
  --ftre-text-muted: #aab0b8;
  --ftre-text-ghost: #888e98;

  /* 语义色 */
  --ftre-error: #f85149;
  --ftre-warning: #d29922;
  --ftre-info: #58a6ff;
  --ftre-success: #00ff88;
}
```

## 依赖关系

```
@ftre/ui (peerDependencies)
├── react >= 18.0.0
├── react-dom >= 18.0.0
└── tailwindcss >= 4.0.0

@ftre/ui (dependencies)
├── @radix-ui/react-* (10个包)
├── framer-motion
├── lucide-react
├── clsx
└── tailwind-merge
```

## ContextMenu 双 API 说明

保留两种 API 以确保向后兼容：

### 命令式 API（向后兼容）

```tsx
// 用于需要动态控制菜单位置的场景
const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

<ContextMenu
  items={[
    { id: "copy", label: "复制", action: () => copy() },
    { id: "sep", separator: true },
    { id: "delete", label: "删除", action: () => del() },
  ]}
  position={contextMenu}
  onClose={() => setContextMenu(null)}
/>
```

### 声明式 API（Radix 风格）

```tsx
// 用于右键触发菜单的场景
<ContextMenuRadix>
  <ContextMenuTrigger>右键点击这里</ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItemRadix onSelect={() => copy()}>复制</ContextMenuItemRadix>
    <ContextMenuSeparator />
    <ContextMenuItemRadix onSelect={() => del()}>删除</ContextMenuItemRadix>
  </ContextMenuContent>
</ContextMenuRadix>
```

## 关键设计决策

1. **基于 Radix UI** - 完善的无障碍支持、焦点管理、键盘导航
2. **CSS 变量主题** - 不绑定特定配色，通过变量支持任意主题
3. **遵循 ftre 设计规范** - 霓虹绿品牌色、深色背景层级、4px 间距系统
4. **向后兼容** - ContextMenu 保留命令式 API，不破坏现有代码
5. **tsup 打包** - 输出 ESM + DTS，支持 Tree-shaking

## 已迁移组件

- [x] Button (新增)
- [x] Input (新增)
- [x] Tooltip (新增，基于 Radix)
- [x] Dialog (新增，基于 Radix)
- [x] AlertDialog (新增，基于 Radix)
- [x] DropdownMenu (新增，基于 Radix)
- [x] ContextMenu (重写，保持命令式 API)
- [x] ContextMenuRadix (新增，Radix 声明式 API)
- [x] Select (新增，基于 Radix)
- [x] Switch (新增，基于 Radix)
- [x] Checkbox (新增，基于 Radix)
- [x] Tabs (新增，基于 Radix)
- [x] FloatingWindow
- [x] ResizeHandle
- [x] CommandPalette
- [x] NotificationStack
- [x] DiffSummaryCard
- [x] useThrottledValue
- [x] cn / menu-position
