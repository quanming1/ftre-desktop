/**
 * MentionChip 渲染组件
 *
 * 在 Slate 编辑器中以 inline chip 形式展示 @ 提及。
 * 显示: @AgentName  带彩色背景
 */
import { useFocused, useSelected } from 'slate-react';
import type { RenderElementProps } from 'slate-react';
import type { MentionChipElement } from '../types';

interface Props extends RenderElementProps {
  element: MentionChipElement;
}

export function MentionChipView({ element, attributes, children }: Props) {
  const selected = useSelected();
  const focused = useFocused();
  const { mention } = element;

  return (
    <span
      {...attributes}
      contentEditable={false}
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 rounded text-[12px] font-mono font-medium cursor-default align-baseline transition-colors ${
        selected && focused
          ? 'ring-1 ring-neon/50'
          : ''
      }`}
      style={{
        background: `${mention.color}20`,
        color: mention.color,
      }}
    >
      @{mention.memberName}
      {children}
    </span>
  );
}
