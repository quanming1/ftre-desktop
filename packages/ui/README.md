# @ftre/ui

A modern React component library with Tailwind CSS support.

## Installation

```bash
npm install @ftre/ui
# or
pnpm add @ftre/ui
```

## Peer Dependencies

This library requires the following peer dependencies:

- `react` >= 18.0.0
- `react-dom` >= 18.0.0
- `tailwindcss` >= 4.0.0

## Setup

### 1. Add the Tailwind preset (optional)

```ts
// tailwind.config.ts
import { ftreUiPreset } from "@ftre/ui/tailwind";

export default {
  presets: [ftreUiPreset],
  // ... your config
};
```

### 2. Customize theme colors (optional)

Override CSS variables in your global CSS:

```css
:root {
  --ftre-base: #1a1a1a;
  --ftre-elevated: #1e1e1e;
  --ftre-accent: #00ff88;
  --ftre-accent-ghost: rgba(0, 255, 136, 0.1);
  --ftre-border: rgba(255, 255, 255, 0.06);
  --ftre-border-subtle: rgba(255, 255, 255, 0.08);
  --ftre-text-primary: #ffffff;
  --ftre-text-secondary: #999999;
  --ftre-text-muted: #777777;
  --ftre-text-ghost: #555555;
  --ftre-text-faint: #444444;
}
```

## Components

### ContextMenu

A context menu with keyboard navigation support.

```tsx
import { ContextMenu, type ContextMenuItem } from "@ftre/ui";

const items: ContextMenuItem[] = [
  { id: "copy", label: "Copy", shortcut: "Ctrl+C", action: () => {} },
  { id: "sep1", label: "", separator: true, action: () => {} },
  { id: "delete", label: "Delete", action: () => {} },
];

<ContextMenu
  items={items}
  position={{ x: 100, y: 100 }}
  onClose={() => setOpen(false)}
/>;
```

### ConfirmDialog

A confirmation dialog with customizable buttons.

```tsx
import { ConfirmDialog } from "@ftre/ui";

<ConfirmDialog
  title="Delete file?"
  message="This action cannot be undone."
  confirmLabel="Delete"
  cancelLabel="Cancel"
  onConfirm={() => handleDelete()}
  onCancel={() => setOpen(false)}
/>;
```

### FloatingWindow

A draggable and resizable floating window.

```tsx
import { FloatingWindow } from "@ftre/ui";

<FloatingWindow
  title="Preview"
  visible={isVisible}
  onClose={() => setVisible(false)}
  defaultRect={{ x: 100, y: 100, width: 600, height: 400 }}
>
  <div>Window content</div>
</FloatingWindow>;
```

### CommandPalette

A command palette with fuzzy search.

```tsx
import { CommandPalette, type CommandItem } from "@ftre/ui";

const commands: CommandItem[] = [
  { id: "save", label: "Save File", shortcut: "Ctrl+S" },
  { id: "open", label: "Open File", shortcut: "Ctrl+O" },
];

<CommandPalette
  open={isOpen}
  onClose={() => setOpen(false)}
  items={commands}
  onSelect={(item) => executeCommand(item.id)}
  placeholder="Type a command..."
/>;
```

### NotificationStack

A notification stack with auto-dismiss support.

```tsx
import { NotificationStack, type NotificationItem } from "@ftre/ui";

const notifications: NotificationItem[] = [
  { id: "1", level: "info", message: "File saved successfully" },
  { id: "2", level: "error", message: "Failed to connect" },
];

<NotificationStack
  notifications={notifications}
  onDismiss={(id) => removeNotification(id)}
  position="bottom-right"
/>;
```

### ResizeHandle

A resize handle for resizable panels.

```tsx
import { ResizeHandle } from "@ftre/ui";

<ResizeHandle
  direction="horizontal"
  onResize={(delta) => setWidth((w) => w + delta)}
/>;
```

## Hooks

### useThrottledValue

Throttle value updates during streaming.

```tsx
import { useThrottledValue } from "@ftre/ui";

const throttled = useThrottledValue(value, 100, isStreaming);
```

## Utilities

### cn

Merge class names with Tailwind CSS support.

```tsx
import { cn } from "@ftre/ui";

<div className={cn("base-class", isActive && "active-class")} />;
```

### adjustMenuPosition

Calculate menu position to stay within viewport.

```tsx
import { adjustMenuPosition } from "@ftre/ui";

const adjusted = adjustMenuPosition(
  { x: clickX, y: clickY },
  { width: menuWidth, height: menuHeight },
  { width: window.innerWidth, height: window.innerHeight },
);
```

## License

MIT
