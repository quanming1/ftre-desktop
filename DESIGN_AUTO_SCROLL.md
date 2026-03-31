# Auto Scroll 重构设计

> 移植 omni-flow-web 的 `useAutoScrollToBottom` 机制，替换当前的 `AutoScroll` 组件。

## 1. 现状问题

当前实现位于 `MessageList.tsx:130-141`，是一个内嵌在消息列表底部的空 div 组件：

```tsx
function AutoScroll() {
  const messageCount = useChat((s) => s.messages.length);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    });
  }, [messageCount]);
  return <div ref={bottomRef} />;
}
```

### 问题列表

| # | 问题 | 影响 |
|---|------|------|
| 1 | **无用户意图检测** | 用户向上滚动查看历史时，新消息到来会强制拉回底部，打断阅读 |
| 2 | **流式内容不跟踪** | 只监听 `messageCount` 变化。流式期间消息数量不变（只有 content 在 append），AI 输出长回复时视口不会跟随 |
| 3 | **无滚动条拖动检测** | 用户通过拖动滚动条向上浏览时，行为与滚轮不同，完全无法识别 |
| 4 | **无渐进恢复** | 用户解锁后，必须完全手动滚回底部，没有"接近底部自动恢复"的机制 |
| 5 | **scrollIntoView 精度问题** | `scrollIntoView` 在 CSS `contain` 容器和 `content-visibility: auto` 子元素下行为不一致 |

## 2. 目标实现分析

来源：`omni-flow-web/src/hooks/auto-scroll/`（3 个文件）

### 2.1 核心状态机

```
            ┌─────────────────────────────────────────────────────┐
            │                autoScrollLock = true                 │
            │            （自动滚动到底部，跟随新内容）              │
            └──────────────┬─────────────────────▲────────────────┘
                           │                     │
             wheel ↑ 或    │                     │  scroll 位置
            scrollbar 拖 ↑ │                     │  距底 < 100px
                           ▼                     │
            ┌──────────────────────────────────────────────────────┐
            │                autoScrollLock = false                 │
            │             （用户浏览历史，不自动滚动）               │
            └──────────────────────────────────────────────────────┘
```

### 2.2 三层交互检测

| 层级 | 事件 | 行为 |
|------|------|------|
| **wheel** | `deltaY < 0`（向上） | 解锁 + 记录 `lastWheelTopTime` |
| **wheel** | `deltaY > 0`（向下） | 清除 `lastWheelTopTime` |
| **scroll** | 距底 < `FORCE_LOCK_DISTANCE`(100px) | 恢复锁定（但在 wheel 防抖窗口 200ms 内忽略，防止向上滚动的惯性 scroll 触发误锁） |
| **scrollbar drag** | mousedown 在滚动条区域 + scroll 方向向上 | 解锁 |
| **scrollbar drag** | 方向向下 | 清除 `lastWheelTopTime`（允许 scroll 事件恢复锁） |

### 2.3 scrollToBottom 智能行为

```
距底 > SNAP_TO_BOTTOM_THRESHOLD(10px)  → 使用调用方传入的 behavior（smooth/instant）
距底 ≤ 10px                             → 强制 instant（避免 smooth 动画因距离太短不生效）
autoScrollLock = false                  → 不执行任何滚动
```

### 2.4 文件清单

| 文件 | 职责 |
|------|------|
| `useAutoScrollToBottom.ts` | 主 hook：管理 lock 状态、wheel/scroll 事件、返回 ref + scrollToBottom |
| `useScrollbarDrag.ts` | 辅助 hook：检测滚动条拖动方向 |
| `bindRef.ts` | 工具：合并多个 ref 到一个 callback ref |
| `index.ts` | 导出 |

## 3. 迁移方案

### 3.1 文件结构

```
packages/desktop/src/hooks/
└── auto-scroll/
    ├── index.ts
    ├── bindRef.ts
    ├── useScrollbarDrag.ts
    └── useAutoScrollToBottom.ts
```

从 omni-flow-web 原样复制 4 个文件，不做修改。

### 3.2 MessageList.tsx 改造

**删除：**
- `AutoScroll` 组件定义（130-141 行）
- JSX 中的 `<AutoScroll />` 引用（190 行）

**新增：**

