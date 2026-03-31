/**
 * Agent Chat Slate Element 渲染分发器
 *
 * 根据 element.type 分发到对应的渲染组件。
 */
import type { RenderElementProps } from 'slate-react';
import type { MentionChipElement } from './types';
import { MentionChipView } from './elements/MentionChipView';
import { ParagraphView } from './elements/ParagraphView';

export function renderElement(props: RenderElementProps) {
  switch (props.element.type) {
    case 'mention-chip':
      return <MentionChipView {...props} element={props.element as MentionChipElement} />;
    case 'paragraph':
    default:
      return <ParagraphView {...props} />;
  }
}
