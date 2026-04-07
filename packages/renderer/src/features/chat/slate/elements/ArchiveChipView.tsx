/**
 * ArchiveChip 渲染组件
 *
 * 在 Slate 编辑器中以 inline chip 形式展示归档引用。
 * 显示: 📦 摘要预览 (标签)
 * hover 时显示详细信息 tooltip。
 */
import { useState } from "react";
import { useFocused, useSelected } from "slate-react";
import type { RenderElementProps } from "slate-react";
import type { ArchiveChipElement } from "../types";
import { Archive, MessageSquare, FileText, Tag } from "lucide-react";

interface Props extends RenderElementProps {
  element: ArchiveChipElement;
}

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function ArchiveChipView({ element, attributes, children }: Props) {
  const selected = useSelected();
  const focused = useFocused();
  const [hover, setHover] = useState(false);
  const { archiveRef } = element;

  // 防御性检查：确保 archiveRef 数据完整
  const summary = archiveRef?.summary || "";
  const turnCount = archiveRef?.turnCount ?? 0;
  const totalMessages = archiveRef?.totalMessages ?? 0;
  const createdAt = archiveRef?.createdAt ?? Date.now() / 1000;
  const label = archiveRef?.label;

  // 截断摘要显示
  const shortSummary =
    summary.length > 30 ? summary.slice(0, 30) + "..." : summary;

  return (
    <span
      {...attributes}
      contentEditable={false}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`relative inline-flex items-center gap-1.5 px-2 py-1 mx-0.5 rounded-lg text-[11px] font-sans cursor-default align-baseline transition-colors max-w-full ${
        selected && focused
          ? "bg-violet-500/20 text-violet-300 border border-violet-400/40"
          : "bg-violet-500/10 text-violet-300/80 border border-violet-500/20 hover:bg-violet-500/15 hover:text-violet-300"
      }`}
    >
      <Archive size={12} className="shrink-0 opacity-70" />
      <span className="truncate max-w-[200px]">{shortSummary || "(无摘要)"}</span>
      {label && (
        <span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-violet-500/20 text-[9px] text-violet-300/80">
          <Tag size={8} />
          {label}
        </span>
      )}
      {children}

      {hover && (
        <span className="absolute bottom-full left-0 mb-1.5 z-50 pointer-events-none">
          <span className="block bg-elevated border border-border-subtle rounded-lg shadow-xl px-3 py-2.5 min-w-[280px] max-w-[360px]">
            {/* Header */}
            <span className="flex items-center gap-2 text-[10px] text-t-ghost mb-2">
              <Archive size={12} className="text-violet-400" />
              <span>归档引用</span>
              <span className="text-t-ghost/60">·</span>
              <span>{timeAgo(createdAt)}</span>
            </span>

            {/* Summary */}
            <span className="block text-[11px] text-t-primary leading-relaxed mb-2">
              {summary || "(无摘要)"}
            </span>

            {/* Stats */}
            <span className="flex items-center gap-3 text-[9px] text-t-ghost">
              <span className="flex items-center gap-1">
                <MessageSquare size={10} />
                {turnCount} 轮对话
              </span>
              <span className="flex items-center gap-1">
                <FileText size={10} />
                {totalMessages} 条消息
              </span>
              {label && (
                <span className="flex items-center gap-1 text-violet-400/80">
                  <Tag size={9} />
                  {label}
                </span>
              )}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}
