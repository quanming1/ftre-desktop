# @ftre/ui

基于 [Radix UI](https://www.radix-ui.com/) 的 React 组件库，遵循 ftre 设计规范。

## 特性

- 基于 Radix UI Primitives 构建，完善的无障碍支持
- 使用 Tailwind CSS + CSS 变量，易于主题定制
- 符合 ftre 设计规范（霓虹绿品牌色、深色主题）
- TypeScript 类型完备
- Tree-shakable

## 安装

```bash
pnpm add @ftre/ui
```

### Peer Dependencies

```bash
pnpm add react react-dom tailwindcss
```

## 使用

### 1. 导入样式

```ts
// 在入口文件导入 CSS 变量
import "@ftre/ui/styles.css";
```

### 2. 配置 Tailwind（可选）

如果需要在自己的组件中使用 ftre 主题色：

```ts
// tailwind.config.ts
import ftreUiPreset from "@ftre/ui/tailwind";

export default {
  presets: [ftreUiPreset],
  // ...
};
```

### 3. 使用组件

```tsx
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from "@ftre/ui";

function App() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="primary">打开对话框</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>标题</DialogTitle>
        </DialogHeader>
        <p>内容...</p>
      </DialogContent>
    </Dialog>
  );
}
```

## 组件列表

### 基础组件

| 组件 | 说明 |
|------|------|
| `Button` | 按钮，支持 primary/secondary/ghost/danger 变体 |
| `Input` | 输入框 |
| `Checkbox` | 复选框 |
| `Switch` | 开关 |
| `Tabs` | 标签页 |

### 弹层组件

| 组件 | 说明 |
|------|------|
| `Dialog` | 对话框 |
| `AlertDialog` | 确认对话框（带确认/取消按钮） |
| `DropdownMenu` | 下拉菜单 |
| `ContextMenu` | 右键菜单 |
| `Select` | 下拉选择 |
| `Tooltip` | 工具提示 |

### 自定义组件

| 组件 | 说明 |
|------|------|
| `FloatingWindow` | 可拖拽调整大小的浮动窗口 |
| `ResizeHandle` | 拖拽调整大小手柄 |
| `CommandPalette` | 命令面板 |
| `NotificationStack` | 通知堆栈 |

## 主题定制

组件使用 CSS 变量，可以通过覆盖变量来自定义主题：

```css
:root {
  /* 覆盖品牌色 */
  --ftre-accent: #3b82f6;
  --ftre-accent-hover: #2563eb;

  /* 覆盖背景色 */
  --ftre-base: #0f0f0f;
  --ftre-elevated: #1a1a1a;
}
```

### 可用的 CSS 变量

**背景层级**
- `--ftre-base` - 主背景 (#1a1b1d)
- `--ftre-surface` - 侧边栏/面板背景 (#1a1b1d)
- `--ftre-elevated` - 浮动元素背景 (#252526)
- `--ftre-panel` - 输入框/卡片背景 (#2d2d2d)

**品牌色**
- `--ftre-accent` - 主强调色 (#00ff88)
- `--ftre-accent-hover` - 悬停色 (#00cc6e)
- `--ftre-accent-dim` - 低透明度强调 (rgba(0,255,136,0.12))
- `--ftre-accent-ghost` - 极淡强调 (rgba(0,255,136,0.06))

**边框**
- `--ftre-border` - 主边框 (#3c3c3c)
- `--ftre-border-subtle` - 次要边框 (#454545)

**文字**
- `--ftre-text-primary` - 主要文字 (#e8e8e8)
- `--ftre-text-secondary` - 次要文字 (#cccccc)
- `--ftre-text-muted` - 辅助文字 (#aab0b8)
- `--ftre-text-ghost` - 占位符 (#888e98)

**语义色**
- `--ftre-success` - 成功 (#00ff88)
- `--ftre-warning` - 警告 (#d29922)
- `--ftre-error` - 错误 (#f85149)
- `--ftre-info` - 信息 (#58a6ff)

## 开发

```bash
# 开发模式
pnpm dev

# 构建
pnpm build

# 类型检查
pnpm typecheck
```
