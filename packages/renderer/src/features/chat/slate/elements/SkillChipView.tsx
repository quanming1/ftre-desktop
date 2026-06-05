/**
 * SkillChip 渲染组件
 *
 * 在 Slate 编辑器中以 inline chip 形式展示 skill 引用。
 * 显示: 绿色图标 + skill-name
 * hover 时显示描述 tooltip。
 */
import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocused, useSelected } from "slate-react";
import type { RenderElementProps } from "slate-react";
import type { SkillChipElement } from "../types";
import { Box } from "lucide-react";

interface Props extends RenderElementProps {
  element: SkillChipElement;
}

export function SkillChipView({ element, attributes, children }: Props) {
  const selected = useSelected();
  const focused = useFocused();
  const [hover, setHover] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const { skillRef } = element;

  const name = skillRef?.name || "";
  const description = skillRef?.description || "";
  const rect = hover && description ? anchorRef.current?.getBoundingClientRect() : null;

  return (
    <span
      {...attributes}
      ref={(node) => {
        anchorRef.current = node;
        if (typeof attributes.ref === "function") attributes.ref(node);
      }}
      contentEditable={false}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`relative inline-flex items-center gap-1.5 mx-0.5 px-0 py-0 text-[13px] leading-6 font-semibold cursor-default align-baseline transition-colors max-w-full text-[#1a7f37] ${
        selected && focused ? "" : "hover:text-[#116329]"
      }`}
    >
      <Box size={14} strokeWidth={2} className="shrink-0" />
      <span className="truncate max-w-[220px]">{name}</span>
      {children}

      {rect &&
        createPortal(
          <span
            className="fixed z-[9999] pointer-events-none"
            style={{
              left: Math.min(rect.left, window.innerWidth - 340),
              top: rect.top - 8,
              transform: "translateY(-100%)",
            }}
          >
            <span className="block bg-elevated border border-border-subtle rounded-lg shadow-xl px-3 py-2 min-w-[220px] max-w-[320px]">
              {/* Header */}
              <span className="flex items-center gap-2 text-[10px] text-[#1a7f37] mb-1.5">
                <Box size={11} strokeWidth={2} />
                <span className="font-semibold">{name}</span>
              </span>

              {/* Description */}
              <span className="block text-[11px] text-t-secondary leading-relaxed">
                {description.length > 150
                  ? description.slice(0, 150) + "..."
                  : description}
              </span>
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}
