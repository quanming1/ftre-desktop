import { useState, useMemo, memo, useCallback, createContext, useContext } from "react";
import { Copy, Check } from "lucide-react";
import hljs from "highlight.js/lib/common";

/**
 * StreamingContext — 让嵌套的 CodeBlock 知道当前 markdown 是否处于 streaming。
 * streaming 时跳过 hljs 高亮，避免每个 token 都重排 DOM。
 */
export const StreamingContext = createContext(false);

export interface CodeBlockProps {
  language: string;
  code: string;
}

/** 语言显示名映射（首字母大写 / 多词美化） */
const LANG_DISPLAY: Record<string, string> = {
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  javascript: "JavaScript",
  jsx: "JSX",
  py: "Python",
  python: "Python",
  rb: "Ruby",
  ruby: "Ruby",
  go: "Go",
  rust: "Rust",
  rs: "Rust",
  java: "Java",
  kotlin: "Kotlin",
  kt: "Kotlin",
  swift: "Swift",
  c: "C",
  cpp: "C++",
  "c++": "C++",
  cs: "C#",
  csharp: "C#",
  php: "PHP",
  sh: "Shell",
  bash: "Bash",
  zsh: "Zsh",
  fish: "Fish",
  shell: "Shell",
  powershell: "PowerShell",
  ps1: "PowerShell",
  pwsh: "PowerShell",
  cmd: "CMD",
  bat: "Batch",
  sql: "SQL",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  xml: "XML",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  sass: "Sass",
  less: "Less",
  md: "Markdown",
  markdown: "Markdown",
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  text: "Text",
  plaintext: "Text",
  vue: "Vue",
  svelte: "Svelte",
};

function displayName(lang: string): string {
  if (!lang) return "Text";
  const key = lang.toLowerCase();
  return LANG_DISPLAY[key] ?? lang.charAt(0).toUpperCase() + lang.slice(1);
}

export const CodeBlock = memo(
  function CodeBlock({ language, code }: CodeBlockProps) {
    const [copied, setCopied] = useState(false);
    const isStreaming = useContext(StreamingContext);

    // 预计算高亮 HTML：非 streaming 时一次性算好，避免 highlightElement 后替换 DOM 导致高度抖动。
    // streaming 期间返回 null，走纯文本渲染（代码持续增长，反复高亮无意义）。
    const highlightedHtml = useMemo(() => {
      if (isStreaming || !code) return null;
      try {
        const lang = language || "text";
        const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
        return result.value;
      } catch {
        return null;
      }
    }, [code, language, isStreaming]);

    const handleCopy = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // clipboard API may fail in non-secure contexts
      }
    }, [code]);

    const langSlug = (language || "text").toLowerCase();
    const langLabel = displayName(language);

    return (
      <div className="codeblock-card my-2 w-full overflow-hidden rounded-xl">
        {/* Header */}
        <div className="codeblock-header flex items-center justify-between h-12 pl-5 pr-3">
          <span
            className="text-[13px] font-semibold tracking-wide select-none"
            data-testid="code-lang"
          >
            {langLabel}
          </span>
          <div className="flex items-center gap-1">
            <IconButton
              label={copied ? "Copied" : "Copy"}
              onClick={handleCopy}
              active={copied}
              data-testid="copy-btn"
            >
              {copied ? <Check size={16} strokeWidth={2} /> : <Copy size={16} strokeWidth={1.75} />}
            </IconButton>
          </div>
        </div>

        {/* Code body */}
        {highlightedHtml ? (
          <pre className="overflow-x-auto">
            <code
              className={`language-${langSlug} text-[13px] leading-[1.7] font-mono`}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              data-testid="code-content"
            />
          </pre>
        ) : (
          <pre className="overflow-x-auto">
            <code
              className={`language-${langSlug} text-[13px] leading-[1.7] font-mono`}
              data-testid="code-content"
            >
              {code}
            </code>
          </pre>
        )}
      </div>
    );
  },
  (prev, next) => prev.code === next.code && prev.language === next.language,
);

// ─── 内部小组件 ────────────────────────────────────────────────────

interface IconButtonProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  "data-testid"?: string;
}

function IconButton({ label, onClick, active, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`
        codeblock-icon-btn
        inline-flex items-center justify-center w-9 h-9 rounded-full
        transition-colors
        ${active ? "is-active" : ""}
      `}
      data-testid={rest["data-testid"]}
    >
      {children}
    </button>
  );
}
