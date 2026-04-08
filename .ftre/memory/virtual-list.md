# 虚拟列表组件 (@ftre/virtual-list)

> 高性能虚拟列表组件，支持动态高度和固定高度两种模式。**当前文件树未使用此组件**，使用 `@tanstack/react-virtual` 替代。

## 包信息

| 属性 | 值 |
|------|-----|
| **位置** | `packages/virtual-list/` |
| **包名** | `@ftre/virtual-list` |
| **构建工具** | tsup |
| **测试框架** | vitest + @testing-library/react |
| **当前状态** | 已创建，65 个测试通过，**未接入文件树** |

## 核心文件

| 文件 | 职责 |
|------|------|
| `src/VirtualList.tsx` | 主组件，类组件实现，支持动态高度 |
| `src/vl-manager.ts` | VLManager 核心算法类，计算可见范围 |
| `src/types.ts` | TypeScript 类型定义 |
| `src/context.ts` | VirtualListContext 及相关 hooks |
| `src/utils.ts` | 工具函数（combineRef, throttle, cx 等） |
| `src/components/VLItemWrap.tsx` | 列表项包装组件（测量高度） |
| `src/components/VirtualRows.tsx` | 可见行渲染组件 |
| `src/hooks/useCacheState.ts` | 全局缓存状态 hook |
| `src/hooks/useIsAtBottom.ts` | 检测是否在底部 hook |
| `src/hooks/useVirtualization.ts` | 定高虚拟化 Hook |

## 导出内容

```ts
// 主组件
export { VirtualList }

// 工具
export { VLManager }
export { combineRef, isScrollElement, throttle, isEqual, cx }

// Hooks
export { useCacheState }
export { useIsAtBottom }
export { useVirtualListContext, useVirtualListDestroy }
export { useVirtualization }

// 子组件
export { VLItemWrap }
export { VirtualRows }
```

## 当前应用状态

| 场景 | 状态 | 说明 |
|------|------|------|
| **文件树** | ❌ 未使用 | 使用 `@tanstack/react-virtual` 替代 |
| 消息列表 | ⏳ 候选 | 计划使用，待实现 |
| 日志流 | ⏳ 候选 | 潜在适用场景 |

## 方案演进历史

### 1. 手动虚拟化
- 文件树最初使用简单手动实现的虚拟化

### 2. 尝试自研 @ftre/virtual-list
- 尝试将 `useVirtualization` Hook 集成到 `ExplorerView.tsx`
- 出现边界滚动抖动问题——滚动到顶部/底部时列表内容突然跳变
- 多次尝试修复未果（重构 VLManager、使用 useSyncExternalStore、优化边界计算等）
- 因边界"吸顶"问题放弃使用

### 3. 采用 @tanstack/react-virtual
- 安装 `@tanstack/react-virtual` 替代
- API 简洁，无边界抖动问题
- 文件树当前使用此方案

## 设计决策

### 为何自研方案在文件树中失败？

**尝试过程**：
1. 集成 `useVirtualization` Hook 到 `ExplorerView.tsx`
2. 出现边界滚动抖动问题
3. 多轮修复尝试未解决

**根因定位**：
- 顶部占位元素 (`topSpacer`) 在边界处会突然消失，导致视觉跳变
- 根本原因在于边界处的 overscan 计算和 topBlank 高度计算冲突

**决策**：文件树改用 `@tanstack/react-virtual`
- 保留 `@ftre/virtual-list` 包，待后续用于消息列表等场景

### 核心算法要点（仅作参考）

#### Overscan 基于像素而非项数

```ts
protected MAX_OVERSCAN_SIZE = this.bufferSize * this.presetHeight;

protected overscanUpwards(firstIndex: number): number {
  const toOverscan = this.MAX_OVERSCAN_SIZE;
  let height = 0;
  let index = firstIndex;
  while (height < toOverscan && index >= 0) {
    height += this.cache[index];
    index--;
  }
  return index + 1;
}
```

