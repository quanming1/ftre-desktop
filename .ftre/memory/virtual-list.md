# 虚拟列表组件 (@ftre/virtual-list)

> 高性能虚拟列表组件，支持动态高度和固定高度两种模式。适用于消息列表、日志流、文件树等场景。

## 包信息

| 属性 | 值 |
|------|-----|
| **位置** | `packages/virtual-list/` |
| **包名** | `@ftre/virtual-list` |
| **构建工具** | tsup |
| **测试框架** | vitest + @testing-library/react |

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
| `src/hooks/useVirtualization.ts` | **定高虚拟化 Hook（用于文件树）** |

## 实际应用

| 场景 | 文件 | 使用方式 |
|------|------|----------|
| 文件树虚拟化 | `packages/renderer/src/features/explorer/ExplorerView.tsx` | `useVirtualization` Hook |

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
export { useVirtualization }  // NEW: 定高虚拟化 Hook

// 子组件
export { VLItemWrap }
export { VirtualRows }
```

## 核心算法（VLManager）

### 可见范围计算

`VLManager.getRenderRange()` 基于以下参数计算：

```ts
interface VerticalRenderRange {
  topIndex: number;      // 第一个可见项索引（含 buffer）
  topBlank: number;      // 顶部空白高度
  bottomIndex: number;   // 最后一个可见项索引（不含，与 slice 一致）
  bottomBlank: number;   // 底部空白高度
}
```

### 正确计算 topBlank/bottomBlank

**关键原则**: `topBlank` 和 `bottomBlank` 必须通过**遍历累加计算**，不能通过中间变量做减法。

```ts
// ✅ 正确: 直接遍历计算
calculateBlanks(range: VerticalRenderRange): void {
  // 计算 topBlank: topIndex 之前所有项的高度总和
  let topBlank = 0;
  for (let i = 0; i < range.topIndex; i++) {
    topBlank += this.cache[i];
  }
  
  // 计算 bottomBlank: bottomIndex 之后所有项的高度总和
  let bottomBlank = 0;
  for (let i = range.bottomIndex; i < this.cache.length; i++) {
    bottomBlank += this.cache[i];
  }
  
  return { topBlank, bottomBlank };
}
```

**错误做法** (会导致跳变):
```ts
// ❌ 错误: 通过减法计算，边界处会突然跳变到 0
let topBlank = scrollTop - overscanHeight;
if (topIndex === 0) topBlank = 0;  // 这种 clamp 会导致跳变
```

### Overscan 算法（关键）

**基于像素的 overscan，不是基于项数：**

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

**为什么用像素而非项数？**
- 边界滚动时，如果用项数，渲染项数会突变（比如从 10 项突然变 3 项）
- 导致 spacer 高度剧烈变化，产生**"吸顶"效果**（列表突然吸附到顶部/底部）
- 基于像素则滚动过程中渲染高度保持稳定，体验流畅

### 缓存管理

- `cache: number[]` 存储每个 item 的实测高度
- 初始值全部设为 `presetHeight`
- 渲染后通过 `VLItemWrap` 测量并更新 `setCache(index, height)`

## 使用示例

### 动态高度场景（消息列表）

```tsx
import { VirtualList, useCacheState } from '@ftre/virtual-list';

function ChatList({ messages }) {
  const [activeIndex, setActiveIndex] = useCacheState(0, 'chat-active-index');

  return (
    <VirtualList
      rows={messages}
      presetHeight={60}              // 预估行高
      bufferSize={5}                 // 上下各多渲染5行
      renderRow={(msg, idx) => <MessageBubble content={msg.content} />}
      eachUukey={(msg) => msg.id}    // 唯一标识
      listContainer={'scrollable-div'}
    />
  );
}
```

### 固定高度场景（文件树）- useVirtualization Hook

```tsx
import { useVirtualization } from '@ftre/virtual-list';

