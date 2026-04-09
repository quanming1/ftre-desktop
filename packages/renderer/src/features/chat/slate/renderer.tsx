/**
 * Slate Element 渲染分发器
 *
 * 根据 element.type 分发到对应的渲染组件。
 * 新增 element 类型时在 switch 里加一个 case 即可。
 */
import type { RenderElementProps } from "slate-react";
import type {
  CodeChipElement,
  ArchiveChipElement,
  SkillChipElement,
} from "./types";
import { CodeChipView } from "./elements/CodeChipView";
import { ParagraphView } from "./elements/ParagraphView";
import { ArchiveChipView } from "./elements/ArchiveChipView";
import { SkillChipView } from "./elements/SkillChipView";

export function renderElement(props: RenderElementProps) {
  switch (props.element.type) {
    case "code-chip":
      return (
        <CodeChipView {...props} element={props.element as CodeChipElement} />
      );
    case "archive-chip":
      return (
        <ArchiveChipView
          {...props}
          element={props.element as ArchiveChipElement}
        />
      );
    case "skill-chip":
      return (
        <SkillChipView {...props} element={props.element as SkillChipElement} />
      );
    case "paragraph":
    default:
      return <ParagraphView {...props} />;
  }
}
