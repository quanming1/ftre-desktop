import { memo, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, ToolCall } from "@/stores/chat";
import { CodeBlock } from "./CodeBlock";
import { useThrottledValue } from "@/hooks/useThrottledValue";
import { InlineToolCallCard } from "./InlineToolCallCard";
import { ChevronDown, ChevronRight, Brain, Copy, Check } from "lucide-react";
import { Tooltip, TooltipProvider } from "@ftre/ui";
import { useNotification } from "@/stores/notification";

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
  function AssistantMessage({
    message,
    showActions = false,
    turnUsage,
  }: {
    message: ChatMessage;
    showActions?: boolean;
    turnUsage?: ChatMessage["usage"];
  }) {
    const isStreaming = message.streaming ?? false;
    const throttledContent = useThrottledValue(
      message.content,
      150,
      isStreaming,
    );
    const displayContent = isStreaming ? throttledContent : message.content;
    const mdRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // 复制本条消息文本（含 parts 文本片段，去掉工具调用）
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(async () => {
      let text = "";
      if (message.parts && message.parts.length > 0) {
        text = message.parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join("\n");
      } else {
        text = message.content ?? "";
      }
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        useNotification.getState().addNotification({
          level: "error",
          message: "复制失败",
        });
      }
    }, [message.parts, message.content]);

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

            {/* 本轮最后一条 assistant：操作按钮组 */}
            {showActions && !isStreaming && !message.isError && (
              <div className="mt-2 flex items-center gap-1">
                <TooltipProvider>
                  <Tooltip content={copied ? "已复制" : "复制"} side="top">
                    <button
                      onClick={handleCopy}
                      className="flex items-center justify-center w-8 h-8 text-t-ghost hover:text-t-secondary rounded-md hover:bg-hover transition-colors"
                    >
                      {copied ? (
                        <Check size={15} className="text-green-500" />
                      ) : (
                        <Copy size={15} />
                      )}
                    </button>
                  </Tooltip>

                  {(turnUsage ?? message.usage) && (
                    <Tooltip
                      content={
                        <div className="text-[11px] leading-snug">
                          <div>本轮输入: {(turnUsage ?? message.usage)?.prompt_tokens ?? "-"}</div>
                          <div>本轮输出: {(turnUsage ?? message.usage)?.completion_tokens ?? "-"}</div>
                          <div>本轮新增: {(turnUsage ?? message.usage)?.total_tokens ?? "-"}</div>
                        </div>
                      }
                      side="top"
                    >
                      <span className="ml-1 inline-flex items-center h-8 px-2 text-[11px] font-mono text-t-ghost rounded-md hover:bg-hover hover:text-t-secondary transition-colors cursor-default">
                        {(() => {
                          const u = turnUsage ?? message.usage;
                          if (!u) return null;
                          if (u.total_tokens != null) return `${u.total_tokens} tok`;
                          return `${u.prompt_tokens ?? 0}+${u.completion_tokens ?? 0} tok`;
                        })()}
                      </span>
                    </Tooltip>
                  )}
                </TooltipProvider>
              </div>
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
      toolCallsEqual() &&
      prev.message.reasoning === next.message.reasoning &&
      prev.showActions === next.showActions &&
      prev.message.usage === next.message.usage &&
      prev.turnUsage === next.turnUsage
    );
  },
);
