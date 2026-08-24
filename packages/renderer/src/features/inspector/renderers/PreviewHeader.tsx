/**
 * PreviewHeader — 预览工具栏（文件预览 / diff 预览共用）
 *
 * 统一为矮版样式（30px 高、py-1、紧凑按钮 p-1），避免文件预览与 diff 预览
 * header 高度/间距不一致。文件名居中结构：left 槽（可选图标/统计）+
 * 文件名 + ml-auto 右槽（按钮组）。按钮统一用 PreviewToolbarButton。
 */
import { useCallback, useState, type MouseEventHandler, type ReactNode } from "react";
import { ChevronRight, Copy } from "lucide-react";
import type { FileEntry } from "@ftre/shared";
import { FilePathPopover, parentPath } from "./FilePathPopover";

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
  /** 完整路径（用于 breadcrumb 分段和复制内容） */
  fileName: string;
  /** 文件名左侧内容（如图标、增删统计） */
  left?: ReactNode;
  /** 右侧按钮组（ml-auto） */
  right?: ReactNode;
  /** 文件预览使用面包屑式 Header；默认保持 Diff 预览的紧凑卡片样式。 */
  variant?: "compact" | "breadcrumb";
  /** 开启文件路径浮层；Diff 等只读路径 Header 不传此项。 */
  pathPicker?: {
    onOpenFile: (entry: FileEntry) => void;
  };
}

interface CopyableBreadcrumbProps {
  absolutePath: string;
  parts: Array<{ label: string; path: string; isFile: boolean }>;
  onSegmentClick?: (path: string, anchor: HTMLElement) => void;
}

function CopyableBreadcrumb({ absolutePath, parts, onSegmentClick }: CopyableBreadcrumbProps) {
  const copyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(absolutePath);
    } catch {
      // 剪贴板权限不可用时保持静默，不影响文件预览操作。
    }
  }, [absolutePath]);

  return (
    <div className="group flex min-w-0 max-w-full items-center gap-0.5 rounded-md px-1 py-1 text-left text-[11px]">
          {parts.map((part, index) => (
            <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight size={12} className="shrink-0 text-t-ghost/70" />}
              {onSegmentClick ? (
                <button
                  type="button"
                  aria-label={part.isFile ? `浏览文件所在目录：${part.label}` : `浏览目录：${part.label}`}
                  onClick={(event) => onSegmentClick(part.isFile ? parentPath(part.path) : part.path, event.currentTarget)}
                  className={`max-w-[180px] truncate rounded px-1 py-0.5 transition-colors hover:bg-hover ${index === parts.length - 1 ? "font-medium text-t-primary" : "text-t-muted hover:text-t-secondary"}`}
                >
                  {part.label}
                </button>
              ) : (
                <span className={`max-w-[180px] truncate ${index === parts.length - 1 ? "font-medium text-t-primary" : "text-t-muted"}`}>
                  {part.label}
                </span>
              )}
            </span>
          ))}
          <button
            type="button"
            aria-label={`复制绝对路径：${absolutePath}`}
            onClick={() => void copyPath()}
            className="ml-0.5 shrink-0 rounded p-1 text-t-ghost transition-colors hover:bg-hover hover:text-t-primary"
          >
            <Copy size={12} />
          </button>
    </div>
  );
}

function breadcrumbParts(fileName: string): Array<{ label: string; path: string; isFile: boolean }> {
  const normalized = fileName.replace(/\\/g, "/");
  const isWindowsAbsolute = /^[A-Za-z]:\//.test(normalized);
  const isPosixAbsolute = normalized.startsWith("/");
  const labels = normalized.split("/").filter(Boolean);
  let prefix = "";
  if (isWindowsAbsolute) {
    prefix = `${labels.shift() ?? ""}/`;
  } else if (isPosixAbsolute) {
    prefix = "/";
  }

  let current = prefix;
  return labels.map((label, index) => {
    if (current === "/" || /^[A-Za-z]:\/$/.test(current)) current = `${current}${label}`;
    else current = current ? `${current}/${label}` : label;
    return {
      label,
      path: current,
      isFile: index === labels.length - 1,
    };
  });
}

export function PreviewHeader({ fileName, left, right, variant = "compact", pathPicker }: PreviewHeaderProps) {
  const displayName = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
  const parts = breadcrumbParts(fileName);
  const [picker, setPicker] = useState<{ rootPath: string; anchorEl: HTMLElement } | null>(null);

  const openPicker = useCallback((rootPath: string, anchorEl: HTMLElement) => {
    setPicker((current) => current?.rootPath === rootPath ? null : { rootPath, anchorEl });
  }, []);
  const closePicker = useCallback(() => setPicker(null), []);
  const handleOpenFile = useCallback((entry: FileEntry) => {
    pathPicker?.onOpenFile(entry);
    setPicker(null);
  }, [pathPicker]);

  if (variant === "breadcrumb") {
    return (
      <>
        <div className="flex h-8 shrink-0 items-center gap-1 overflow-hidden bg-surface px-2">
        {left && <div className="flex shrink-0 items-center gap-1">{left}</div>}
        <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <CopyableBreadcrumb absolutePath={fileName} parts={parts} onSegmentClick={pathPicker ? openPicker : undefined} />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">{right}</div>
        </div>
        {pathPicker && picker && (
          <FilePathPopover
            open
            anchorEl={picker.anchorEl}
            rootPath={picker.rootPath}
            currentFilePath={fileName}
            onClose={closePicker}
            onOpenFile={handleOpenFile}
          />
        )}
      </>
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
