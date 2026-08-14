/**
 * MarkdownPreview — Markdown 渲染预览
 *
 * 复用全局共享的 remark/rehype 插件组（@/lib/markdown-plugins）与
 * .markdown-body 样式，和聊天消息 / 技能说明保持同一渲染管线。
 * rehype-highlight 提供代码块语法高亮（hljs 主题由 hljs-theme-loader 全局管理）。
 *
 * 性能：memo 包裹，content 不变时父级状态切换（如 wordWrap）不触发重新解析。
 */
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { remarkPlugins, rehypePlugins } from "@/lib/markdown-plugins";

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
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
});
