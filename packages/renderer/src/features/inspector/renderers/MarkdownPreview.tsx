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
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { remarkPlugins, rehypePlugins, urlTransform } from "@/lib/markdown-plugins";
import { MermaidBlock } from "@/components/MermaidBlock";
import { FileLink } from "@/components/FileLink";

const markdownComponents = {
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
  return (
    <div className="h-full overflow-auto">
      <div className="markdown-body mx-auto max-w-[860px] px-6 py-4">
        <ReactMarkdown
          remarkPlugins={[...remarkPlugins]}
          rehypePlugins={[...rehypePlugins, rehypeHighlight]}
          components={markdownComponents}
          urlTransform={urlTransform}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
});
