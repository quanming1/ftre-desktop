import type { RenderElementProps } from "slate-react";
import type { SkillChipElement } from "./types";
import { ParagraphView } from "./elements/ParagraphView";
import { SkillChipView } from "./elements/SkillChipView";

export function renderElement(props: RenderElementProps) {
  switch (props.element.type) {
    case "skill-chip":
      return (
        <SkillChipView {...props} element={props.element as SkillChipElement} />
      );
    case "paragraph":
    default:
      return <ParagraphView {...props} />;
  }
}
