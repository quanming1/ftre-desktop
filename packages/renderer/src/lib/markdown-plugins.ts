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

/**
 * URL 白名单：在 react-markdown 默认 safeProtocol 基础上放行 file://。
 * 本地文件链接是 system_prompt 与 AI 的约定（[名](file:///E:/abs/path)），
 * FileLink 点击只走 IPC 读文件打开编辑器 tab，不做导航，无远程内容注入面。
 */
const SAFE_PROTOCOL_RE = /^(https?|ircs?|mailto|xmpp|file|ftre)$/i;

export function urlTransform(url: string): string {
  // 与 react-markdown defaultUrlTransform 同构：协议在首个冒号且不在白名单 → 清空
  const colon = url.indexOf(":");
  const questionMark = url.indexOf("?");
  const numberSign = url.indexOf("#");
  const slash = url.indexOf("/");
  if (
    colon < 0 ||
    (slash > -1 && colon > slash) ||
    (questionMark > -1 && colon > questionMark) ||
    (numberSign > -1 && colon > numberSign) ||
    SAFE_PROTOCOL_RE.test(url.slice(0, colon))
  ) {
    return url;
  }
  return "";
}
