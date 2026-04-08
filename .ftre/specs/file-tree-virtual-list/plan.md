# 文件树虚拟列表集成方案

## 一、现状分析

### 1.1 当前文件树实现

**文件**: `packages/renderer/src/features/explorer/ExplorerView.tsx`

当前使用**手动虚拟化**实现：
- 固定行高 `EXPLORER_ROW_HEIGHT = 32px`
- 固定 overscan `EXPLORER_OVERSCAN = 12`
- 通过 `scrollTop` + `viewportHeight` 计算可见范围
- 使用 `topSpacer` / `bottomSpacer` 占位

**核心逻辑**:
```tsx
// 基础可见范围
const baseStartIndex = Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN;
const baseEndIndex = baseStartIndex + visibleCount + OVERSCAN * 2;

// pending 操作时扩展范围
if (pendingTargetIndex >= 0) {
  startIndex = Math.min(startIndex, pendingTargetIndex - 5);
  endIndex = Math.max(endIndex, pendingTargetIndex + 6);
}
```

### 1.2 特殊交互需求

| 需求 | 说明 |
|------|------|
| **InlineInput 插入** | 新建/重命名时在特定位置插入输入框 |
| **键盘导航** | ArrowUp/Down/Left/Right + Enter 需要访问全量数据 |
| **焦点滚动** | 焦点项需自动滚动到可视区域 |
| **拖拽** | dragOverPath 需要始终可见 |
| **展开/折叠** | 动态改变列表长度 |

### 1.3 新虚拟列表组件特性

**文件**: `packages/virtual-list/src/VirtualList.tsx`

- ✅ 动态高度测量与缓存
- ✅ 可配置 bufferSize
- ✅ `forceRenderItem` 强制渲染指定项
- ✅ `scrollToIndex` 方法
- ✅ `saveRenderedIndex` 保持已渲染项
- ❌ 不支持中间插入额外元素（InlineInput）
- ❌ 不支持 pending 范围扩展

## 二、方案对比

### 方案 A：直接使用 @ftre/virtual-list（不推荐）

**改造点**:
1. 将 `flatEntries` 传入 `VirtualList.rows`
2. 用 `forceRenderItem` 处理 pending 位置
3. InlineInput 需要作为特殊的 "虚拟行" 插入数据源

**问题**:
- 固定行高场景使用动态测量有性能开销
- InlineInput 插入破坏数据源纯净性
- pending 范围扩展逻辑需要重写

**结论**: 杀鸡用牛刀，不匹配

---

### 方案 B：扩展 @ftre/virtual-list 支持固定行高模式

**改造点**:
1. 新增 `fixedHeight` prop，跳过动态测量
2. 新增 `insertAt` 机制支持任意位置插入额外内容
3. 新增 `extendVisibleRange` 回调

**优点**:
- 一个组件覆盖固定/动态两种场景
- 文件树可以更简洁

**缺点**:
- 组件 API 膨胀
- 固定高度和动态高度逻辑耦合

**结论**: 可行但增加复杂度

---

### 方案 C：抽取通用 Hook + 保持文件树独立实现（推荐）

**核心思路**:
- 将虚拟化核心逻辑抽取为 `useVirtualization` hook
- 文件树使用 hook + 自定义渲染
- VirtualList 组件也使用同一 hook

**改造点**:

1. **新增 Hook**: `packages/virtual-list/src/hooks/useVirtualization.ts`
```tsx
interface UseVirtualizationOptions<T> {
  items: T[];
  itemHeight: number | ((index: number) => number);
  overscan?: number;
  containerRef: RefObject<HTMLElement>;
  // 强制包含的索引范围
  forceIncludeRange?: { start: number; end: number } | null;
}

interface UseVirtualizationResult {
  visibleRange: { start: number; end: number };
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  totalHeight: number;
  scrollToIndex: (index: number) => void;
}
```

2. **文件树使用**:
```tsx
const { visibleRange, topSpacerHeight, bottomSpacerHeight, scrollToIndex } = 
  useVirtualization({
    items: flatEntries,
    itemHeight: 32,
    overscan: 12,
    containerRef: treeContainerRef,
    forceIncludeRange: pendingTargetIndex >= 0 
      ? { start: pendingTargetIndex - 5, end: pendingTargetIndex + 5 }
      : null,
  });
```

3. **VirtualList 内部重构**:
```tsx
// 内部使用同一 hook，保持 API 不变
const { visibleRange, ... } = useVirtualization({
  items: rows,
  itemHeight: (index) => manager.getCache(index),
  ...
});
```

**优点**:
- 逻辑复用，减少重复代码
- 文件树保持渲染控制权（InlineInput 插入）
- 不破坏现有 VirtualList API
- 固定/动态高度通过 `itemHeight` 参数区分

**缺点**:
- 需要重构 VirtualList 内部实现

---

### 方案 D：最小改动 - 仅共享 VLManager（折中）

**核心思路**:
- 文件树直接使用 `VLManager` 做范围计算
- 保持现有渲染结构不变