function ExplorerView({ flatEntries }) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { 
    startIndex, 
    endIndex, 
    topSpacerHeight, 
    bottomSpacerHeight, 
    scrollToIndex 
  } = useVirtualization({
    count: flatEntries.length,
    getItemHeight: 32,             // 固定行高
    containerRef,
    overscan: 12,                  // 上下各多渲染12行
    forceIncludeRange: pendingTargetIndex >= 0 
      ? { start: pendingTargetIndex, end: pendingTargetIndex }
      : null,                      // 确保 InlineInput 所在行被渲染
  });

  return (
    <div ref={containerRef} className="overflow-auto h-full">
      <div style={{ height: topSpacerHeight }} />
      {flatEntries.slice(startIndex, endIndex).map(entry => (
        <FileTreeItem key={entry.path} entry={entry} />
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
| `getItemHeight` | `number \| (index: number) => number` | 行高（支持固定或动态） |
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

## 适用场景

| 场景 | 建议方案 |
|------|----------|
| 消息列表 (动态高度) | ✅ VirtualList 组件 |
| 日志流 (动态高度) | ✅ VirtualList 组件 |
| 文件树 (固定行高) | ✅ useVirtualization Hook |

## 设计决策

### 文件树为何选择 useVirtualization Hook 而非 VirtualList 组件？

**背景**: 文件树原有手动虚拟化实现，直接替换为 VirtualList 组件会导致问题：
- 需要内联 InlineInput（新建文件/文件夹时的输入框），这不是普通的 FileTreeItem
- 需要支持 pending 状态的视觉反馈（目标行高亮）
- 需要处理 forceIncludeRange 确保 InlineInput 可见

**决策**: 采用 **方案C** - 抽取 `useVirtualization` Hook

**原因**:
1. **控制权保留**: 保留 JSX 控制权，可自由插入 InlineInput
2. **渐进重构**: 不改现有数据结构（FlatEntry），只替换虚拟化逻辑
3. **代码复用**: VirtualList 底层算法复用
4. **复杂度适中**: 比 "方案A 直接替换" 简单，比 "方案B 保持现状" 优雅

**文件树特殊处理**:
```tsx
// 计算 pending 操作的目标行索引，扩展可见范围
const forceIncludeRange = useMemo(() => {
  let targetIndex = -1;
  if (pendingCreate) {
    targetIndex = flatEntries.findIndex((e) => e.path === pendingCreate.dirPath);
  } else if (pendingRename) {
    targetIndex = flatEntries.findIndex((e) => e.path === pendingRename.path);
  }
  if (targetIndex < 0) return null;
  return { start: targetIndex - 5, end: targetIndex + 5 }; // 扩展范围确保可见
}, [flatEntries, pendingCreate, pendingRename]);
```

### 为何使用 useSyncExternalStore 而非 useState + RAF？

**问题**: `useVirtualization` 早期实现使用 `useState` + `requestAnimationFrame` 节流滚动事件，导致**滚动跳跃**（jank）问题。

**原因**: `useState` 更新是异步的，而渲染是同步的。滚动位置已变但状态未更新，造成一帧的视觉错位。

**解决方案**: 使用 `useSyncExternalStore` 同步订阅滚动状态
- 滚动状态通过 `getSnapshot()` 同步读取
- 避免 React 并发渲染下的状态撕裂（tearing）
- 引用稳定，不触发额外重渲染

**关键代码** (`useVirtualization.ts`):
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

### 为何 Overscan 基于像素而非项数？

**问题**: 滚动到顶部/底部边界时出现**"吸顶效果"**——列表突然吸附到边界，体验不流畅。

**原因分析**: 
- 基于项数的 overscan：边界附近可用空间不足，渲染项数从 N 突然跳到 N/3
- 导致 `topBlank` 或 `bottomBlank` 剧烈变化，产生视觉跳跃

**解决方案**:
- 使用基于像素的 overscan 算法：`MAX_OVERSCAN_SIZE = bufferSize * presetHeight`
- 滚动过程中总渲染高度保持稳定，避免突变
- 边界处仍能保持平滑滚动体验

### 为何 topBlank 必须直接遍历计算而非减法？

**问题**: 滚动到顶部时，`topSpacerHeight` 突然从非零值跳变到 0，导致列表内容瞬间上跳。

**原因分析**:
```ts
// ❌ 错误做法: 用减法 + clamp
let topBlank = scrollTop - overscanHeight;
if (topIndex === 0) {
  topBlank = 0;  // 当 topIndex 变为 0 时，topBlank 突然跳变
}
```
当 `topIndex` 从 1 变为 0 时，`topBlank` 可能从某个正值瞬间变为 0，产生视觉跳变。

**解决方案**:
```ts
// ✅ 正确做法: 遍历累加计算
let topBlank = 0;
for (let i = 0; i < topIndex; i++) {
  topBlank += this.cache[i];
}
```
- `topBlank` 始终是 `topIndex` 之前所有项的高度总和
- 即使 `topIndex` 变化，计算结果也是连续变化的，不会跳变
- 滚动到顶部时，`topBlank` 自然为 0，无需特殊处理

## 测试覆盖

- **vl-manager.test.ts**: 15 个测试（范围计算、缓存逻辑）
- **utils.test.ts**: 20 个测试（工具函数）
- **useCacheState.test.tsx**: 6 个测试（hook）
- **useVirtualization.test.ts**: 10 个测试
- **VirtualList.test.tsx**: 14 个测试（组件渲染）

**总计**: 65 个测试 ✅ 全部通过

## 注意事项

- `presetHeight` 是预估高度，实际高度会在渲染后自动测量
- `forceRenderItem` 可用于标记编辑中的行，避免被虚拟化移除
- **⚠️ 滚动同步**: 虚拟列表滚动位置必须通过同步方式读取（useSyncExternalStore），不能使用 useState + RAF 节流，否则会导致滚动跳跃
- **⚠️ Overscan 算法**: `VLManager` 使用基于像素的 overscan 而非项数，避免边界滚动时的"吸顶"效果
- **⚠️ topBlank 计算**: 必须通过遍历累加计算，不能通过减法或中间变量，否则顶部会出现跳变
- 组件内部使用 ResizeObserver，需在 test setup 中 mock
- 文件树的 `forceIncludeRange` 需考虑上下缓冲，确保 InlineInput 完整可见

## 相关文档

- 设计文档: `.ftre/specs/file-tree-virtual-list/plan.md`
