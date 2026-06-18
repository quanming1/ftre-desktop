import type { BaseEditor, Descendant } from "slate";
import type { ReactEditor } from "slate-react";
import type { HistoryEditor } from "slate-history";

export interface MentionRef {
  memberId: string;
  memberName: string;
  color: string;
}

export interface SkillRef {
  id: string;
  name: string;
  description: string;
}

export interface ImageRef {
  id: string;
  mimeType: string;
  base64: string;
  name?: string;
  bytes: number;
}

export interface ParagraphElement {
  type: "paragraph";
  children: Descendant[];
}

export interface MentionChipElement {
  type: "mention-chip";
  mention: MentionRef;
  children: [{ text: "" }];
}

export interface SkillChipElement {
  type: "skill-chip";
  skillRef: SkillRef;
  children: [{ text: "" }];
}

export type CustomElement =
  | ParagraphElement
  | MentionChipElement
  | SkillChipElement;

export type CustomText = { text: string };

declare module "slate" {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}
