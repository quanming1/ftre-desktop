/**
 * PreviewHeader — 预览工具栏（文件预览 / diff 预览共用）
 *
 * 统一为矮版样式（30px 高、py-1、紧凑按钮 p-1），避免文件预览与 diff 预览
 * header 高度/间距不一致。文件名居中结构：left 槽（可选图标/统计）+
 * 文件名 + ml-auto 右槽（按钮组）。按钮统一用 PreviewToolbarButton。
 */
import type { ReactNode, MouseEventHandler } from "react";

interface PreviewToolbarButtonProps {
  title: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** 激活态（按下/开关打开） */
  active?: boolean;
  children: ReactNode;
}

export function PreviewToolbarButton({
  title,
  onClick,
  active = false,
  children,
}: PreviewToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1 rounded transition-colors ${active ? "text-t-primary bg-hover" : "text-t-faint hover:text-t-primary hover:bg-hover"}`}
    >
      {children}
    </button>
  );
}

interface PreviewHeaderProps {
  /** 完整路径（title 提示用） */
  fileName: string;
  /** 文件名左侧内容（如图标、增删统计） */
  left?: ReactNode;
  /** 右侧按钮组（ml-auto） */
  right?: ReactNode;
}

export function PreviewHeader({ fileName, left, right }: PreviewHeaderProps) {
  const displayName = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
  return (
    <div
      className="px-2.5 py-1 shrink-0 flex items-center gap-1.5 bg-surface overflow-hidden rounded-md border border-border"
      style={{ height: 30 }}
    >
      {left}
      <span
        className="text-[11px] font-mono text-t-ghost truncate min-w-0"
        title={fileName}
      >
        {displayName}
      </span>
      <div className="ml-auto flex items-center gap-0.5 shrink-0">{right}</div>
    </div>
  );
}
