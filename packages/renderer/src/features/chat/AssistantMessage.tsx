import { memo, useCallback, useEffect, useRef, useState, isValidElement, Children } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage, ContentBlock, ToolResult } from "@/stores/chat";
import { CodeBlock, StreamingContext } from "./CodeBlock";
import { useThrottledValue } from "@/hooks/useThrottledValue";
import { splitBlocks } from "./streamingMarkdown";
import { InlineToolCallCard } from "./InlineToolCallCard";
import { TurnFileChanges, type TurnFileChange } from "./TurnFileChanges";
import { ChevronRight, Copy, Check, BookOpen, Code2 } from "lucide-react";
import { Tooltip, TooltipProvider } from "@ftre/ui";
import { useNotification } from "@/stores/notification";
import { remarkPlugins, rehypePlugins, urlTransform } from "@/lib/markdown-plugins";
import { useAutoScrollToBottom } from "@/hooks/auto-scroll";
import { MermaidBlock } from "@/components/MermaidBlock";
import { FileLink } from "@/components/FileLink";
import {
  assistantMessagePropsEqual,
  contentBlocksEqual,
  toolResultsEqual,
} from "./assistantMessageEquality";
import {
  collapsedAssistantBlocks,
  summarizeNonTextBlocks,
} from "./assistantMessageDisplay";

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
    if (/(^|\s)language-mermaid/.test(className || "")) {
      return <MermaidBlock code={String(children).replace(/\n$/, "")} />;
    }
    const m = /language-(\w+)/.exec(className || "");
    if (m) return <CodeBlock language={m[1]} code={String(children).replace(/\n$/, "")} />;
    return <code className={className} {...props}>{children}</code>;
  },
  a({ href, children, node: _node, ...props }: React.ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
    // file:// 本地文件链接 → 文件 chip UI，点击在编辑器面板打开（read/write 同款逻辑）
    if (href && /^file:\/\//i.test(href)) {
      const label = typeof children === "string" ? children : "";
      return <FileLink href={href} label={label} />;
    }
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
      <ReactMarkdown remarkPlugins={[...remarkPlugins]} rehypePlugins={[...rehypePlugins]} components={markdownComponents} urlTransform={urlTransform}>
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
          <span className="shrink-0 text-t-dim font-medium">{label}</span>
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
    const throttled = useThrottledValue(text, 10, isActive);
    const display = isActive ? throttled : text;
    return <ThoughtBlock label="Reasoning" text={display} isActive={isActive} />;
  },
  (a, b) => a.text === b.text && a.isActive === b.isActive,
);