```tsx
import { useAutoScrollToBottom } from '@/hooks/auto-scroll';

export function MessageList() {
  const fingerprint = useStructuralFingerprint();
  const sessionId = useChat((s) => s.sessionId);
  const renderUnits = useMemo(...);

  // deps = [sessionId]：切换会话时重置锁为 true
  const { ref, scrollToBottom } = useAutoScrollToBottom([sessionId]);

  // 流式内容增长时自动滚动 — MutationObserver 监听 DOM 变化
  useEffect(() => {
    const el = /* 从 ref 中获取当前 element */;
    if (!el) return;
    const observer = new MutationObserver(() => {
      scrollToBottom();
    });
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [scrollToBottom]);

  return (
    <div ref={ref} className="flex-1 min-w-0 overflow-y-auto ...">
      ...
      <StreamingIndicator />
      {/* AutoScroll 组件已移除 */}
    </div>
  );
}
```

## 4. 流式滚动触发 — 方案对比

scrollToBottom 需要在合适的时机被调用。对比三种方案：

### 方案 A：MutationObserver（推荐）

监听滚动容器的 DOM 变化，任何子树 mutation 触发 scrollToBottom。

| 维度 | 分析 |
|------|------|
| **触发频率** | 受上游节流控制：`AssistantMessage` 内的 `useThrottledValue` 以 150ms 节流 React 渲染，DOM 变化最快 ~6-7 次/秒。`StreamSession.emitChangeThrottled` 使用 rAF 节流 store 同步。两层节流叠加，MutationObserver 不会过度触发 |
| **覆盖面** | 完整覆盖所有导致内容增长的场景：流式文本追加、新消息 DOM 插入、工具调用卡片展开、光标元素增删、Markdown 渲染展开（代码块等） |
| **代码侵入** | 零侵入 — 不需要修改 store 层或 StreamSession |
| **性能开销** | MutationObserver 是浏览器原生 API，在 subtree 监听下仍然高效。关键点：scrollToBottom 内部仅做 scrollTop/scrollHeight 读取 + 条件 scrollTo，不会触发强制重排（因为读取发生在 mutation 回调中，此时布局已就绪） |
| **清理** | useEffect cleanup 中 disconnect 即可 |

**额外安全措施**：对 scrollToBottom 调用做 rAF 合并，避免同一帧内多个 mutation 回调重复触发：

```tsx
useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  let rafId: number | null = null;
  const observer = new MutationObserver(() => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      scrollToBottom();
    });
  });
  observer.observe(el, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
    if (rafId) cancelAnimationFrame(rafId);
  };
}, [/* container element 依赖 */]);
```

### 方案 B：zustand subscribe

在组件内订阅 `messages` 引用变化，变化时调用 scrollToBottom。

| 维度 | 分析 |
|------|------|
| 触发频率 | 与 syncFrom 调用频率一致，流式期间受 rAF 节流 |
| 覆盖面 | 只能感知 store 层变化，无法感知 DOM 层变化（如 ToolCallCard 展开/折叠） |
| 代码侵入 | 低 — 仅在 MessageList 中增加 subscribe |

不推荐：覆盖面不如 MutationObserver。

### 方案 C：轮询 scrollHeight

streaming 期间用 rAF 循环检测 scrollHeight 变化。

不推荐：持续空转浪费 CPU，且难以确定何时启停。

### 结论：采用方案 A（MutationObserver）

## 5. 边界场景分析

### 5.1 会话切换

**流程**：`switchSession` → `streamManager.switchTo(id)` → `syncToChatStore` → React 重渲染 → DOM 更新

**关键点**：
- `MessageList` 组件**不会卸载重建**（React 复用同一 DOM 节点，只是子节点内容变化）
- 滚动容器的 ref 不变，wheel/scroll 事件监听器不需要重新绑定
- MutationObserver 监听的是 subtree 变化，新的子节点渲染会触发 mutation → scrollToBottom

**锁状态重置**：
- `useAutoScrollToBottom([sessionId])` — `sessionId` 变化时 hook 内部重置 `autoScrollLock = true`
- 这确保切换到任何会话后，首先滚动到最新位置

**切换到后台流式会话**：
- `streamManager.switchTo` 会绑定 `onChanged` 回调，后台积累的流式数据通过 `syncToChatStore` 立即同步
- DOM 更新触发 MutationObserver → scrollToBottom → 自动跟踪后台流

### 5.2 新建会话

- `streamManager.newSession()` → 清空 messages → syncToChatStore
- `sessionId` 从旧值变为 null → hook deps 变化 → 重置锁
- 此时消息列表为空，scrollToBottom 无实际效果（正确）

