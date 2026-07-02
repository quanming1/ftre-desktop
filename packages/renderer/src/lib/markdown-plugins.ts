/**
 * 共用的 React Markdown 插件：GFM + Math (KaTeX)。
 *
 * 三处使用：
 *   - AssistantMessage（聊天消息正文）
 *   - ChatMessageList  （侧边栏摘要预览）
 *   - SkillsPanel       （技能说明）
 *
 * 复用同一组 remark/rehype 插件，避免重复配置漂移。
 */
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export const remarkPlugins = [remarkGfm, remarkMath] as const;
export const rehypePlugins = [rehypeKatex] as const;