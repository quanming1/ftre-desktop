import { memo, useCallback, useEffect, useRef, useState, isValidElement, Children } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, MessagePart, ToolCall } from "@/stores/chat";
import { CodeBlock, StreamingContext } from "./CodeBlock";
import { useThrottledValue } from "@/hooks/useThrottledValue";
import { splitBlocks } from "./streamingMarkdown";
import { InlineToolCallCard } from "./InlineToolCallCard";
import { ChevronDown, ChevronRight, Brain, Copy, Check } from "lucide-react";
import { Tooltip, TooltipProvider } from "@ftre/ui";
import { useNotification } from "@/stores/notification";

const CURSOR_ATTR = "data-streaming-cursor";
const VOID_TAGS = new Set(["BR", "HR", "IMG", "INPUT", "COL", "EMBED", "SOURCE", "TRACK", "WBR"]);

const markdownComponents = {
  // 围栏代码块（带 language-）的外层 <pre> 透传：把样式控制权交给 <CodeBlock />，
  // 避免 .markdown-body pre 的背景/边框/圆角再包一层。
  // 无语言标识的 fenced 代码仍走默认 <pre>，保留块级语义。
  pre: (props: React.ComponentPropsWithoutRef<"pre">) => {
    const onlyChild = Children.toArray(props.children).find(isValidElement) as
      | React.ReactElement<{ className?: string }>
      | undefined;
    const cls = onlyChild?.props?.className || "";
    if (/(^|\s)language-/.test(cls)) return <>{props.children}</>;
    return <pre {...props} />;
  },
  code({ className, children, ...props }: React.ComponentPropsWithoutRef<"code"> & { className?: string }) {
    const m = /language-(\w+)/.exec(className || "");
    if (m) return <CodeBlock language={m[1]} code={String(children).replace(/\n$/, "")} />;
    return <code className={className} {...props}>{children}</code>;
  },
};

/** 单个 markdown 块：content 字符串相等即跳过 reconcile */
const MarkdownBlock = memo(
  ({ content }: { content: string }) => (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  ),
  (a, b) => a.content === b.content,
);

/** Collapsible reasoning */
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

/**
 * 按 parts 顺序行内渲染：每个 tool_call 独立渲染；text 段切块（已闭合块走 memo）；
 * reasoning 段用折叠 ReasoningBlock。流式且为最后一段 text 时对内容做 throttle。
 */
function PartsRenderer({
  parts,
  toolCalls,
  streaming,
  mdRef,
}: {
  parts: MessagePart[];
  toolCalls: ToolCall[];
  streaming: boolean;
  mdRef: React.RefObject<HTMLDivElement | null>;
}) {
  // 找到最后一个 text part 的索引（光标 / throttle 锚点）
  let lastTextIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].type === "text") { lastTextIdx = i; break; }
  }

  return (
    <>
      {parts.map((p, i) => {
        if (p.type === "tool_call") {
          const tc = toolCalls.find((t) => t.id === p.toolCallId);
          if (!tc) return null;
          return <InlineToolCallCard key={`tc-${tc.id}`} toolCall={tc} />;
        }
        if (p.type === "reasoning") {
          return <ReasoningBlock key={`r-${i}`} text={p.text} />;
        }
        return (
          <TextPart
            key={`tx-${i}`}
            text={p.text}
            live={streaming && i === lastTextIdx}
            anchor={i === lastTextIdx ? mdRef : undefined}
          />
        );
      })}
    </>
  );
}

/**
 * 单个 text part：split 成块 → 已闭合块走 MarkdownBlock memo；
 * 流式中只对当前组件内最后一块的 content throttle（替换最后一块再切）。
 */
function TextPart({
  text,
  live,
  anchor,
}: {
  text: string;
  live: boolean;
  anchor?: React.RefObject<HTMLDivElement | null>;
}) {
  const throttled = useThrottledValue(text, 120, live);
  const display = live ? throttled : text;
  const blocks = splitBlocks(display);

  if (blocks.length === 0) {
    return <div className="markdown-body" ref={anchor} />;
  }
  return (
    <>
      {blocks.map((b, i) => {
        const isTail = i === blocks.length - 1;
        return (
          <div key={i} ref={isTail && anchor ? anchor : undefined}>
            <MarkdownBlock content={b.content} />
          </div>
        );
      })}
    </>
  );
}

