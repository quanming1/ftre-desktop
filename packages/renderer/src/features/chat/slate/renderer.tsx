import type { RenderElementProps } from "slate-react";
import { ParagraphView } from "./elements/ParagraphView";
import { SkillReferenceCard } from "@/lib/ftre-extensions";

export function renderElement(props: RenderElementProps) {
  switch (props.element.type) {
    case "paragraph":
    default:
      return <ParagraphView {...props} />;
    case "skill-token":
      return (
        <span {...props.attributes} contentEditable={false}>
          <SkillReferenceCard ref={props.element.ref} />
          {props.children}
        </span>
      );
  }
}
