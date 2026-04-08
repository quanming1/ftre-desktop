# @ftre/virtual-list

A high-performance virtual list component for React with dynamic height support.

## Features

- **Dynamic Height**: Automatically measures and caches item heights
- **Buffer Rendering**: Renders extra items above/below viewport for smooth scrolling
- **Force Render**: Support for always-rendered items (e.g., editing items)
- **Scroll Utilities**: Built-in scroll-to-bottom, scroll-to-index
- **Cache State Hook**: Preserve component state when items are virtualized
- **TypeScript**: Full type support

## Installation

```bash
pnpm add @ftre/virtual-list
```

## Usage

```tsx
import { VirtualList } from '@ftre/virtual-list';

interface Message {
  id: string;
  content: string;
}

const messages: Message[] = [
  { id: '1', content: 'Hello' },
  { id: '2', content: 'World' },
  // ...
];

function ChatList() {
  return (
    <VirtualList
      rows={messages}
      presetHeight={50}
      renderRow={(msg, index) => (
        <div key={msg.id}>
          {msg.content}
        </div>
      )}
      eachUukey={(msg) => msg.id}
      bufferSize={10}
      defaultScrollToBottom
    />
  );
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `rows` | `T[]` | required | Data array to render |
| `presetHeight` | `number` | required | Estimated height per item |
| `renderRow` | `(row: T, index: number) => ReactElement` | required | Render function for each item |
| `eachUukey` | `(item: T, index: number) => string` | `index` | Unique key generator |
| `bufferSize` | `number` | `10` | Number of extra items to render |
| `forceRenderItem` | `((item, index) => boolean) \| number[]` | - | Items to always render |
| `saveRenderedIndex` | `boolean` | `false` | Keep rendered items in DOM |
| `defaultScrollToBottom` | `boolean` | `false` | Scroll to bottom on mount |
| `style` | `CSSProperties` | - | Container style |
| `className` | `string` | - | Container class |
| `itemStyle` | `CSSProperties` | - | Item wrapper style |
| `listContainerStyle` | `CSSProperties` | - | Inner container style |
| `extraOfBottom` | `ReactElement \| ReactElement[]` | - | Extra elements at bottom |
| `onMounted` | `(el: HTMLDivElement) => void` | - | Callback when mounted |

## Hooks

### useCacheState

Preserve state when items are virtualized:

```tsx
import { useCacheState } from '@ftre/virtual-list';

function Item({ id }: { id: string }) {
  const [expanded, setExpanded] = useCacheState(false, `item-${id}-expanded`);
  // State persists even when item is virtualized
}
```

### useIsAtBottom

Track scroll position:

```tsx
import { useIsAtBottom } from '@ftre/virtual-list';

function ChatList() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useIsAtBottom(wrapRef, 10);
  
  // Show "scroll to bottom" button when not at bottom
}
```

## Instance Methods

Access via ref:

```tsx
const listRef = useRef<VirtualList<Message>>(null);

// Scroll methods
listRef.current?.scrollToBottom('smooth');
listRef.current?.scrollToIndex(50, 'smooth');

// Utilities
listRef.current?.utils.isAtBottom(10);
listRef.current?.utils.scrollToBottomIfNotAtBottom(100);
listRef.current?.utils.getScrollTop();
listRef.current?.utils.setScrollTop(0);
```

## License

MIT
