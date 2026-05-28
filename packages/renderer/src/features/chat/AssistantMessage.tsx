import { memo, useCallback, useEffect, useRef, useState, isValidElement, Children } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, MessagePart, ToolCall } from "@/stores/chat";
import { CodeBlock, StreamingContext } from "./CodeBlock";
import { useThrottledValue } from "@/hooks/useThrottledValue";
import { splitBlocks } from "./streamingMarkdown";
import { InlineToolCallCard } from "./InlineToolCallCard";
import { ChevronRight, Brain, Copy, Check } from "lucide-react";
import { Tooltip, TooltipProvider } from "@ftre/ui";
import { useNotification } from "@/stores/notification";
import { ThinkingIndicator } from "./ThinkingIndicator";

const markdownComponents = {
  // 围栏代码块（带 language-）的外层 <pre> 透传：把样式控制权交给 <CodeBlock />，
  // 避免 .markdown-body pre 的背景/边框/圆角再包一层。
  // 无语言标识的 fenced 代码仍走默认 <pre>，保留块级语义。
  pre: (props: React.ComponentPropsWithoutRef<"pre">) => {
    const onlyChild = Children.toArray(props.children).find(isValidElement) as
      | React.ReactElement<{ className?: string; children?: React.ReactNode }>
      | undefined;
    const cls = onlyChild?.props?.className || "";
    // 有语言标识的 fenced 代码块 → 交给 code 组件渲染 CodeBlock
    if (/(^|\s)language-/.test(cls)) return <>{props.children}</>;
    // 无语言标识的 fenced 代码块 → 直接在此渲染 CodeBlock
    if (onlyChild && Children.count(props.children) === 1) {
      const code = String(onlyChild.props.children ?? "").replace(/\n$/, "");
      return <CodeBlock language="" code={code} />;
    }
    return <pre {...props} />;
  },
  code({ className, children, ...props }: React.ComponentPropsWithoutRef<"code"> & { className?: string }) {
    const m = /language-(\w+)/.exec(className || "");
    if (m) return <CodeBlock language={m[1]} code={String(children).replace(/\n$/, "")} />;
    return <code className={className} {...props}>{children}</code>;
  },
  a({ href, children, ...props }: React.ComponentPropsWithoutRef<"a">) {
    const handleClick = (e: React.MouseEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        if (href) {
          const api = (window as any).desktop;
          if (api?.openExternal) {
            api.openExternal(href);
          } else {
            window.open(href, "_blank");
          }
        }
      }
      // 普通点击不做任何事，只有 Ctrl/Cmd + 点击才打开
    };
    return (
      <a
        href={href}
        onClick={handleClick}
        title="Ctrl + 点击在浏览器打开"
        {...props}
      >
        {children}
      </a>
    );
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
function ReasoningBlock({ text, isActive }: { text: string; isActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [userToggled, setUserToggled] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevActive = useRef(isActive);
  const prevTextLen = useRef(text.length);

  // 推理开始 → 自动展开（除非用户手动收起过）
  useEffect(() => {
    if (isActive && !userToggled) {
      setExpanded(true);
    }
  }, [isActive, userToggled]);

  // 推理结束 → 自动折叠，重置手动标记
  useEffect(() => {
    if (prevActive.current && !isActive) {
      setExpanded(false);
      setUserToggled(false);
    }
    prevActive.current = isActive;
  }, [isActive]);

  // 内容增长 → 自动滚到底部
  useEffect(() => {
    if (isActive && expanded && contentRef.current && text.length > prevTextLen.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
    prevTextLen.current = text.length;
  }, [text.length, isActive, expanded]);

  // 展开时（包括手动重新展开）→ 滚到底部，避免漏掉折叠期间新增的内容
  useEffect(() => {
    if (expanded && isActive && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [expanded, isActive]);

  const handleToggle = useCallback(() => {
    setExpanded((p) => !p);
    setUserToggled(true);
  }, []);

  return (
    <div className="mb-2">
      <button
        onClick={handleToggle}
        className="flex items-center gap-1.5 text-[12px] text-t-dim hover:text-t-secondary transition-colors"
      >
        <Brain size={13} className="text-t-ghost" />
        <span>思考过程</span>
        <ChevronRight
          size={12}
          className={`transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
        />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div
            ref={contentRef}
            className="mt-1.5 pl-5 border-l-2 border-border-subtle text-[12px] text-t-dim leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto"
          >
            {text}
          </div>
        </div>
      </div>
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
          // reasoning part 自带 streaming 标记：reasoning_complete 事件会将其置为 false
          const isReasoningLive = streaming && p.streaming !== false;
          return <ReasoningBlock key={`r-${i}`} text={p.text} isActive={isReasoningLive} />;
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

    // 流式状态下的"思考中"指示器：取代旧的末尾闪烁光标。
    // 规则：streaming === true 且当前没有 tool 在执行（pending / running）时展示。
    const hasRunningTool = !!message.toolCalls?.some(
      (tc) => tc.status === "pending" || tc.status === "running",
    );
    const showThinking = isStreaming && !hasRunningTool;

    return (
      <div className="flex justify-start">
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
                    {message.reasoning && (
                      <ReasoningBlock
                        text={message.reasoning}
                        isActive={isStreaming && !(message.content?.length) && !(message.toolCalls?.length)}
                      />
                    )}
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

                {showThinking && <ThinkingIndicator className="mt-4" />}

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
