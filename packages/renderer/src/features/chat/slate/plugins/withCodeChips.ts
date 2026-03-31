/**
 * Slate 插件：CodeChip 支持
 *
 * 将 code-chip 类型标记为 inline + void，
 * 使 Slate 知道它是不可编辑的行内元素。
 */
import type { Editor } from 'slate';

export function withCodeChips<T extends Editor>(editor: T): T {
    const { isInline, isVoid } = editor;

    editor.isInline = (element) =>
        element.type === 'code-chip' ? true : isInline(element);

    editor.isVoid = (element) =>
        element.type === 'code-chip' ? true : isVoid(element);

    return editor;
}
