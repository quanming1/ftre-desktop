/**
 * Slate 插件：ArchiveChip 支持
 *
 * 将 archive-chip 类型标记为 inline + void，
 * 使 Slate 知道它是不可编辑的行内元素。
 */
import type { Editor } from "slate";

export function withArchiveChips<T extends Editor>(editor: T): T {
  const { isInline, isVoid } = editor;

  editor.isInline = (element) =>
    element.type === "archive-chip" ? true : isInline(element);

  editor.isVoid = (element) =>
    element.type === "archive-chip" ? true : isVoid(element);

  return editor;
}
