import { memo, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, ToolCall } from "@/stores/chat";
import { CodeBlock } from "./CodeBlock";
import { useThrottledValue } from "@/hooks/useThrottledValue";
import { InlineToolCallCard } from "./InlineToolCallCard";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";

/** Markdown 渲染组件映射（稳定引用，不会导致重渲染） */
const markdownComponents = {
  code({
    className,
    children,
    ...props
  }: React.ComponentPropsWithoutRef<"code"> & { className?: string }) {
    const match = /language-(\w+)/.exec(className || "");
    if (match) {
      return (
        <CodeBlock
          language={match[1]}
          code={String(children).replace(/\n$/, "")}
        />
      );
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
const VOID_TAGS = new Set([
  "BR",
  "HR",
  "IMG",
  "INPUT",
  "COL",
  "EMBED",
  "SOURCE",
  "TRACK",
  "WBR",
]);

function findDeepestLastChild(el: Element): Element {
  let node = el;
  while (
    node.lastElementChild &&
    !VOID_TAGS.has(node.lastElementChild.tagName)
  ) {
    node = node.lastElementChild;
  }
  return node;
}

const CURSOR_ATTR = "data-streaming-cursor";

/** 渲染媒体 URL 列表 */
function MediaList({ urls }: { urls: Array<{ url: string; name?: string }> }) {
  if (!urls || urls.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {urls.map((media, i) => {
        const isImage =
          media.url.includes("/api/media/") ||
          media.name?.match(/\.(png|jpg|jpeg|gif|webp)$/i);
        if (isImage) {
          return (
            <a
              key={i}
              href={`http://127.0.0.1:18790${media.url}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <img
                src={`http://127.0.0.1:18790${media.url}`}
                alt={media.name || "media"}
                className="max-w-[300px] max-h-[200px] rounded-lg border border-border-subtle"
              />
            </a>
          );
        }
        return (
          <a
            key={i}
            href={`http://127.0.0.1:18790${media.url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 bg-surface rounded text-sm text-t-secondary hover:text-t-primary"
          >
            📎 {media.name || "附件"}
          </a>
        );
      })}
    </div>
  );
}

/** 渲染按钮矩阵 */
function ButtonMatrix({
  buttons,
  prompt,
  onSelect,
}: {
  buttons: string[][];
  prompt?: string;
  onSelect: (label: string) => void;
}) {
  if (!buttons || buttons.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {prompt && <div className="text-sm text-t-secondary mb-2">{prompt}</div>}
      {buttons.map((row, rowIdx) => (
        <div key={rowIdx} className="flex flex-wrap gap-2">
          {row.map((label, colIdx) => (
            <button
              key={colIdx}
              onClick={() => onSelect(label)}
            className="px-3 py-1.5 text-sm bg-surface hover:bg-hover text-t-primary rounded-lg border border-border-subtle transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Collapsible reasoning/thinking block */
function ReasoningBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="flex items-center gap-1.5 text-[12px] text-t-dim hover:text-t-secondary transition-colors"
      >
        <Brain size={13} className="text-t-ghost" />
        <span>思考过程</span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {expanded && (
        <div className="mt-1.5 pl-5 border-l-2 border-border-subtle text-[12px] text-t-dim leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto">
          {text}
        </div>
      )}
    </div>
  );
}

/** 连续多个 tool_call 的堆叠折叠 UI */
function ToolCallStack({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false);

  if (toolCalls.length === 1) {
    return <InlineToolCallCard toolCall={toolCalls[0]} />;
  }

  if (!expanded) {
    return (
      <div>
        <InlineToolCallCard toolCall={toolCalls[0]} />
        {/* 堆叠指示条 — 点击展开 */}
        <div
          onClick={() => setExpanded(true)}
          className="cursor-pointer group"
        >
          <div className="mx-2 h-[6px] -mt-[3px] border border-t-0 border-border-subtle rounded-b-2xl bg-panel/80 group-hover:bg-hover transition-colors" />
          <div className="mx-4 h-[5px] -mt-[2px] border border-t-0 border-border-subtle/60 rounded-b-2xl bg-panel/50 group-hover:bg-hover/50 transition-colors" />
          <div className="text-center text-[11px] text-t-ghost mt-0.5 group-hover:text-t-dim transition-colors">
            +{toolCalls.length - 1} 个工具调用
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-1.5">
        {toolCalls.map((tc) => (
          <InlineToolCallCard key={tc.id} toolCall={tc} />
        ))}
      </div>
      {/* 收起指示条 */}
      <div
        onClick={() => setExpanded(false)}
        className="cursor-pointer mt-1 text-center text-[11px] text-t-ghost hover:text-t-dim transition-colors"
      >
        收起
      </div>
    </div>
  );
}

/** 将 parts 分组渲染：连续 tool_call 合并为堆叠 */
function PartsRenderer({
  parts,
  toolCalls,
  mdRef,
}: {
  parts: import("@/stores/chat").MessagePart[];
  toolCalls: ToolCall[];
  mdRef: React.RefObject<HTMLDivElement | null>;
}) {
  // 将 parts 分组：连续的 tool_call 合并为一组
  const groups: Array<{ type: "text"; text: string; isLast: boolean } | { type: "tools"; calls: ToolCall[] }> = [];
  let pendingTools: ToolCall[] = [];

  const flushTools = () => {
    if (pendingTools.length > 0) {
      groups.push({ type: "tools", calls: [...pendingTools] });
      pendingTools = [];
    }
  };

  parts.forEach((part, idx) => {
    if (part.type === "text") {
      flushTools();
      groups.push({ type: "text", text: part.text, isLast: idx === parts.length - 1 });
    } else {
      const tc = toolCalls.find((t) => t.id === part.toolCallId);
      if (tc) pendingTools.push(tc);
    }
  });
  flushTools();

  return (
    <>
      {groups.map((group, idx) => {
        if (group.type === "text") {
          return (
            <div key={`g-${idx}`} className="markdown-body" ref={group.isLast ? mdRef : undefined}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {group.text}
              </ReactMarkdown>
            </div>
          );
        }
        return <ToolCallStack key={`g-${idx}`} toolCalls={group.calls} />;
      })}
    </>
  );
}

export const AssistantMessage = memo(
  function AssistantMessage({ message }: { message: ChatMessage }) {
    const isStreaming = message.streaming ?? false;
    const throttledContent = useThrottledValue(
      message.content,
      150,
      isStreaming,
    );
    const displayContent = isStreaming ? throttledContent : message.content;
    const mdRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // 按钮点击处理 - 发送选中的按钮文本作为用户消息
    const handleButtonSelect = useCallback((label: string) => {
      import("@/stores/chat").then(({ useChat }) => {
        useChat.getState().sendMessage(label);
      });
    }, []);

    useEffect(() => {
      const root = containerRef.current;
      if (!root) return;

      // 清理整个消息内的所有光标（覆盖所有 parts）
      root.querySelectorAll(`[${CURSOR_ATTR}]`).forEach((el) => el.remove());

      if (!isStreaming) return;

      // 在最后一个 markdown 块（最后一段文本）末尾插入光标
      const allMd = root.querySelectorAll<HTMLDivElement>(".markdown-body");
      const target = allMd.length > 0 ? allMd[allMd.length - 1] : mdRef.current;
      if (!target) return;

      const cursor = document.createElement("span");
      cursor.setAttribute(CURSOR_ATTR, "");
      cursor.className =
        "inline-block w-[6px] h-[14px] bg-neon ml-0.5 align-middle";
      cursor.style.animation = "blink 1s step-end infinite";

      const leaf = findDeepestLastChild(target);
      leaf.appendChild(cursor);
    }, [isStreaming, displayContent, message.parts?.length]);

    return (
      <div className="flex justify-start" ref={containerRef}>
        <div className="max-w-[90%]">
          {message.isError ? (
            <div className="px-3 py-2 rounded-lg text-[13px] text-t-dim italic leading-relaxed">
              {message.content}
            </div>
          ) : (
          <div className="text-[var(--text-lg)] leading-relaxed text-t-primary font-sans break-words">
            {/* 推理过程（折叠） */}
            {message.reasoning && <ReasoningBlock text={message.reasoning} />}

            {/* 优先按 parts 顺序渲染（保留 LLM 输出顺序） */}
            {message.parts && message.parts.length > 0 ? (
              <div className="space-y-2">
                <PartsRenderer parts={message.parts} toolCalls={message.toolCalls || []} mdRef={mdRef} />
              </div>
            ) : (
              <>
                {/* Fallback: 旧消息（没有 parts）按原顺序渲染 */}
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="mb-2 space-y-2">
                    {message.toolCalls.map((tc, idx) => (
                      <InlineToolCallCard
                        key={tc.id ?? `tc-${idx}`}
                        toolCall={tc}
                      />
                    ))}
                  </div>
                )}
                {displayContent && (
                  <div className="markdown-body" ref={mdRef}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {displayContent}
                    </ReactMarkdown>
                  </div>
                )}
              </>
            )}

            {/* 媒体内容 */}
            {message.media_urls && <MediaList urls={message.media_urls} />}
            {/* 按钮 */}
            {message.buttons && (
              <ButtonMatrix
                buttons={message.buttons}
                prompt={message.button_prompt}
                onSelect={handleButtonSelect}
              />
            )}
          </div>
          )}
        </div>
      </div>
    );
  },
  (prev, next) => {
    // Deep compare toolCalls since their internal state can change
    const toolCallsEqual = () => {
      const prevTc = prev.message.toolCalls;
      const nextTc = next.message.toolCalls;
      if (prevTc === nextTc) return true;
      if (!prevTc || !nextTc) return prevTc === nextTc;
      if (prevTc.length !== nextTc.length) return false;
      return prevTc.every(
        (tc, i) =>
          tc.id === nextTc[i].id &&
          tc.status === nextTc[i].status &&
          tc.arguments === nextTc[i].arguments &&
          tc.result === nextTc[i].result,
      );
    };

    return (
      prev.message.content === next.message.content &&
      prev.message.streaming === next.message.streaming &&
      prev.message.media_urls === next.message.media_urls &&
      prev.message.buttons === next.message.buttons &&
      toolCallsEqual() &&
      prev.message.reasoning === next.message.reasoning
    );
  },
);
