/**
 * PreviewHeader — 预览工具栏（文件预览 / diff 预览共用）
 *
 * 统一为矮版样式（30px 高、py-1、紧凑按钮 p-1），避免文件预览与 diff 预览
 * header 高度/间距不一致。文件名居中结构：left 槽（可选图标/统计）+
 * 文件名 + ml-auto 右槽（按钮组）。按钮统一用 PreviewToolbarButton。
 */
import { useCallback, type MouseEventHandler, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Tooltip, TooltipProvider } from "@ftre/ui";

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
  /** 完整路径（breadcrumb 悬停提示及复制内容） */
  fileName: string;
  /** 文件名左侧内容（如图标、增删统计） */
  left?: ReactNode;
  /** 右侧按钮组（ml-auto） */
  right?: ReactNode;
  /** 文件预览使用面包屑式 Header；默认保持 Diff 预览的紧凑卡片样式。 */
  variant?: "compact" | "breadcrumb";
}

interface CopyableBreadcrumbProps {
  absolutePath: string;
  parts: string[];
}

function CopyableBreadcrumb({ absolutePath, parts }: CopyableBreadcrumbProps) {
  const copyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(absolutePath);
    } catch {
      // 剪贴板权限不可用时保持静默，不影响文件预览操作。
    }
  }, [absolutePath]);

  return (
    <TooltipProvider>
      <Tooltip
        side="bottom"
        sideOffset={5}
        delayDuration={0}
        content={
          <div className="max-w-[min(70vw,640px)] break-all font-mono text-[11px] leading-4">
            {absolutePath}
          </div>
        }
      >
        <button
          type="button"
          aria-label={`复制绝对路径：${absolutePath}`}
          onClick={() => void copyPath()}
          className="group flex min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-hover active:bg-hover"
        >
          {parts.map((part, index) => (
            <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight size={12} className="shrink-0 text-t-ghost/70" />}
              <span
                className={`truncate ${index === parts.length - 1 ? "font-medium text-t-primary group-hover:text-t-primary" : "text-t-muted group-hover:text-t-secondary"}`}
              >
                {part}
              </span>
            </span>
          ))}
        </button>
      </Tooltip>
    </TooltipProvider>
  );
}

export function PreviewHeader({ fileName, left, right, variant = "compact" }: PreviewHeaderProps) {
  const displayName = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
  const breadcrumbParts = fileName
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .slice(-3);

  if (variant === "breadcrumb") {
    return (
      <div
        className="flex h-8 shrink-0 items-center gap-1 overflow-hidden bg-surface px-2"
      >
        {left && <div className="flex shrink-0 items-center gap-1">{left}</div>}
        <CopyableBreadcrumb absolutePath={fileName} parts={breadcrumbParts} />
        <div className="ml-auto flex shrink-0 items-center gap-0.5">{right}</div>
      </div>
    );
  }

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
