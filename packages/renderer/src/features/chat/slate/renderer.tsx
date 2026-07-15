import type { RenderElementProps } from "slate-react";
import { ParagraphView } from "./elements/ParagraphView";

export function renderElement(props: RenderElementProps) {
  switch (props.element.type) {
    case "paragraph":
    default:
      return <ParagraphView {...props} />;
  }
}
