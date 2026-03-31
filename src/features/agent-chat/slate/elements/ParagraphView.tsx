/**
 * Paragraph 渲染组件（默认块级元素）
 */
import type { RenderElementProps } from 'slate-react';

export function ParagraphView({ attributes, children }: RenderElementProps) {
  return (
    <p {...attributes} className="relative m-0 p-0">
      {children}
    </p>
  );
}
