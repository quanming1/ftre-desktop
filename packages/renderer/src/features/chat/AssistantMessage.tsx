import { memo, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/types/chat";
import { CodeBlock } from "./CodeBlock";
import { useThrottledValue } from "@/hooks/useThrottledValue";

/** Markdown 渲染组件映射（稳定引用，不会导致重渲染） */
const markdownComponents = {
  code({ className, children, ...props }: React.ComponentPropsWithoutRef<"code"> & { className?: string }) {
    const match = /language-(\w+)/.exec(className || "");
    if (match) {
      return <CodeBlock language={match[1]} code={String(children).replace(/\n$/, "")} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

/**
 * 找到容器内最深的最后一个叶子元素。
 * 光标会被 append 到这个元素内部，保证与末尾文本内联显示，
 * 即使最后的内容是代码块、表格等块级元素也不会被挤到下一行。
 */
const VOID_TAGS = new Set(["BR", "HR", "IMG", "INPUT", "COL", "EMBED", "SOURCE", "TRACK", "WBR"]);

function findDeepestLastChild(el: Element): Element {
  let node = el;
  while (node.lastElementChild && !VOID_TAGS.has(node.lastElementChild.tagName)) {
    node = node.lastElementChild;
  }
  return node;
}

const CURSOR_ATTR = "data-streaming-cursor";

export const AssistantMessage = memo(
  function AssistantMessage({ message }: { message: ChatMessage }) {
    const isStreaming = message.streaming ?? false;
    const throttledContent = useThrottledValue(message.content, 150, isStreaming);
    const displayContent = isStreaming ? throttledContent : message.content;
    const mdRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const container = mdRef.current;
      if (!container) return;

      // 移除旧光标（如果有的话）
      const old = container.querySelector(`[${CURSOR_ATTR}]`);
      if (old) old.remove();

      if (!isStreaming) return;

      // 创建光标元素
      const cursor = document.createElement("span");
      cursor.setAttribute(CURSOR_ATTR, "");
      cursor.className = "inline-block w-[6px] h-[14px] bg-neon ml-0.5 align-middle";
      cursor.style.animation = "blink 1s step-end infinite";

      // 插入到最深的最后一个叶子元素内部
      const target = findDeepestLastChild(container);
      target.appendChild(cursor);
    }, [isStreaming, displayContent]);

    return (
      <div className="flex justify-start">
        <div className="max-w-[90%]">
          <div className="text-[14px] leading-relaxed text-t-primary font-sans break-words">
            <div className="markdown-body" ref={mdRef}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {displayContent}
              </ReactMarkdown>
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