### 5.3 从空会话发送第一条消息

- 后端通过全局 SSE 推送 user_message → `StreamSession.addUserMessage` → `emitChange` → React 渲染
- MutationObserver 检测到新 DOM 节点 → scrollToBottom
- 后续 assistant 消息同理

### 5.4 ToolCallCard 展开/折叠

- 用户点击展开工具调用详情 → DOM 变化 → MutationObserver → scrollToBottom
- **注意**：如果用户正在查看历史消息并展开了某个 ToolCallCard，此时 `autoScrollLock = false`，scrollToBottom 不会执行（正确行为 — 不应打断用户浏览）

### 5.5 窗口/面板尺寸变化

- 侧边栏展开/收起 → 滚动容器宽度变化 → 内容可能重排（Markdown 换行变化）→ scrollHeight 变化
- 如果用户本来就在底部（lock = true），MutationObserver 会触发 scrollToBottom（如有 DOM 变化），保持在底部
- 如果用户在浏览历史（lock = false），不影响

**补充**：纯 CSS 尺寸变化（无 DOM 变化时）MutationObserver 不会触发。但此时如果 lock = true，用户的视口可能略微偏离底部。可通过 ResizeObserver 补充：

```tsx
useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  const ro = new ResizeObserver(() => scrollToBottom());
  ro.observe(el);
  return () => ro.disconnect();
}, []);
```

### 5.6 `content-visibility: auto` 的影响

每个消息项的样式为：
```tsx
const MSG_ITEM_STYLE = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 120px",
};
```

**影响分析**：
- 不可见区域的消息元素高度会被 `containIntrinsicSize` 的估计值替代
- `scrollTo({ top: scrollHeight })` 中的 `scrollHeight` 基于当前已渲染 + 估计值计算，能正确到达底部
- 滚动到底部附近时，底部消息会被渲染出真实高度，`scrollHeight` 会自动修正
- **结论**：`content-visibility: auto` 不影响"滚动到底部"逻辑，但可能导致从顶部快速跳到底部时有轻微的高度抖动（浏览器行为，与本方案无关）

### 5.7 触摸板惯性滚动

Electron 桌面应用中，触摸板双指滚动会触发 wheel 事件（与鼠标滚轮行为一致），已被 hook 正确处理。

触摸板的惯性阶段也会产生 wheel 事件（deltaY 逐渐减小），这些事件也会被捕获：
- 向上惯性 → 持续触发 `deltaY < 0` → 持续更新 `lastWheelTopTime` → 锁保持解除
- 惯性结束后 200ms → scroll 事件可以恢复锁（如果位置接近底部）

**结论**：触摸板场景已被 wheel 事件 + 200ms 防抖正确覆盖。

### 5.8 用户在查看历史时发送新消息

场景：用户滚到上方查看历史消息，然后在输入框发送新消息。

当前 `autoScrollLock = false`（用户在上方），发送后：
- 后端推送 user_message → DOM 变化 → MutationObserver → scrollToBottom
- 但 lock = false → scrollToBottom 内部直接 return，**不会滚动**

**问题**：用户发送了新消息，期望看到新消息和 AI 回复，但视口停留在历史位置。

**解决方案**：在发送消息时强制重置锁。两种方式：

方案 1（推荐）：暴露 `resetLock` 方法，在 ChatInput 发送时调用
```tsx
// useAutoScrollToBottom 额外返回 resetLock
const { ref, scrollToBottom, resetLock } = useAutoScrollToBottom([sessionId]);

// ChatInput 通过 props 或 context 获取 resetLock
// 发送时调用 resetLock() → autoScrollLock = true → 后续 scrollToBottom 生效
```

方案 2：监听 isStreaming 从 false → true 的变化，自动重置锁
```tsx
const isStreaming = useIsStreaming();
const prevStreaming = useRef(false);
useEffect(() => {
  if (isStreaming && !prevStreaming.current) {
    resetLock(); // 新一轮流开始时重置
  }
  prevStreaming.current = isStreaming;
}, [isStreaming]);
```

**推荐方案 2**：不需要跨组件传递回调，且语义更准确 —— "新一轮对话开始时恢复自动滚动"。

## 6. 性能分析

### 6.1 事件监听开销