**改造点**:
```tsx
import { VLManager } from '@ftre/virtual-list';

// 固定高度场景，VLManager 退化为简单计算器
const manager = useMemo(() => new VLManager({
  len: flatEntries.length,
  presetHeight: 32,
  bufferSize: 12,
}), [flatEntries.length]);

const range = manager.getRenderRange({
  offsetOfTop: scrollTop,
  maxRenderHeight: viewportHeight,
  len: flatEntries.length,
});

// pending 扩展
if (pendingTargetIndex >= 0) {
  range.topIndex = Math.min(range.topIndex, pendingTargetIndex - 5);
  range.bottomIndex = Math.max(range.bottomIndex, pendingTargetIndex + 6);
}
```

**优点**:
- 改动最小
- 复用范围计算逻辑
- 不影响渲染结构

**缺点**:
- VLManager 的缓存逻辑对固定高度场景是冗余的
- 没有充分发挥虚拟列表组件的价值

## 三、推荐方案

### 采用方案 C（Hook 抽取）+ 分阶段实施

#### 阶段一：抽取 useVirtualization Hook

**目标**: 将虚拟化核心逻辑独立为可复用 Hook

**产出**:
- `packages/virtual-list/src/hooks/useVirtualization.ts`
- 支持固定高度 + 动态高度
- 支持 forceIncludeRange

**代码量**: ~150 行

#### 阶段二：文件树迁移

**目标**: ExplorerView 使用 useVirtualization Hook

**改动**:
- 移除手动的 scrollTop/viewportHeight 状态
- 移除手动的 startIndex/endIndex 计算
- 保留 InlineInput 插入逻辑
- 保留键盘导航逻辑

**代码减少**: ~50 行

#### 阶段三：VirtualList 内部重构（可选）

**目标**: VirtualList 组件内部使用 useVirtualization Hook

**收益**:
- 代码统一
- 更容易维护

## 四、API 设计

### useVirtualization Hook

```typescript
interface UseVirtualizationOptions {
  /** 总项目数 */
  count: number;
  
  /** 单项高度：固定值或动态函数 */
  getItemHeight: number | ((index: number) => number);
  
  /** 滚动容器 ref */
  containerRef: RefObject<HTMLElement | null>;
  
  /** 缓冲区项目数，默认 10 */
  overscan?: number;
  
  /** 强制包含的索引范围（用于 pending 操作） */
  forceIncludeRange?: { start: number; end: number } | null;
  
  /** 高度变化回调（动态高度时使用） */
  onHeightChange?: (index: number, height: number) => void;
}

interface VirtualizationResult {
  /** 可见范围 [startIndex, endIndex) */
  startIndex: number;
  endIndex: number;
  
  /** 顶部占位高度 */
  topSpacerHeight: number;
  
  /** 底部占位高度 */
  bottomSpacerHeight: number;
  
  /** 总高度 */
  totalHeight: number;
  
  /** 滚动到指定索引 */
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void;
  
  /** 报告项目高度（动态高度时调用） */
  measureItem: (index: number, height: number) => void;
}
```

### 文件树使用示例

```tsx
function ExplorerView() {
  const treeContainerRef = useRef<HTMLDivElement>(null);
  
  const {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    scrollToIndex,
  } = useVirtualization({
    count: flatEntries.length,
    getItemHeight: 32, // 固定高度
    containerRef: treeContainerRef,
    overscan: 12,
    forceIncludeRange: pendingTargetIndex >= 0
      ? { start: pendingTargetIndex - 5, end: pendingTargetIndex + 5 }
      : null,
  });
  
  // 焦点滚动
  useEffect(() => {
    if (focusedPath) {
      const index = flatEntries.findIndex(e => e.path === focusedPath);
      if (index >= 0) scrollToIndex(index);
    }
  }, [focusedPath, scrollToIndex]);
  
  return (
    <div ref={treeContainerRef} className="overflow-auto">
      <div style={{ height: topSpacerHeight }} />
      {flatEntries.slice(startIndex, endIndex).map((entry, i) => (
        <FileTreeItem key={entry.path} ... />
        // InlineInput 插入逻辑保持不变
      ))}
      <div style={{ height: bottomSpacerHeight }} />
    </div>
  );
}
```

## 五、实施计划

| 阶段 | 任务 | 工时 | 风险 |
|------|------|------|------|
| 1 | 编写 useVirtualization Hook | 2h | 低 |
| 2 | 为 Hook 编写测试 | 1h | 低 |
| 3 | ExplorerView 迁移 | 2h | 中（需测试各种边界情况） |
| 4 | 回归测试 | 1h | - |
| 5 | VirtualList 内部重构（可选） | 2h | 低 |

**总计**: 6-8 小时

## 六、风险与回退

### 风险点

1. **键盘导航异常**: Hook 返回的范围不包含焦点项
   - 缓解: forceIncludeRange 覆盖焦点项

2. **InlineInput 定位错误**: 插入位置计算与新范围不匹配
   - 缓解: 保持现有 pendingCreateInfo 计算逻辑

3. **滚动抖动**: scrollToIndex 与手动滚动冲突
   - 缓解: 使用 scrollIntoViewIfNeeded 策略

### 回退方案

如果方案 C 实施遇到阻碍，可降级到方案 D（仅共享 VLManager），改动最小。

## 七、后续优化

1. **虚拟列表组件统一**: 所有虚拟滚动场景使用同一 Hook
2. **性能监控**: 添加虚拟化性能指标（渲染项数、滚动帧率）
3. **文档完善**: 补充虚拟列表使用指南
