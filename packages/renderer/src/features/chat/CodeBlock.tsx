import { useState, useEffect, useRef, memo, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import hljs from "highlight.js/lib/common";

export interface CodeBlockProps {
  language: string;
  code: string;
}

export const CodeBlock = memo(
  function CodeBlock({ language, code }: CodeBlockProps) {
    const [copied, setCopied] = useState(false);
    const codeRef = useRef<HTMLElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const highlightedRef = useRef(false);

    // IntersectionObserver 懒高亮：只在代码块进入可视区域时才调 highlight.js
    // 避免屏幕外的代码块生成大量 <span> DOM 节点
    useEffect(() => {
      highlightedRef.current = false;
      const container = containerRef.current;
      const codeEl = codeRef.current;
      if (!container || !codeEl) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && !highlightedRef.current) {
            highlightedRef.current = true;
            codeEl.removeAttribute("data-highlighted");
            codeEl.textContent = code;
            hljs.highlightElement(codeEl);
            observer.disconnect();
          }
        },
        { rootMargin: "200px" }, // 提前 200px 开始高亮，滚动到时已经就绪
      );
      observer.observe(container);
      return () => observer.disconnect();
    }, [code, language]);

    const handleCopy = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // clipboard API may fail in non-secure contexts
      }
    }, [code]);

    const displayLang = language || "text";

    return (
      <div ref={containerRef} className="rounded my-1.5 border border-border/60 group/codeblock">
        {/* Header */}
        <div className="flex items-center justify-between h-[28px] px-2.5 bg-surface/80 border-b border-border/40">
          <span className="text-[11px] text-t-ghost font-mono select-none" data-testid="code-lang">
            {displayLang}
          </span>
          <button
            onClick={handleCopy}
            className={`
              flex items-center gap-1 h-[20px] px-1.5
              rounded text-[11px] font-mono
              ${copied
                ? "text-neon/90"
                : "text-t-ghost opacity-0 group-hover/codeblock:opacity-100 hover:text-t-secondary hover:bg-white/[0.04]"
              }
            `}
            data-testid="copy-btn"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
        {/* Code body */}
        <pre className="!m-0 !rounded-none bg-base/50 px-3 py-2.5 overflow-x-auto">
          <code
            ref={codeRef}
            className={`language-${displayLang} !bg-transparent text-[12px] leading-[1.6] font-mono`}
            data-testid="code-content"
          >
            {code}
          </code>
        </pre>
      </div>
    );
  },
  (prev, next) => {
    return prev.code === next.code && prev.language === next.language;
  },
);