| 事件 | 频率 | 处理逻辑 | 开销 |
|------|------|----------|------|
| wheel | 用户操作时 ~60Hz | 读写两个 ref（O(1)） | 可忽略 |
| scroll | 滚动时 ~60Hz | 一次 Date.now() + 三个属性读取 + 一次比较 | 可忽略 |
| mousedown | 用户点击时 | 一次 getBoundingClientRect + 坐标比较 | 可忽略 |
| MutationObserver | DOM 变化时 | rAF 合并后每帧最多一次 scrollToBottom | 见下 |

### 6.2 scrollToBottom 开销

```
1. 读取 scrollTop / scrollHeight / clientHeight → 浏览器自动计算（不触发额外 reflow）
2. 比较 autoScrollLock → O(1) ref 读取
3. 条件 scrollTo → 浏览器原生滚动，不触发 JS 重排
```

**结论**：每次 scrollToBottom 调用开销 < 0.1ms。

### 6.3 MutationObserver 与流式输出的配合

**数据流**：

```
StreamSession.appendAssistantContent
    ↓ rAF 节流 (emitChangeThrottled)
syncToChatStore → zustand set
    ↓ React render
AssistantMessage (useThrottledValue 150ms 节流)
    ↓ DOM 更新
MutationObserver callback
    ↓ rAF 合并
scrollToBottom()
```

**实际频率**：
- `emitChangeThrottled`：~60 次/秒（rAF）
- `useThrottledValue(150ms)`：~6-7 次/秒
- **最终 DOM 更新**：~6-7 次/秒 → MutationObserver ~6-7 次/秒
- rAF 合并后 scrollToBottom：~6-7 次/秒

**结论**：流式期间 scrollToBottom 约每 150ms 调用一次，完全可接受。

### 6.4 大量消息（500+ 条）场景

- MutationObserver 监听 subtree，但只有实际发生 mutation 的节点才会触发回调，不会扫描整棵子树
- `content-visibility: auto` 使不可见消息跳过渲染，进一步降低 mutation 频率
- scrollToBottom 只做常数时间的属性读取 + scrollTo，与消息数量无关
- wheel/scroll 事件处理是常数时间操作

**结论**：消息数量不影响滚动性能。

## 7. 内存管理

### 7.1 事件监听器生命周期

| 资源 | 创建时机 | 销毁时机 | 管理方式 |
|------|----------|----------|----------|
| wheel 事件监听 | `useEffect` mount 时 | `useEffect` cleanup | 自动 |
| scroll 事件监听 | `useEffect` mount 时 | `useEffect` cleanup | 自动 |
| mousedown 事件监听 | `useScrollbarDrag` mount 时 | cleanup | 自动 |
| mouseup 事件监听（document） | `useScrollbarDrag` mount 时 | cleanup | 自动 |
| MutationObserver | `useEffect` mount 时 | `observer.disconnect()` | 自动 |
| ResizeObserver（可选） | `useEffect` mount 时 | `ro.disconnect()` | 自动 |
| rAF handle | MutationObserver 回调中 | cleanup 中 `cancelAnimationFrame` | 手动 |

### 7.2 会话切换时的资源状态

MessageList 组件在会话切换时**不卸载**（React 复用）：
- 所有 useEffect **不会重新执行**（依赖项未变）
- wheel/scroll/mousedown/mouseup 监听器**保持不变**（绑定在同一 DOM 元素上）
- MutationObserver **保持运行**（新的 DOM 变化自然被捕获）
- `autoScrollLock` 通过 deps `[sessionId]` 变化被重置

**结论**：会话切换时无额外的资源创建/销毁开销。

### 7.3 Ref 泄漏风险

- `containerRef`、`autoScrollLock`、`lastWheelTopTime`：都是 useRef，跟随组件生命周期，无泄漏
- `bindRef` 创建的 callback ref：每次渲染创建新函数但无闭包泄漏（仅引用 ref 对象）
- `useScrollbarDrag` 内部的 `isDraggingScrollbar`、`lastScrollTop`：同上

**结论**：无内存泄漏风险。

## 8. useAutoScrollToBottom hook 改造

原始 hook 需要针对我们的场景做一处小扩展：暴露 `resetLock` 方法。

```tsx
export function useAutoScrollToBottom(
  deps?: React.DependencyList,
  config = { autoScrollLockDefault: true },
) {
  // ... 原有逻辑不变 ...

  /** 强制重置锁状态（用于"新一轮对话开始"等场景） */
  const resetLock = useCallback(() => {
    autoScrollLock.current = true;
    lastWheelTopTime.current = 0;
  }, []);

  return {
    ref: bindRef(containerRef, scrollbarDragRef),
    scrollToBottom,
    resetLock,  // 新增
  };
}
```