function findDeepestLastChild(el: Element): Element {
  let node = el;
  while (node.lastElementChild && !VOID_TAGS.has(node.lastElementChild.tagName)) {
    node = node.lastElementChild;
  }
  return node;
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
    const throttledContent = useThrottledValue(message.content, 150, isStreaming);
    const displayContent = isStreaming ? throttledContent : message.content;
    const mdRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // 复制
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(async () => {
      const text = (message.parts && message.parts.length > 0)
        ? message.parts.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("\n")
        : (message.content ?? "");
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        useNotification.getState().addNotification({ level: "error", message: "复制失败" });
      }
    }, [message.parts, message.content]);

    // 流式光标：在最后一个 .markdown-body 的最深叶子内 append；effect 在每次渲染后跑，
    // React 已把 DOM 提交完成，无需额外 RAF 调度。
    useEffect(() => {
      const root = containerRef.current;
      if (!root) return;
      root.querySelectorAll(`[${CURSOR_ATTR}]`).forEach((el) => el.remove());
      if (!isStreaming) return;
      const all = root.querySelectorAll<HTMLDivElement>(".markdown-body");
      const target = all.length > 0 ? all[all.length - 1] : mdRef.current;
      if (!target) return;
      const cursor = document.createElement("span");
      cursor.setAttribute(CURSOR_ATTR, "");
      cursor.className = "inline-block w-[6px] h-[14px] bg-neon ml-0.5 align-middle";
      cursor.style.animation = "blink 1s step-end infinite";
      findDeepestLastChild(target).appendChild(cursor);
    }, [isStreaming, displayContent, message.parts?.length]);

    return (
      <div className="flex justify-start" ref={containerRef}>
        <div className="w-full max-w-[90%]">
          {message.isError ? (
            <div className="px-3 py-2 rounded-lg text-[13px] text-t-dim italic leading-relaxed">
              {message.content}
            </div>
          ) : (
            <StreamingContext.Provider value={isStreaming}>
              <div className="text-[var(--text-lg)] leading-relaxed text-t-primary font-sans break-words">
                {message.parts && message.parts.length > 0 ? (
                  <div className="space-y-2">
                    <PartsRenderer
                      parts={message.parts}
                      toolCalls={message.toolCalls || []}
                      streaming={isStreaming}
                      mdRef={mdRef}
                    />
                  </div>
                ) : (
                  <>
                    {/* fallback：parts 为空但有 reasoning（如老历史只有 m.reasoning 字段） */}
                    {message.reasoning && <ReasoningBlock text={message.reasoning} />}
                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <div className="mb-2 space-y-2">
                        {message.toolCalls.map((tc, i) => (
                          <InlineToolCallCard key={tc.id ?? `tc-${i}`} toolCall={tc} />
                        ))}
                      </div>
                    )}
                    {displayContent && (
                      <div className="markdown-body" ref={mdRef}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {displayContent}
                        </ReactMarkdown>
                      </div>
                    )}
                  </>
                )}

                {showActions && !isStreaming && !message.isError && (
                  <div className="mt-2 flex items-center gap-1">
                    <TooltipProvider>
                      <Tooltip content={copied ? "已复制" : "复制"} side="top">
                        <button
                          onClick={handleCopy}
                          className="flex items-center justify-center w-8 h-8 text-t-ghost hover:text-t-secondary rounded-md hover:bg-hover transition-colors"
                        >
                          {copied ? <Check size={15} className="text-green-500" /> : <Copy size={15} />}
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
            </StreamingContext.Provider>
          )}
        </div>
      </div>
    );
  },
  (prev, next) => {
    if (prev.message.parts !== next.message.parts) return false;
    if (prev.message.content !== next.message.content) return false;
    if (prev.message.streaming !== next.message.streaming) return false;
    if (prev.message.reasoning !== next.message.reasoning) return false;
    if (prev.message.usage !== next.message.usage) return false;
    if (prev.showActions !== next.showActions) return false;
    if (prev.turnUsage !== next.turnUsage) return false;

    const a = prev.message.toolCalls, b = next.message.toolCalls;
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (x.id !== y.id || x.status !== y.status || x.arguments !== y.arguments || x.result !== y.result) return false;
    }
    return true;
  },
);
