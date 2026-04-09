/**
 * SkillChip 渲染组件
 *
 * 在 Slate 编辑器中以 inline chip 形式展示 skill 引用。
 * 显示: ⚡ skill-name
 * hover 时显示描述 tooltip。
 */
import { useState } from "react";
import { useFocused, useSelected } from "slate-react";
import type { RenderElementProps } from "slate-react";
import type { SkillChipElement } from "../types";
import { Zap } from "lucide-react";

interface Props extends RenderElementProps {
  element: SkillChipElement;
}

export function SkillChipView({ element, attributes, children }: Props) {
  const selected = useSelected();
  const focused = useFocused();
  const [hover, setHover] = useState(false);
  const { skillRef } = element;

  const name = skillRef?.name || "";
  const description = skillRef?.description || "";

  return (
    <span
      {...attributes}
      contentEditable={false}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`relative inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-mono cursor-default align-baseline transition-colors max-w-full ${
        selected && focused
          ? "bg-amber-500/20 text-amber-300 border border-amber-400/40"
          : "bg-amber-500/10 text-amber-300/80 border border-amber-500/20 hover:bg-amber-500/15 hover:text-amber-300"
      }`}
    >
      <Zap size={10} className="shrink-0 opacity-70" />
      <span className="truncate max-w-[180px]">{name}</span>
      {children}

      {hover && description && (
        <span className="absolute bottom-full left-0 mb-1.5 z-50 pointer-events-none">
          <span className="block bg-elevated border border-border-subtle rounded-lg shadow-xl px-3 py-2 min-w-[200px] max-w-[320px]">
            {/* Header */}
            <span className="flex items-center gap-2 text-[10px] text-amber-400 mb-1.5">
              <Zap size={11} />
              <span className="font-medium">{name}</span>
            </span>

            {/* Description */}
            <span className="block text-[11px] text-t-secondary leading-relaxed">
              {description.length > 150
                ? description.slice(0, 150) + "..."
                : description}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}
