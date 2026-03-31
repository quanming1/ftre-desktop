# 流式 Markdown 实时渲染设计文档

## 问题

当前 `AssistantMessage.tsx` 在流式阶段（`message.streaming === true`）完全跳过 markdown 解析，只渲染纯文本 + 光标动画。等 `finalizeAssistantMessage()` 将 `streaming` 设为 `false` 后，才切换到 `ReactMarkdown` 做完整渲染。

用户看到的效果：流式过程中全是无格式纯文本，结束瞬间突然跳变为格式化内容。

## 现有架构

### 数据流

```
startAssistantMessage()        → 创建 { streaming: true, content: '' }
appendAssistantContent(id, c)  → content += c（高频，~50-100ms/次）
finalizeAssistantMessage(id)   → streaming = false
```

### 渲染分支（AssistantMessage.tsx）

```
message.streaming === true  → StreamingContent  → 纯文本 + 光标
message.streaming === false → FinalizedContent  → ReactMarkdown + remarkGfm
```

### 已有性能优化

| 优化 | 位置 |
|------|------|
| 结构指纹（避免流式期间重新分组） | `MessageList.tsx:useStructuralFingerprint` |
| O(1) 消息索引缓存 | `chat.ts:getIndex` |
| `content-visibility: auto` | `MessageList.tsx:MSG_ITEM_STYLE` |
| CodeBlock 懒高亮（IntersectionObserver） | `CodeBlock.tsx` |
| memo + 自定义比较 | `AssistantMessage.tsx` |

## 方案

### 方案：节流 ReactMarkdown

流式阶段也用 `ReactMarkdown` 渲染，但对 content 做节流（throttle），降低 parse 频率。

**核心思路**：
- 新增 `useThrottledValue(value, delay)` hook，流式期间每 `150ms` 更新一次传给 ReactMarkdown 的 content
- 流式结束时（`streaming` 变为 `false`），立即使用最终 content，无延迟
- 保留光标动画，追加在 markdown 渲染结果后面

**修改范围**：仅 `AssistantMessage.tsx`，不影响 store 和 MessageList。

```tsx
// 新增 hook
function useThrottledValue<T>(value: T, delay: number, enabled: boolean): T {
  const [throttled, setThrottled] = useState(value);
  const lastUpdate = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!enabled) {
      setThrottled(value);
      return;
    }
    const now = Date.now();
    const elapsed = now - lastUpdate.current;
    if (elapsed >= delay) {
      lastUpdate.current = now;
      setThrottled(value);
    } else {
      clearTimeout(pending.current);
      pending.current = setTimeout(() => {
        lastUpdate.current = Date.now();
        setThrottled(value);
      }, delay - elapsed);
    }
    return () => clearTimeout(pending.current);
  }, [value, delay, enabled]);

  return throttled;
}
```

```tsx
// AssistantMessage 改造后
export const AssistantMessage = memo(
  function AssistantMessage({ message }: { message: ChatMessage }) {
    const isStreaming = message.streaming ?? false;
    const throttledContent = useThrottledValue(message.content, 150, isStreaming);
    const displayContent = isStreaming ? throttledContent : message.content;

    return (
      <div className="flex justify-start">
        <div className="max-w-[90%]">
          <div className="text-[12px] mb-1.5 text-neon/60 font-mono">ftre</div>
          <div className="text-[14px] leading-relaxed text-t-primary font-sans break-words">
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {displayContent}
              </ReactMarkdown>
              {isStreaming && (
                <span className="inline-block w-[6px] h-[14px] bg-neon ml-0.5"
                      style={{ animation: "blink 1s step-end infinite" }} />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.message.content === next.message.content &&
    prev.message.streaming === next.message.streaming,
);
```

**删除**：`StreamingContent` 和 `FinalizedContent` 两个子组件不再需要。

### 性能分析

| 因素 | 影响 | 缓解 |
|------|------|------|
| ReactMarkdown parse 频率 | 从 0 变为 ~6-7次/秒 | 150ms 节流，远低于 chunk 频率 |
| CodeBlock 高亮 | 流式期间代码块可能频繁变化 | CodeBlock 已有 IntersectionObserver 懒高亮 + memo |
| DOM diff 开销 | ReactMarkdown 输出的 vDOM 需要 React diff | 节流后每次 diff 间隔足够，React 18 自动 batch |
| 长文本场景（>10KB） | parse 耗时可能超 10ms | 可将节流阈值动态调大，或后续引入 `useDeferredValue` |

### 备选：useDeferredValue（React 18 并发模式）

如果节流方案在长文本场景仍有卡顿，可改用 `useDeferredValue`：

```tsx
const deferredContent = useDeferredValue(message.content);
```

优点是由 React 调度器自动决定优先级，不会阻塞用户交互。缺点是无法精确控制更新频率。可作为后续优化方向。

## 风险

1. **代码块闪烁**：流式期间代码块 markdown 可能不完整（如 ` ``` ` 只出现了一半），ReactMarkdown 会把它当普通文本。结束后补齐时会突变为代码块。这是所有流式 markdown 渲染的固有问题，不影响最终结果。
2. **光标位置**：光标放在 markdown 渲染结果后面，如果最后一段是代码块，光标可能出现在代码块外。视觉上可接受。