/** 文本中是否包含 ```mermaid 代码块（决定消息是否显示源码/渲染切换） */
const MERMAID_RE = /```\s*mermaid\s*\n/i;

function textHasMermaid(text: string | null | undefined): boolean {
  return text ? MERMAID_RE.test(text) : false;
}

/**
 * 按 blocks 顺序行内渲染：text → TextPart（已闭合块走 memo）；thinking → ReasoningBlock；
 * toolCall → InlineToolCallCard（带配对的 toolResult）。流式且为最后一段 text 时对内容做 throttle。
 * collapseNonText 开启时，连续的 thinking / 非 asking toolCall 合并成折叠组渲染；
 * data（模型产物，如图片/附件）始终直接渲染，不属于"过程"。
 */
function isCollapsibleNonTextBlock(
  block: ContentBlock,
  toolResults: Record<string, ToolResult>,
): boolean {
  return block.type === "thinking"
    || (block.type === "toolCall" && toolResults[block.id]?.status !== "asking");
}

const BlocksRenderer = memo(function BlocksRenderer({
  blocks,
  toolResults,
  streaming,
  mdRef,
  collapseNonText = false,
  showSource = false,
  hideToolRowControls = false,
}: {
  blocks: ContentBlock[];
  toolResults: Record<string, ToolResult>;
  streaming: boolean;
  mdRef: React.RefObject<HTMLDivElement | null>;
  collapseNonText?: boolean;
  /** 源码视图：text 块直接显示原始 markdown，不渲染 */
  showSource?: boolean;
  /** 连续工具组展开内容时，隐藏单行工具的完成标记和展开箭头。 */
  hideToolRowControls?: boolean;
}) {
  // 找到最后一个 text block 的索引（光标 / throttle 锚点）
  let lastTextIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === "text") { lastTextIdx = i; break; }
  }

  const rendered: React.ReactNode[] = [];

  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];

    if (collapseNonText && isCollapsibleNonTextBlock(block, toolResults)) {
      const start = i;
      const processBlocks: ContentBlock[] = [];
      while (
        i < blocks.length
        && isCollapsibleNonTextBlock(blocks[i], toolResults)
      ) {
        const candidate = blocks[i];
        // 空 thinking 不占组：组内渲染会跳过它，避免出现点开无内容的空壳组
        if (candidate.type === "thinking" && !candidate.thinking.trim()) {
          i += 1;
          continue;
        }
        processBlocks.push(candidate);
        i += 1;
      }
      if (processBlocks.length > 0) {
        const groupId = `non-text-process-${start}-${processBlocks[0].type}-${
          processBlocks[0].type === "toolCall"
            ? processBlocks[0].id
            : processBlocks[0].blockId
        }`;
        // 呼吸条件：流式中该组是最后一个折叠组，且组后还没有 text（模型仍在执行过程）。
        // 一旦后面出现 text block（开始生成文本）即停止。
        const tailHasText = blocks.slice(i).some((b) => b.type === "text");
        const tailHasGroup = blocks.slice(i).some(
          (b) => isCollapsibleNonTextBlock(b, toolResults)
            && !(b.type === "thinking" && !b.thinking.trim()),
        );
        rendered.push(
          <NonTextProcessGroup
            key={groupId}
            groupId={groupId}
            blocks={processBlocks}
            toolResults={toolResults}
            streaming={streaming}
            mdRef={mdRef}
            breathing={streaming && !tailHasText && !tailHasGroup}
          />,
        );
      }
      // i 已指向下一个待处理块（空 thinking 已跳过），无需回退
      continue;
    }

    if (block.type === "thinking") {
      const text = block.thinking || "";
      if (!text) { i += 1; continue; }
      rendered.push(<ReasoningBlock key={`r-${i}`} text={text} isActive={streaming} />);
      i += 1;
      continue;
    }

    if (block.type === "toolCall") {
      rendered.push(
        <InlineToolCallCard
          key={`tc-${block.id || i}`}
          block={block}
          result={toolResults[block.id]}
          streaming={streaming}
          hideRowControls={hideToolRowControls}
        />
      );
      i += 1;
      continue;
    }

    if (block.type === "data") {
      const src = block.url || `data:${block.mediaType};base64,${block.data}`;
      rendered.push(
        block.mediaType.startsWith("image/")
          ? (
            <img
              key={`data-${block.blockId}`}
              src={src}
              alt="Generated content"
              className="my-2 max-h-96 max-w-full rounded-lg object-contain"
            />
          )
          : (
            <a
              key={`data-${block.blockId}`}
              href={src}
              download={`attachment-${block.blockId}`}
              className="text-accent underline"
            >
              Download {block.mediaType}
            </a>
          ),
      );
      i += 1;
      continue;
    }

    // text block
    rendered.push(
      showSource ? (
        <pre
          key={`tx-${i}`}
          className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-t-secondary"
        >
          {block.text}
        </pre>
      ) : (
        <TextPart
          key={`tx-${i}`}
          text={block.text}
          live={streaming && i === lastTextIdx}
          anchor={i === lastTextIdx ? mdRef : undefined}
        />
      ),
    );
    i += 1;
  }

  return <>{rendered}</>;
},
(prev, next) => {
  if (
    prev.streaming !== next.streaming
    || prev.collapseNonText !== next.collapseNonText
    || prev.showSource !== next.showSource
    || prev.hideToolRowControls !== next.hideToolRowControls
  ) return false;
  return contentBlocksEqual(prev.blocks, next.blocks)
    && toolResultsEqual(prev.toolResults, next.toolResults);
});

function NonTextProcessGroup({
  groupId,
  blocks,
  toolResults,
  streaming,
  mdRef,
  breathing,
}: {
  groupId: string;
  blocks: ContentBlock[];
  toolResults: Record<string, ToolResult>;
  streaming: boolean;
  mdRef: React.RefObject<HTMLDivElement | null>;
  /** 最后一个折叠组且其后无 text 时呼吸（由父级按位置计算） */
  breathing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // 流式中也显示摘要：工具名在 toolCall 产生时就已知，thinking 增长不影响去重后的摘要，
  // 让用户在不展开组的情况下也能跟进过程内容。"处理中"状态由外层按钮表达，这里不再重复。
  const label = summarizeNonTextBlocks(blocks, toolResults);

  return (
    <div className="py-0.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        aria-controls={groupId}
        className="group flex w-full items-center gap-1.5 py-1 text-left text-[14px] text-t-dim transition-colors hover:text-t-secondary"
      >
        <span className={breathing ? "animate-process-breath" : ""}>{label}</span>
        <ChevronRight
          size={12}
          className={`shrink-0 transition-opacity duration-200 ${expanded ? "rotate-90 opacity-100" : "opacity-0 group-hover:opacity-100"} ${breathing ? "animate-process-breath" : ""}`}
        />
      </button>
      <div
        id={groupId}
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-0 py-0 [&>div]:py-0 [&>div>button]:py-0 [&>div>div>button]:py-0">
            <BlocksRenderer
              blocks={blocks}
            toolResults={toolResults}
            streaming={streaming}
            mdRef={mdRef}
              hideToolRowControls
            />
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const throttled = useThrottledValue(text, 10, live);
  const display = live ? throttled : text;
  return <ThinkAwareContent text={display} live={live} anchor={anchor} />;
}

export const AssistantMessage = memo(
  function AssistantMessage({
    message,
    showActions = false,
    turnFileChanges,
    turnDurationSec,
    turnModel,
  }: {
    message: ChatMessage;
    showActions?: boolean;
    turnTexts?: string[];
    turnFileChanges?: TurnFileChange[];
    turnDurationSec?: number;
    turnModel?: string;
  }) {
    const isStreaming = message.streaming ?? false;
    const mdRef = useRef<HTMLDivElement>(null);
    // 消息文本含 mermaid 代码块时显示「源码/渲染」切换按钮
    const hasMermaid = textHasMermaid(message.content)
      || (message.blocks ?? []).some((b) => b.type === "text" && textHasMermaid(b.text));
    const [showSource, setShowSource] = useState(false);
    // 保持原有策略：流式时展开过程，TURN 结束后收起并只保留最后一个 text。
    const [processExpanded, setProcessExpanded] = useState(isStreaming);
    useEffect(() => {
      setProcessExpanded(isStreaming);
    }, [isStreaming]);
    const allBlocks = message.blocks ?? [];
    const collapsedBlocks = collapsedAssistantBlocks(allBlocks, message.toolResults);
    const hasProcess = allBlocks.length > collapsedBlocks.length;
    const displayBlocks = processExpanded ? allBlocks : collapsedBlocks;
    // 复制当前 AI 消息的全部 Text block，而不是只复制折叠视图里的最后一段。
    // content 是历史/旧消息的兼容聚合字段，blocks 优先避免遗漏分段文本。
    const copyText = allBlocks
      .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("");
    const hasTokenUsage = Boolean(message.token?.usage);
    const hasTurnDuration = !hasProcess && typeof turnDurationSec === "number" && turnDurationSec >= 0;
    const hasTurnModel = Boolean(turnModel);

    // 复制
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(async () => {
      const text = copyText || message.content || "";
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        useNotification.getState().addNotification({ level: "error", message: "复制失败" });
      }
    }, [copyText, message.content]);

    return (
      <div data-assistant-message="true" className="flex justify-start">
        <div className="w-full">
          <StreamingContext.Provider value={isStreaming}>
            <div className="text-[var(--text-md)] leading-relaxed text-t-primary font-sans break-words">
              {hasProcess && (
                <button
                  type="button"
                  aria-expanded={processExpanded}
                  onClick={() => setProcessExpanded((expanded) => !expanded)}
                  className="group mb-2 block w-full py-1.5 text-left text-[14px] text-t-dim transition-colors hover:text-t-secondary"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="shrink-0">
                      {isStreaming
                        ? "处理中..."
                        : `已处理${typeof turnDurationSec === "number" ? ` ${formatDuration(turnDurationSec)}` : ""}`}
                    </span>
                    <ChevronRight
                      size={12}
                      className={`shrink-0 transition-transform duration-200 ${processExpanded ? "rotate-90" : ""}`}
                    />
                  </span>
                  <span className="mt-1.5 block h-px w-full bg-border/60" />
                </button>
              )}

              {/* mermaid 消息：源码 / 渲染视图切换（流式结束才显示） */}
              {hasMermaid && !isStreaming && (
                <div className="mb-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowSource((v) => !v)}
                    title={showSource ? "预览渲染结果" : "查看源码"}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-t-ghost transition-colors hover:bg-hover hover:text-t-primary"
                  >
                    {showSource ? <BookOpen size={12} /> : <Code2 size={12} />}
                    {showSource ? "渲染" : "源码"}
                  </button>
                </div>
              )}

              {displayBlocks.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <BlocksRenderer
                    blocks={displayBlocks}
                    toolResults={message.toolResults || {}}
                    streaming={isStreaming}
                    mdRef={mdRef}
                    collapseNonText={processExpanded}
                    showSource={showSource}
                  />
                </div>
              ) : allBlocks.length === 0 && message.content ? (
                <div className="flex flex-col gap-2">
                  {showSource ? (
                    <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-t-secondary">
                      {message.content}
                    </pre>
                  ) : (
                    <ThinkAwareContent text={message.content} live={isStreaming} anchor={mdRef} />
                  )}
                </div>
              ) : null}

              {message.error && (
                <div role="status" className="mt-3 px-3 py-2 rounded-lg text-[13px] text-t-dim italic leading-relaxed">
                  {message.error.code && <span className="font-mono text-[11px]">[{message.error.code}] </span>}
                  {message.error.message}
                </div>
              )}

              {turnFileChanges && turnFileChanges.length > 0 && !isStreaming && (
                <TurnFileChanges changes={turnFileChanges} />
              )}

                {showActions && !isStreaming && !message.isError && (
                  <div className="mt-2.5 flex min-h-7 flex-wrap items-center gap-2.5 text-[12px] leading-none text-t-ghost">
                    <TooltipProvider>
                      <Tooltip content={copied ? "已复制" : "复制"} side="top">
                        <button
                          type="button"
                          aria-label={copied ? "已复制" : "复制"}
                          onClick={handleCopy}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-t-ghost transition-colors hover:bg-hover hover:text-t-primary"
                        >
                          {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                        </button>
                      </Tooltip>

                      {(hasTokenUsage || hasTurnDuration || hasTurnModel) && (
                        <div className="inline-flex min-w-0 max-w-full items-center gap-2.5 text-t-muted">
                          {hasTokenUsage && message.token?.usage && (
                            <Tooltip
                              content={
                                <div className="text-[11px] leading-snug">
                                  <table className="border-collapse">
                                    <tbody>
                                      <tr>
                                        <td className="pr-3 text-t-muted">输入</td>
                                        <td className="text-right font-mono text-t-secondary">{message.token.usage.prompt_tokens}</td>
                                      </tr>
                                      <tr>
                                        <td className="pr-3 text-t-muted">输出</td>
                                        <td className="text-right font-mono text-t-secondary">{message.token.usage.completion_tokens}</td>
                                      </tr>
                                      <tr>
                                        <td className="pr-3 text-t-muted">合计</td>
                                        <td className="text-right font-mono text-t-secondary">{message.token.usage.total_tokens}</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              }
                              side="top"
                            >
                              <span className="cursor-default font-mono tabular-nums text-t-muted transition-colors hover:text-t-primary">
                                {fmtTokens(message.token.usage.total_tokens)}
                              </span>
                            </Tooltip>
                          )}
                          {hasTokenUsage && (hasTurnDuration || hasTurnModel) && (
                            <span aria-hidden="true" className="text-t-ghost/50">·</span>
                          )}
                          {hasTurnDuration && (
                            <span className="font-mono tabular-nums text-t-muted">{formatDuration(turnDurationSec)}</span>
                          )}
                          {hasTurnDuration && hasTurnModel && (
                            <span aria-hidden="true" className="text-t-ghost/50">·</span>
                          )}
                          {hasTurnModel && (
                            <span className="min-w-0 max-w-[240px] truncate font-mono text-t-ghost">
                              {turnModel}
                            </span>
                          )}
                        </div>
                      )}
                    </TooltipProvider>
                  </div>
                )}
            </div>
          </StreamingContext.Provider>
        </div>
      </div>
    );
  },
  assistantMessagePropsEqual,
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
