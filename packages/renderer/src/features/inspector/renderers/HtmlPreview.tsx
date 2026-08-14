/**
 * HtmlPreview — HTML 渲染预览
 *
 * 用 sandbox iframe 隔离渲染本地 HTML 文件：
 *   - 不带 allow-same-origin，iframe 运行在 opaque origin，
 *     脚本无法访问主窗口 DOM / cookie / localStorage
 *   - allow-scripts 让页面自身的交互脚本可用（图表、动效等）
 *   - srcDoc 直接注入文件内容，不产生额外 IPC / 磁盘读取
 *
 * 注意：相对路径引用的外部资源（css/js/图片）基于父页面 origin 解析，
 * 跨 origin 的 file:// 资源会被浏览器拦截，此处仅渲染文档自身。
 */
import { memo } from "react";

export const HtmlPreview = memo(function HtmlPreview({
  content,
  title,
}: {
  content: string;
  /** 无障碍标题，传入文件路径 */
  title: string;
}) {
  return (
    <iframe
      title={title}
      srcDoc={content}
      sandbox="allow-scripts"
      className="h-full w-full border-0 bg-white"
    />
  );
});