#### topBlank 必须遍历累加计算

❌ 错误做法（减法 + clamp 导致跳变）：
```ts
let topBlank = scrollTop - overscanHeight;
if (topIndex === 0) topBlank = 0;  // 跳变！
```

✅ 正确做法（遍历累加）：
```ts
let topBlank = 0;
for (let i = 0; i < topIndex; i++) {
  topBlank += this.cache[i];
}
```

#### 使用 useSyncExternalStore 同步滚动状态

```tsx
const scrollTop = useSyncExternalStore(
  (callback) => {
    el.addEventListener('scroll', callback);
    return () => el.removeEventListener('scroll', callback);
  },
  () => el?.scrollTop ?? 0,
  () => 0
);
```

## 使用示例

### 动态高度场景（消息列表）

```tsx
import { VirtualList, useCacheState } from '@ftre/virtual-list';

function ChatList({ messages }) {
  const [activeIndex, setActiveIndex] = useCacheState(0, 'chat-active-index');

  return (
    <VirtualList
      rows={messages}
      presetHeight={60}
      bufferSize={5}
      renderRow={(msg, idx) => <MessageBubble content={msg.content} />}
      eachUukey={(msg) => msg.id}
      listContainer={'scrollable-div'}
    />
  );
}
```

### 固定高度场景

```tsx
import { useVirtualization } from '@ftre/virtual-list';

function MyList({ items }) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { 
    startIndex, 
    endIndex, 
    topSpacerHeight, 
    bottomSpacerHeight,
    scrollToIndex 
  } = useVirtualization({
    count: items.length,
    getItemHeight: 32,
    containerRef,
    overscan: 12,
  });

  return (
    <div ref={containerRef} className="overflow-auto h-full">
      <div style={{ height: topSpacerHeight }} />
      {items.slice(startIndex, endIndex).map(item => (
        <Item key={item.id} data={item} />
      ))}
      <div style={{ height: bottomSpacerHeight }} />
    </div>
  );
}
```

## useVirtualization API

| 参数 | 类型 | 说明 |
|------|------|------|
| `count` | `number` | 总条目数 |
| `getItemHeight` | `number \| (index: number) => number` | 行高 |
| `containerRef` | `RefObject<HTMLElement>` | 容器 ref |
| `overscan?` | `number` | 额外渲染行数，默认 5 |
| `forceIncludeRange?` | `{ start, end } \| null` | 强制包含的索引范围 |

| 返回值 | 类型 | 说明 |
|--------|------|------|
| `startIndex` | `number` | 可见起始索引 |
| `endIndex` | `number` | 可见结束索引（含） |
| `topSpacerHeight` | `number` | 顶部占位高度 |
| `bottomSpacerHeight` | `number` | 底部占位高度 |
| `scrollToIndex` | `(index: number, behavior?) => void` | 滚动到指定行 |

## 测试覆盖

总计 65 个测试 ✅ 全部通过：
- `vl-manager.test.ts`: 15 个测试
- `utils.test.ts`: 20 个测试
- `useCacheState.test.tsx`: 6 个测试
- `useVirtualization.test.ts`: 10 个测试
- `VirtualList.test.tsx`: 14 个测试

## 注意事项

- `presetHeight` 是预估高度，实际高度会在渲染后自动测量
- 组件内部使用 ResizeObserver，需在 test setup 中 mock
- **滚动同步**: 必须使用 useSyncExternalStore 同步读取滚动位置，不能用 useState + RAF 节流
- **topBlank 计算**: 必须遍历累加，不能用减法或特殊边界处理
- **Overscan**: 使用基于像素的算法，避免边界"吸顶"效果
- **调试建议**: 出现滚动抖动时，优先检查 `topSpacerHeight` 在边界处的变化是否平滑，避免突然跳变到 0

## 相关文件

- 包位置: `packages/virtual-list/`
- 文件树实现: `packages/renderer/src/features/explorer/ExplorerView.tsx`（使用 `@tanstack/react-virtual`）
