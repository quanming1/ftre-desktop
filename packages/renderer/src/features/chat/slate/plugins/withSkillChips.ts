/**
 * Slate 插件：SkillChip 支持
 *
 * 将 skill-chip 类型标记为 inline + void，
 * 使 Slate 知道它是不可编辑的行内元素。
 */
import type { Editor } from "slate";

export function withSkillChips<T extends Editor>(editor: T): T {
  const { isInline, isVoid } = editor;

  editor.isInline = (element) =>
    element.type === "skill-chip" ? true : isInline(element);

  editor.isVoid = (element) =>
    element.type === "skill-chip" ? true : isVoid(element);

  return editor;
}