## 9. 实施文件清单

### 新建文件

| 文件 | 来源 | 修改 |
|------|------|------|
| `src/hooks/auto-scroll/index.ts` | omni-flow-web 原样复制 | 追加导出 `bindRef` |
| `src/hooks/auto-scroll/bindRef.ts` | omni-flow-web 原样复制 | 无 |
| `src/hooks/auto-scroll/useScrollbarDrag.ts` | omni-flow-web 原样复制 | 无 |
| `src/hooks/auto-scroll/useAutoScrollToBottom.ts` | omni-flow-web 复制 | 追加 `resetLock` 返回值 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/features/chat/MessageList.tsx` | 删除 `AutoScroll` 组件；使用 `useAutoScrollToBottom` hook；添加 MutationObserver + ResizeObserver；添加 isStreaming 变化时 resetLock |

### 不需要修改的文件

| 文件 | 原因 |
|------|------|
| `stores/chat.ts` | 无侵入 |
| `services/stream-manager.ts` | 无侵入 |
| `stores/session.ts` | 无侵入 |
| `AssistantMessage.tsx` | 无侵入 |
| `ChatInput.tsx` | 无侵入（resetLock 通过 isStreaming 监听，不需要跨组件传递） |
| `ChatPanel.tsx` | 无侵入 |

## 10. 预期改造后的 MessageList 结构

```tsx
import { useEffect, useRef, memo, useMemo } from "react";
import { useAutoScrollToBottom } from "@/hooks/auto-scroll";
import { useChat, useIsStreaming, useMessageById } from "@/stores/chat";
// ... 其他 import ...

export function MessageList() {
  const fingerprint = useStructuralFingerprint();
  const sessionId = useChat((s) => s.sessionId);
  const isStreaming = useIsStreaming();
  const renderUnits = useMemo(..., [fingerprint]);

  // ① 核心 hook：deps=[sessionId] 切换会话时重置锁
  const { ref, scrollToBottom, resetLock } = useAutoScrollToBottom([sessionId]);

  // ② 新一轮流开始时重置锁（用户可能在上方浏览历史后发送消息）
  const prevStreaming = useRef(false);
  useEffect(() => {
    if (isStreaming && !prevStreaming.current) {
      resetLock();
    }
    prevStreaming.current = isStreaming;
  }, [isStreaming, resetLock]);

  // ③ MutationObserver：DOM 变化时 scrollToBottom（rAF 合并）
  const containerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let rafId: number | null = null;
    const observer = new MutationObserver(() => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        scrollToBottom();
      });
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [scrollToBottom]);

  // ④ ResizeObserver：容器尺寸变化时保持底部
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => scrollToBottom());
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  // ⑤ 合并 ref（hook 的 ref 负责事件绑定，containerRef 供 observer 使用）
  const mergedRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    ref(el);
  }, [ref]);

  return (
    <div
      ref={mergedRef}
      className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-5 py-4 space-y-2 break-words"
      style={{ willChange: "transform", contain: "layout style" }}
    >
      {renderUnits.length === 0 && (
        <div className="...">描述你想要构建的内容</div>
      )}
      {renderUnits.map((unit) => (
        <div key={...} style={MSG_ITEM_STYLE}>
          {/* ... */}
        </div>
      ))}
      <StreamingIndicator />
      {/* AutoScroll 组件已移除，由 hook + observer 接管 */}
    </div>
  );
}
```

## 11. 验证清单

- [ ] 流式输出时视口自动跟随
- [ ] 鼠标滚轮向上 → 停止自动滚动，可以自由浏览历史
- [ ] 滚轮滚回底部附近（< 100px）→ 恢复自动跟随
- [ ] 拖动滚动条向上 → 停止自动滚动
- [ ] 切换会话 → 自动滚到最新位置
- [ ] 新建空会话 → 无异常
- [ ] 从历史位置发送新消息 → 自动恢复跟随
- [ ] ToolCallCard 展开/折叠 → 在底部时保持底部，在历史位置时不跳动
- [ ] 窗口/侧边栏尺寸变化 → 在底部时保持底部
- [ ] 500+ 消息长会话 → 无卡顿
- [ ] 快速连续 n 条工具调用消息 → 无抖动
- [ ] 触摸板双指滚动 → 行为与鼠标一致
