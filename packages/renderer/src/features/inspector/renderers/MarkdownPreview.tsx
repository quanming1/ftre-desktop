/**
 * MarkdownPreview — Markdown 渲染预览
 *
 * 复用全局共享的 remark/rehype 插件组（@/lib/markdown-plugins）与
 * .markdown-body 样式，和聊天消息 / 技能说明保持同一渲染管线。
 * rehype-highlight 提供代码块语法高亮（hljs 主题由 hljs-theme-loader 全局管理）。
 * ```mermaid 代码块由 MermaidBlock 渲染为图表（其余代码块保持高亮源码）。
 *
 * 性能：memo 包裹，content 不变时父级状态切换（如 wordWrap）不触发重新解析；
 * components 定义在模块级——内联对象会让 ReactMarkdown 在 content 变化时
 * 把所有 code 子树视为新组件类型而整体重挂（MermaidBlock unmount → 图表重渲）。
 */
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { remarkPlugins, rehypePlugins, urlTransform } from "@/lib/markdown-plugins";
import { MermaidBlock } from "@/components/MermaidBlock";
import { FileLink } from "@/components/FileLink";
import { FtreExtensionImage } from "@/lib/ftre-extensions";

export interface MarkdownFrontmatterEntry {
  key: string;
  value: string;
}

export interface MarkdownFrontmatter {
  entries: MarkdownFrontmatterEntry[];
  body: string;
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function commonIndent(lines: string[]): number {
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  return indents.length > 0 ? Math.min(...indents) : 0;
}

/** 解析 Markdown 文件开头的 YAML frontmatter；非 frontmatter 内容原样返回。 */
export function parseMarkdownFrontmatter(content: string): MarkdownFrontmatter {
  const normalized = content.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n") && normalized !== "---") {
    return { entries: [], body: content };
  }

  const lines = normalized.split("\n");
  const closingIndex = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (closingIndex < 0) return { entries: [], body: content };

  const entries: MarkdownFrontmatterEntry[] = [];
  const frontmatter = lines.slice(1, closingIndex);
  for (let index = 0; index < frontmatter.length; index += 1) {
    const match = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(frontmatter[index]);
    if (!match || match[1].length > 0) continue;

    const key = match[2];
    const rawValue = match[3].trim();
    if (rawValue === "|" || rawValue === ">" || /^\|[-+]|^>[-+]?$/.test(rawValue)) {
      const block: string[] = [];
      let next = index + 1;
      while (next < frontmatter.length) {
        const line = frontmatter[next];
        if (line.trim() && !/^\s/.test(line)) break;
        block.push(line);
        next += 1;
      }
      const indent = commonIndent(block);
      const valueLines = block.map((line) => line.slice(Math.min(indent, line.length)));
      const folded = rawValue.startsWith(">")
        ? valueLines.join(" ").replace(/\s+/g, " ").trim()
        : valueLines.join("\n").trim();
      entries.push({ key, value: folded });
      index = next - 1;
      continue;
    }

    if (!rawValue) {
      const block: string[] = [];
      let next = index + 1;
      while (next < frontmatter.length) {
        const line = frontmatter[next];
        if (line.trim() && !/^\s/.test(line)) break;
        block.push(line);
        next += 1;
      }
      const indent = commonIndent(block);
      entries.push({
        key,
        value: block.map((line) => line.slice(Math.min(indent, line.length))).join("\n").trim(),
      });
      index = next - 1;
      continue;
    }

    entries.push({ key, value: unquoteYamlScalar(rawValue) });
  }

  return {
    entries,
    body: lines.slice(closingIndex + 1).join("\n").replace(/^\n/, ""),
  };
}

const markdownComponents = {
  img: FtreExtensionImage,
  code({ className, children, ...props }: React.ComponentPropsWithoutRef<"code"> & { className?: string }) {
    if (/(^|\s)language-mermaid/.test(className || "")) {
      return <MermaidBlock code={String(children ?? "").replace(/\n$/, "")} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  a({ href, children }: React.ComponentPropsWithoutRef<"a">) {
    if (href && /^file:\/\//i.test(href)) {
      const label = typeof children === "string" ? children : "";
      return <FileLink href={href} label={label} />;
    }
    return <a href={href}>{children}</a>;
  },
};

export const MarkdownPreview = memo(function MarkdownPreview({
  content,
}: {
  content: string;
}) {
  const frontmatter = useMemo(() => parseMarkdownFrontmatter(content), [content]);

  return (
    <div className="h-full overflow-auto">
      <div className="markdown-body mx-auto max-w-[860px] px-6 py-4">
        {frontmatter.entries.length > 0 && (
          <div className="mb-5 overflow-hidden rounded-lg border border-border-subtle bg-surface">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border-subtle bg-elevated/40 text-left text-t-muted">
                  <th className="w-[28%] px-3 py-2 font-semibold">字段</th>
                  <th className="px-3 py-2 font-semibold">值</th>
                </tr>
              </thead>
              <tbody>
                {frontmatter.entries.map((entry) => (
                  <tr key={entry.key} className="border-b border-border-subtle/70 last:border-b-0">
                    <th className="px-3 py-2 text-left align-top font-medium text-t-secondary">{entry.key}</th>
                    <td className="whitespace-pre-wrap break-words px-3 py-2 text-t-muted">{entry.value || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ReactMarkdown
          remarkPlugins={[...remarkPlugins]}
          rehypePlugins={[...rehypePlugins, rehypeHighlight]}
          components={markdownComponents}
          urlTransform={urlTransform}
        >
          {frontmatter.body}
        </ReactMarkdown>
      </div>
    </div>
  );
});
