import { memo, useCallback, useEffect, useRef, useState, isValidElement, Children } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage, ContentBlock, ToolResult } from "@/stores/chat";
import { CodeBlock, StreamingContext } from "./CodeBlock";
import { useThrottledValue } from "@/hooks/useThrottledValue";
import { splitBlocks } from "./streamingMarkdown";
import { InlineToolCallCard } from "./InlineToolCallCard";
import { TurnFileChanges, type TurnFileChange } from "./TurnFileChanges";
import { ChevronRight, Copy, Check } from "lucide-react";
import { Tooltip, TooltipProvider } from "@ftre/ui";
import { useNotification } from "@/stores/notification";
import { remarkPlugins, rehypePlugins } from "@/lib/markdown-plugins";
import { useAutoScrollToBottom } from "@/hooks/auto-scroll";

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
      <ReactMarkdown remarkPlugins={[...remarkPlugins]} rehypePlugins={[...rehypePlugins]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  ),
  (a, b) => a.content === b.content,
);

/** 统一的 Thought / Thoughted 折叠块 UI */
const ThoughtBlock = memo(
  function ThoughtBlock({
    label,
    text,
    isActive = false,
    anchor,
  }: {
    label: string;
    text: string;
    isActive?: boolean;
    anchor?: React.RefObject<HTMLDivElement | null>;
  }) {
    const [expanded, setExpanded] = useState(false);
    const prevTextLen = useRef(text.length);
    const content = text.trim().replace(/\n{2,}/g, "\n");
    const previewLine = content.split("\n").find((line) => line.trim()) || content || "...";

    // 自动滚动到底部：用户向上滚时不跟随，滚回底部附近时恢复
    const { ref: autoScrollRef, scrollToBottom, resetLock } = useAutoScrollToBottom(
      undefined,
      { autoScrollLockDefault: true },
    );

    useEffect(() => {
      if (isActive && expanded && text.length > prevTextLen.current) {
        // 新内容到达：如果锁着就滚到底，否则尊重用户位置
        scrollToBottom();
      }
      prevTextLen.current = text.length;
    }, [text.length, isActive, expanded, scrollToBottom]);

    // 展开 / 激活时重置锁，跟随到底部
    useEffect(() => {
      if (expanded && isActive) resetLock();
    }, [expanded, isActive, resetLock]);

    return (
      <div>
        <button
          onClick={() => setExpanded((p) => !p)}
          className="flex items-center gap-1.5 w-full text-[13px] font-mono text-left group py-1"
        >
          <span className="shrink-0 text-t-secondary font-medium">{label}</span>
          {!expanded && <span className="flex-1 truncate text-t-dim group-hover:text-t-secondary transition-colors">{previewLine}</span>}
          <ChevronRight
            size={13}
            className={`shrink-0 text-t-ghost transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          />
        </button>
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div
              ref={autoScrollRef}
              className="pl-5 pb-1 text-[13px] font-mono text-t-dim leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto scrollbar-thin"
            >
              {content}
            </div>
          </div>
        </div>
        {!expanded && anchor && <div ref={anchor} />}
      </div>
    );
  },
  (a, b) => a.text === b.text && a.isActive === b.isActive && a.label === b.label && a.anchor === b.anchor,
);

/** 推理块：与 think 统一 UI，仅文案不同。流式时 throttle 文本避免高频重渲染打断交互。 */
const ReasoningBlock = memo(
  function ReasoningBlock({ text, isActive }: { text: string; isActive: boolean }) {
    const throttled = useThrottledValue(text, 150, isActive);
    const display = isActive ? throttled : text;
    return <ThoughtBlock label="Reasoning" text={display} isActive={isActive} />;
  },
  (a, b) => a.text === b.text && a.isActive === b.isActive,
);

/**
 * 按 blocks 顺序行内渲染：thinking → ReasoningBlock；text → TextPart（已闭合块走 memo）；
 * toolCall → InlineToolCallCard（带配对的 toolResult）。流式且为最后一段 text 时对内容做 throttle。
 */
const BlocksRenderer = memo(function BlocksRenderer({
  blocks,
  toolResults,
  streaming,
  mdRef,
}: {
  blocks: ContentBlock[];
  toolResults: Record<string, ToolResult>;
  streaming: boolean;
  mdRef: React.RefObject<HTMLDivElement | null>;
}) {
  // 找到最后一个 text block 的索引（光标 / throttle 锚点）
  let lastTextIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === "text") { lastTextIdx = i; break; }
  }

  const rendered: React.ReactNode[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (block.type === "thinking") {
      const text = block.thinking || "";
      if (!text) continue;
      rendered.push(<ReasoningBlock key={`r-${i}`} text={text} isActive={streaming} />);
      continue;
    }

    if (block.type === "toolCall") {
      rendered.push(
        <InlineToolCallCard
          key={`tc-${block.id || i}`}
          block={block}
          result={toolResults[block.id]}
          streaming={streaming}
        />
      );
      continue;
    }

    // text block
    rendered.push(
      <TextPart
        key={`tx-${i}`}
        text={block.text}
        live={streaming && i === lastTextIdx}
        anchor={i === lastTextIdx ? mdRef : undefined}
      />
    );
  }

  return <>{rendered}</>;
},
(prev, next) => {
  if (prev.streaming !== next.streaming) return false;
  if (prev.blocks === next.blocks && prev.toolResults === next.toolResults) return true;
  if (prev.blocks.length !== next.blocks.length) return false;
  for (let i = 0; i < prev.blocks.length; i++) {
    const a = prev.blocks[i], b = next.blocks[i];
    if (a.type !== b.type) return false;
    if (a.type === "text" && b.type === "text" && a.text !== b.text) return false;
    if (a.type === "thinking" && b.type === "thinking" && a.thinking !== b.thinking) return false;
    if (a.type === "toolCall" && b.type === "toolCall" && a.id !== b.id) return false;
  }
  // Compare toolResults
  const ar = prev.toolResults, br = next.toolResults;
  if (ar === br) return true;
  const aKeys = Object.keys(ar), bKeys = Object.keys(br);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const x = ar[k], y = br[k];
    if (!y || x.status !== y.status || x.result !== y.result || x.error !== y.error) return false;
  }
  return true;
});

/**
 * 把文本按 <think>...</think> 切分为普通段与思考段。
 * 兼容 <think > 带空格、以及流式中尚未闭合（只有 <think> 没有 </think>）的情况。
 */
type ThinkSeg = { type: "normal" | "think"; content: string };

function splitThink(text: string): ThinkSeg[] {
  const openRe = /<think\s*>/i;
  const closeRe = /<\/think\s*>/i;
  const segs: ThinkSeg[] = [];
  let rest = text;
  let guard = 0;
  while (rest && guard++ < 1000) {
    const om = rest.match(openRe);
    if (!om || om.index === undefined) {
      segs.push({ type: "normal", content: rest });
      break;
    }
    if (om.index > 0) segs.push({ type: "normal", content: rest.slice(0, om.index) });
    const afterOpen = rest.slice(om.index + om[0].length);
    const cm = afterOpen.match(closeRe);
    if (!cm || cm.index === undefined) {
      // 未闭合（流式中）：剩余全部当作思考内容
      segs.push({ type: "think", content: afterOpen });
      break;
    }
    segs.push({ type: "think", content: afterOpen.slice(0, cm.index) });
    rest = afterOpen.slice(cm.index + cm[0].length);
  }
  return segs;
}
/**
 * think 感知的内容渲染：普通段走 markdown 分块；think 段用 ThoughtedBlock
 * 折叠展示（默认一行，可展开）。anchor 挂到最后一个渲染元素（流式滚动锚点）。
 */
function ThinkAwareContent({
  text,
  live,
  anchor,
}: {
  text: string;
  live: boolean;
  anchor?: React.RefObject<HTMLDivElement | null>;
}) {
  const segs = splitThink(text);
  if (segs.length === 0) {
    return <div className="markdown-body" ref={anchor} />;
  }

  const nodes: React.ReactNode[] = [];
  const lastSegIdx = segs.length - 1;

  segs.forEach((seg, si) => {
    const isLastSeg = si === lastSegIdx;
    if (seg.type === "think") {
      if (!seg.content.trim()) return;
      nodes.push(
        <ThoughtBlock
          key={`think-${si}`}
          label="Thought"
          text={seg.content}
          isActive={live}
          anchor={isLastSeg ? anchor : undefined}
        />,
      );
      return;
    }
    const blocks = splitBlocks(seg.content);
    blocks.forEach((b, bi) => {
      const isTail = isLastSeg && bi === blocks.length - 1;
      nodes.push(
        <div key={`b-${si}-${bi}`} ref={isTail ? anchor : undefined}>
          <MarkdownBlock content={b.content} />
        </div>,
      );
    });
  });

  return <>{nodes}</>;
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
  return <ThinkAwareContent text={display} live={live} anchor={anchor} />;
}

export const AssistantMessage = memo(
  function AssistantMessage({
    message,
    showActions = false,
    turnUsage,
    turnAccumulatedUsage,
    turnTexts,
    turnFileChanges,
    turnDurationSec,
    turnModel,
  }: {
    message: ChatMessage;
    showActions?: boolean;
    turnUsage?: ChatMessage["usage"];
    turnAccumulatedUsage?: ChatMessage["turnUsage"];
    turnTexts?: string[];
    turnFileChanges?: TurnFileChange[];
    turnDurationSec?: number;
    turnModel?: string;
  }) {
    const isStreaming = message.streaming ?? false;
    const mdRef = useRef<HTMLDivElement>(null);

    // 复制
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(async () => {
      const text = (turnTexts && turnTexts.length > 0)
        ? turnTexts.join("\n\n")
        : (message.content ?? "");
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        useNotification.getState().addNotification({ level: "error", message: "复制失败" });
      }
    }, [turnTexts, message.content]);

    return (
      <div data-assistant-message="true" className="flex justify-start">
        <div className="w-full">
          {message.isError ? (
            <div className="px-3 py-2 rounded-lg text-[13px] text-t-dim italic leading-relaxed">
              {message.content}
            </div>
          ) : (
            <StreamingContext.Provider value={isStreaming}>
              <div className="text-[var(--text-md)] leading-relaxed text-t-primary font-sans break-words">
                {message.blocks && message.blocks.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <BlocksRenderer
                      blocks={message.blocks}
                      toolResults={message.toolResults || {}}
                      streaming={isStreaming}
                      mdRef={mdRef}
                    />
                  </div>
                ) : message.content ? (
                  <div className="flex flex-col gap-2">
                    <ThinkAwareContent text={message.content} live={isStreaming} anchor={mdRef} />
                  </div>
                ) : null}

                {turnFileChanges && turnFileChanges.length > 0 && !isStreaming && (
                  <TurnFileChanges changes={turnFileChanges} />
                )}

                {showActions && !isStreaming && !message.isError && (
                  <div className="mt-2 flex items-center gap-2">
                    <TooltipProvider>
                      <Tooltip content={copied ? "已复制" : "复制"} side="top">
                        <button
                          onClick={handleCopy}
                          className="flex items-center justify-center w-8 h-8 text-t-ghost hover:text-t-secondary rounded-full hover:bg-hover transition-colors"
                        >
                          {copied ? <Check size={15} className="text-green-500" /> : <Copy size={15} />}
                        </button>
                      </Tooltip>
                      {(turnAccumulatedUsage ?? turnUsage ?? message.usage) && (
                        <Tooltip
                          content={
                            <div className="text-[11px] leading-snug">
                              {turnAccumulatedUsage ? (
                                <table className="border-collapse">
                                  <tbody>
                                    <tr>
                                      <td className="pr-3 text-t-muted">调用次数</td>
                                      <td className="text-right font-mono text-t-secondary">{turnAccumulatedUsage.llm_calls}</td>
                                    </tr>
                                    <tr>
                                      <td className="pr-3 text-t-muted">输入</td>
                                      <td className="text-right font-mono text-t-secondary">{fmtTokens(turnAccumulatedUsage.prompt_tokens)}</td>
                                    </tr>
                                    <tr>
                                      <td className="pr-3 text-t-muted">缓存命中</td>
                                      <td className="text-right font-mono text-t-secondary">{fmtTokens(turnAccumulatedUsage.cached_tokens)}</td>
                                    </tr>
                                    <tr>
                                      <td className="pr-3 text-t-muted">输出</td>
                                      <td className="text-right font-mono text-t-secondary">{fmtTokens(turnAccumulatedUsage.completion_tokens)}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              ) : (
                                <table className="border-collapse">
                                  <tbody>
                                    <tr>
                                      <td className="pr-3 text-t-muted">输入</td>
                                      <td className="text-right font-mono text-t-secondary">{(turnUsage ?? message.usage)?.prompt_tokens ?? "-"}</td>
                                    </tr>
                                    <tr>
                                      <td className="pr-3 text-t-muted">输出</td>
                                      <td className="text-right font-mono text-t-secondary">{(turnUsage ?? message.usage)?.completion_tokens ?? "-"}</td>
                                    </tr>
                                    <tr>
                                      <td className="pr-3 text-t-muted">新增</td>
                                      <td className="text-right font-mono text-t-secondary">{(turnUsage ?? message.usage)?.total_tokens ?? "-"}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              )}
                            </div>
                          }
                          side="top"
                        >
                          <span className="ml-1 inline-flex items-center h-8 px-2 text-[11px] font-mono text-t-ghost rounded-md hover:bg-hover hover:text-t-secondary transition-colors cursor-default">
                            {(() => {
                              if (turnAccumulatedUsage) {
                                return `${fmtTokens(turnAccumulatedUsage.completion_tokens)}`;
                              }
                              const u = turnUsage ?? message.usage;
                              if (!u) return null;
                              return `${fmtTokens(u.completion_tokens ?? 0)}`;
                            })()}
                          </span>
                        </Tooltip>
                      )}
                      {typeof turnDurationSec === "number" && turnDurationSec >= 0 && (
                        <span className="ml-1 inline-flex items-center h-8 px-2 text-[11px] font-mono text-t-ghost rounded-md hover:bg-hover hover:text-t-secondary transition-colors cursor-default">
                          {formatDuration(turnDurationSec)}
                        </span>
                      )}
                      {turnModel && (
                        <span className="ml-1 inline-flex items-center h-8 px-2 text-[11px] font-mono text-t-ghost rounded-md hover:bg-hover hover:text-t-secondary transition-colors cursor-default">
                          {turnModel}
                        </span>
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
    if (prev.message.content !== next.message.content) return false;
    if (prev.message.streaming !== next.message.streaming) return false;
    if (prev.message.usage !== next.message.usage) return false;
    if (prev.showActions !== next.showActions) return false;
    if (prev.turnUsage !== next.turnUsage) return false;
    if (prev.turnTexts !== next.turnTexts) return false;
    if (prev.turnFileChanges !== next.turnFileChanges) return false;
    if (prev.turnDurationSec !== next.turnDurationSec) return false;
    if (prev.turnModel !== next.turnModel) return false;
    if (prev.turnAccumulatedUsage !== next.turnAccumulatedUsage) return false;

    // Compare blocks
    const ab = prev.message.blocks, bb = next.message.blocks;
    if (ab === bb) return true;
    if (!ab || !bb || ab.length !== bb.length) return false;
    for (let i = 0; i < ab.length; i++) {
      const x = ab[i], y = bb[i];
      if (x.type !== y.type) return false;
      if (x.type === "text" && y.type === "text" && x.text !== y.text) return false;
      if (x.type === "thinking" && y.type === "thinking" && x.thinking !== y.thinking) return false;
      if (x.type === "toolCall" && y.type === "toolCall" && x.id !== y.id) return false;
    }
    // Compare toolResults
    const ar = prev.message.toolResults, br = next.message.toolResults;
    if (ar === br) return true;
    if (!ar || !br) return false;
    const ak = Object.keys(ar), bk = Object.keys(br);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      const x = ar[k], y = br[k];
      if (!y || x.status !== y.status || x.result !== y.result) return false;
    }
    return true;
  },
);

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
