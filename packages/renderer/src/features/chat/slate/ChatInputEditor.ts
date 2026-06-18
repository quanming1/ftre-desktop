import {
  createEditor,
  Transforms,
  Editor,
  Descendant,
  Element as SlateElement,
  Range,
} from "slate";
import { withReact, ReactEditor } from "slate-react";
import { withHistory } from "slate-history";
import { withSkillChips } from "./plugins";
import type { SkillRef, SkillChipElement } from "./types";
import type { MessagePart } from "@/types/chat";

export const IMAGE_MIME_WHITELIST: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
export const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const IMAGE_MAX_PER_MESSAGE = 8;

export interface ImageAttachmentDTO {
  type: "image";
  mime_type: string;
  data: string;
  name?: string;
}

export interface SerializedInput {
  text: string;
  skillRefs: SkillRef[];
  parts: MessagePart[];
}

const EMPTY_VALUE: Descendant[] = [
  { type: "paragraph", children: [{ text: "" }] },
];

type RestorablePart =
  | MessagePart
  | { type: "text"; data: string }
  | { type: "skill"; data: string };

function partText(part: RestorablePart): string {
  if (part.type !== "text") return "";
  return String("text" in part ? part.text : part.data || "");
}

export class ChatInputEditor {
  readonly editor: Editor;
  private _value: Descendant[] = EMPTY_VALUE;

  constructor() {
    this.editor = withSkillChips(withHistory(withReact(createEditor())));
  }

  get value(): Descendant[] {
    return this._value;
  }

  onChange = (value: Descendant[]): void => {
    this._value = value;
  };

  get initialValue(): Descendant[] {
    return EMPTY_VALUE;
  }

  getSkillSearch(): { search: string; range: Range } | null {
    const { selection } = this.editor;
    if (!selection || !Range.isCollapsed(selection)) return null;

    const [start] = Range.edges(selection);
    const lineStart = Editor.before(this.editor, start, { unit: "line" });
    if (!lineStart) return null;

    const beforeRange: Range = { anchor: lineStart, focus: start };
    const beforeText = Editor.string(this.editor, beforeRange);
    const slashIndex = beforeText.lastIndexOf("/");
    if (slashIndex === -1) return null;
    if (slashIndex > 0 && !/\s/.test(beforeText[slashIndex - 1])) return null;

    const search = beforeText.slice(slashIndex + 1);
    if (/\s/.test(search)) return null;

    const slashPoint = Editor.before(this.editor, start, {
      unit: "offset",
      distance: beforeText.length - slashIndex,
    });
    if (!slashPoint) return null;

    return { search, range: { anchor: slashPoint, focus: start } };
  }

  insertSkillChip(ref: SkillRef, targetRange: Range): void {
    const chip: SkillChipElement = {
      type: "skill-chip",
      skillRef: ref,
      children: [{ text: "" }],
    };

    Transforms.select(this.editor, targetRange);
    Transforms.delete(this.editor);
    Transforms.insertNodes(this.editor, chip);
    Transforms.move(this.editor);
    Transforms.insertText(this.editor, " ");
  }

  insertSkillChipAtEnd(ref: SkillRef): void {
    const chip: SkillChipElement = {
      type: "skill-chip",
      skillRef: ref,
      children: [{ text: "" }],
    };
    ReactEditor.focus(this.editor as ReactEditor);
    const end = Editor.end(this.editor, []);
    Transforms.select(this.editor, end);
    Transforms.insertNodes(this.editor, chip);
    Transforms.move(this.editor);
    Transforms.insertText(this.editor, " ");
  }

  replaceRange(targetRange: Range, text: string): void {
    Transforms.select(this.editor, targetRange);
    Transforms.delete(this.editor);
    Transforms.insertText(this.editor, text);
  }

  clear(): void {
    Transforms.delete(this.editor, {
      at: {
        anchor: Editor.start(this.editor, []),
        focus: Editor.end(this.editor, []),
      },
    });
    Transforms.select(this.editor, Editor.start(this.editor, []));
  }

  focus(): void {
    ReactEditor.focus(this.editor as ReactEditor);
  }

  setContent(parts: RestorablePart[]): void {
    this.clear();
    for (const part of parts) {
      if (part.type === "text") {
        const text = partText(part);
        if (text) Transforms.insertText(this.editor, text);
      } else if (part.type === "skill") {
        const data = String(part.data || "");
        if (!data) continue;
        this.insertSkillChipAtEnd({
          id: data,
          name: data,
          description: "",
        });
      }
    }
    this.focus();
  }

  serialize(): SerializedInput {
    return ChatInputEditor.serializeValue(this._value);
  }

  get isEmpty(): boolean {
    const { text, skillRefs } = this.serialize();
    return text.length === 0 && skillRefs.length === 0;
  }

  static serializeValue(nodes: Descendant[]): SerializedInput {
    const textParts: string[] = [];
    const skillRefs: SkillRef[] = [];
    const parts: MessagePart[] = [];

    for (const node of nodes) {
      if (!SlateElement.isElement(node) || node.type !== "paragraph") continue;

      const lineTexts: string[] = [];
      let pendingText = "";

      const flush = () => {
        if (!pendingText) return;
        parts.push({ type: "text", text: pendingText });
        lineTexts.push(pendingText);
        pendingText = "";
      };

      for (const child of node.children) {
        if (SlateElement.isElement(child) && child.type === "skill-chip") {
          const chip = child as SkillChipElement;
          skillRefs.push(chip.skillRef);
          flush();
          parts.push({
            type: "skill",
            data: chip.skillRef.name || chip.skillRef.id,
          });
        } else if ("text" in child) {
          pendingText += (child as { text: string }).text;
        }
      }

      flush();
      textParts.push(lineTexts.join(""));
    }

    const fullText = textParts.join("\n").trim();
    const cleanParts = parts.filter((p) => {
      if (p.type !== "text") return true;
      return p.text.trim().length > 0;
    });

    const mergedParts: MessagePart[] = [];
    for (const p of cleanParts) {
      const last = mergedParts[mergedParts.length - 1];
      if (p.type === "text" && last?.type === "text") {
        mergedParts[mergedParts.length - 1] = {
          type: "text",
          text: `${last.text}\n${p.text}`,
        };
      } else {
        mergedParts.push(p);
      }
    }

    return {
      text: fullText,
      skillRefs,
      parts:
        mergedParts.length > 0
          ? mergedParts
          : fullText
            ? [{ type: "text", text: fullText }]
            : [],
    };
  }
}
