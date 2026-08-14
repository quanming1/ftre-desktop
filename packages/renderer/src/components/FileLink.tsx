/**
 * FileLink — markdown 内 file:// 本地文件链接
 *
 * 后端 system_prompt 约定：AI 引用本地文件时输出
 *   [展示名](file:///E:/proj/src/main.py)      基本格式
 *   [展示名](file:///E:/proj/src/main.py#L42)  指定行号
 *
 * 本组件把它渲染为与网址链接不同的「文件 chip」UI（文件类型图标 + 等宽字体）。
 * 点击在右侧 Inspector 面板打开文件预览 tab——与 read/write 工具卡片的打开逻辑
 * 完全一致（openFilePreview + 确保 inspector 面板可见），支持行号跳转。
 */
import { memo, useCallback } from "react";
import { useInspector } from "@/stores/inspector";
import { useLayout } from "@/stores/layout";
import { FileIconView } from "./FileIconView";

export interface FileLinkTarget {
  /** 本地绝对路径（正斜杠形式，如 E:/proj/src/main.py） */
  path: string;
  /** 行号（1-based），无则为 null */
  line: number | null;
}

/** 解析 file:// URI → 本地路径 + 行号；非 file:// 或格式非法返回 null */
export function parseFileLink(href: string): FileLinkTarget | null {
  if (!/^file:\/\//i.test(href)) return null;
  let rest = href.replace(/^file:\/\//i, "");
  // 去掉查询串；行号从 hash 取（#L42）
  let line: number | null = null;
  const hashIndex = rest.indexOf("#");
  if (hashIndex >= 0) {
    const hash = rest.slice(hashIndex + 1);
    rest = rest.slice(0, hashIndex);
    const m = /^L(\d+)$/i.exec(hash);
    if (m) line = parseInt(m[1], 10);
  }
  const qIndex = rest.indexOf("?");
  if (qIndex >= 0) rest = rest.slice(0, qIndex);
  // file:///E:/a/b.ts → 去掉盘符前的开头斜杠；file://E:/a/b.ts（容错）不动
  rest = rest.replace(/^\/(?=[A-Za-z]:)/, "");
  if (!rest) return null;
  try {
    rest = decodeURIComponent(rest);
  } catch {
    // 已是普通文本，保持原样
  }
  return { path: rest, line };
}

export const FileLink = memo(function FileLink({
  href,
  label,
}: {
  href: string;
  /** 链接展示文本（markdown [展示名]） */
  label: string;
}) {
  const target = parseFileLink(href);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const t = target ?? parseFileLink(href);
      if (!t) return;
      // 与 InlineToolCallCard（read/write 工具卡片）同款逻辑：
      // Inspector 右侧面板打开文件预览 tab + 面板不可见时展开
      useInspector.getState().openFilePreview(
        `file-link:${t.path}`,
        t.path,
        undefined,
        t.line ?? undefined,
        undefined,
      );
      if (!useLayout.getState().panelVisible.inspector) {
        useLayout.getState().togglePanelVisible("inspector");
      }
    },
    [href, target],
  );

  if (!target) {
    // 解析失败退化为纯文本，不给可点击的假象
    return <span className="text-t-secondary">{label}</span>;
  }

  const displayName = label?.trim() || target.path;

  return (
    <button
      type="button"
      onClick={handleClick}
      title={target.line != null ? `${target.path}:${target.line}` : target.path}
      className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-elevated px-1.5 py-0.5 align-baseline font-mono text-[12px] text-t-primary transition-colors hover:border-t-primary hover:bg-hover"
    >
      <FileIconView path={target.path} size={13} />
      <span className="truncate">{displayName}</span>
      {target.line != null && (
        <span className="shrink-0 text-t-muted">:{target.line}</span>
      )}
    </button>
  );
});

