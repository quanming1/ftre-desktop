/**
 * CodeChip 渲染组件
 *
 * 在 Slate 编辑器中以 inline chip 形式展示代码引用。
 * 显示: 📄 filename.ts:L12-L25
 * hover 时显示代码预览 tooltip。
 * 点击跳转到对应文件的指定行。
 */
import { useState, useCallback } from "react";
import { useFocused, useSelected } from "slate-react";
import type { RenderElementProps } from "slate-react";
import type { CodeChipElement } from "../types";
import { handleOpenFileAtLine } from "../../toolActions";

interface Props extends RenderElementProps {
  element: CodeChipElement;
}

export function CodeChipView({ element, attributes, children }: Props) {
  const selected = useSelected();
  const focused = useFocused();
  const [hover, setHover] = useState(false);
  const { codeRef } = element;

  const label = `${codeRef.fileName}:L${codeRef.startLine}-L${codeRef.endLine}`;
  const lineCount = codeRef.endLine - codeRef.startLine + 1;

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleOpenFileAtLine(codeRef.filePath, codeRef.startLine);
  }, [codeRef.filePath, codeRef.startLine]);

  return (
    <span
      {...attributes}
      contentEditable={false}
      onClick={handleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-mono cursor-pointer align-baseline transition-colors max-w-full ${
        selected && focused
          ? "bg-neon/20 text-neon border border-neon/40"
          : "bg-white/[0.06] text-t-secondary border border-border-subtle hover:bg-white/[0.1] hover:text-t-primary"
      }`}
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 opacity-60">
        <path d="M2 1.5A1.5 1.5 0 013.5 0h6.879a1.5 1.5 0 011.06.44l2.122 2.12A1.5 1.5 0 0114 3.622V14.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 14.5v-13z" />
      </svg>
      {label}
      {children}

      {hover && (
        <span className="absolute bottom-full left-0 mb-1.5 z-50 pointer-events-none">
          <span className="block bg-elevated border border-border-subtle rounded-lg shadow-xl px-3 py-2 max-w-[360px]">
            <span className="block text-[9px] text-t-ghost font-mono mb-1">
              {codeRef.filePath} · {lineCount} 行 · 点击打开
            </span>
            <pre className="text-[10px] text-t-secondary font-mono whitespace-pre-wrap max-h-[120px] overflow-hidden leading-relaxed">
              {codeRef.content.length > 300 ? codeRef.content.slice(0, 300) + "..." : codeRef.content}
            </pre>
          </span>
        </span>
      )}
    </span>
  );
}
