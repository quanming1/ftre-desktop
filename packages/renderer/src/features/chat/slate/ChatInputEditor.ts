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
import type { MessagePart } from "@/types/chat";
import type { SkillTokenElement } from "./types";
import { parseFtreTokens, serializeFtreRef } from "@/lib/ftre-extensions";

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
  parts: MessagePart[];
}

const EMPTY_VALUE: Descendant[] = [
  { type: "paragraph", children: [{ text: "" }] },
];

export class ChatInputEditor {
  readonly editor: Editor;
  private _value: Descendant[] = EMPTY_VALUE;

  constructor() {
    this.editor = withHistory(withReact(createEditor()));
    const { isInline, isVoid } = this.editor;
    this.editor.isInline = (element) =>
      element.type === "skill-token" ? true : isInline(element);
    this.editor.isVoid = (element) =>
      element.type === "skill-token" ? true : isVoid(element);
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

  getSkillSearch(): { search: string; range: Range; atInputStart: boolean } | null {
    const { selection } = this.editor;
    if (!selection || !Range.isCollapsed(selection)) return null;

    const [start] = Range.edges(selection);
    // Slate returns no previous point for the first line; the document start is
    // the correct fallback so a leading slash opens the menu as well.
    const lineStart = Editor.before(this.editor, start, { unit: "line" })
      ?? Editor.start(this.editor, []);

    const beforeRange: Range = { anchor: lineStart, focus: start };
    const beforeText = Editor.string(this.editor, beforeRange);
    const slashIndex = beforeText.lastIndexOf("/");
    if (slashIndex === -1) return null;

    const search = beforeText.slice(slashIndex + 1);
    if (/\s/.test(search)) return null;

    const slashPoint = Editor.before(this.editor, start, {
      unit: "offset",
      distance: beforeText.length - slashIndex,
    });
    if (!slashPoint) return null;

    const documentStart = Editor.start(this.editor, []);
    const inputPrefix = Editor.string(this.editor, {
      anchor: documentStart,
      focus: slashPoint,
    });
    const hasInlineExtension = Array.from(
      Editor.nodes(this.editor, {
        at: { anchor: documentStart, focus: slashPoint },
        match: (node) => SlateElement.isElement(node) && node.type === "skill-token",
      }),
    ).length > 0;
    return {
      search,
      range: { anchor: slashPoint, focus: start },
      // Commands are only valid when the slash is the first non-whitespace
      // input; Skill references may be inserted at any text position.
      atInputStart: inputPrefix.trim().length === 0 && !hasInlineExtension,
    };
  }

  replaceRange(targetRange: Range, text: string): void {
    Transforms.select(this.editor, targetRange);
    Transforms.delete(this.editor);
    Transforms.insertText(this.editor, text);
  }

  replaceRangeWithSkill(targetRange: Range, ref: SkillTokenElement["ref"]): void {
    Transforms.select(this.editor, targetRange);
    Transforms.delete(this.editor);
    Transforms.insertNodes(this.editor, {
      type: "skill-token",
      ref,
      children: [{ text: "" }],
    });

    // Inline void 节点会把 Slate 选区暂时放在其隐藏文本子节点内，
    // 直接 insertText 不会产生可编辑的空格，焦点也因此没有可见插入点。
    const tokenPoint = this.editor.selection?.focus;
    const afterToken = tokenPoint
      ? Editor.after(this.editor, tokenPoint, { unit: "offset" })
      : undefined;
    if (!afterToken) return;

    const [nextLeaf] = Editor.leaf(this.editor, afterToken);
    const nextChar = nextLeaf.text.slice(afterToken.offset, afterToken.offset + 1);
    if (!nextChar || !/\s/.test(nextChar)) {
      Transforms.insertText(this.editor, " ", { at: afterToken });
    }
    const caret = Editor.after(this.editor, afterToken, { unit: "offset" });
    if (caret) Transforms.select(this.editor, caret);
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

  setContent(parts: Array<{ type: string; text?: string; data?: unknown }>): void {
    this.clear();
    const text = parts
      .filter((part) => part.type === "text")
      .map((part) => "text" in part ? String(part.text || "") : String(part.data || ""))
      .join("");
    if (text) this.insertTextWithExtensions(text);
    this.focus();
  }

  /** Insert pasted text while preserving Skill tokens as inline void nodes. */
  insertTextWithExtensions(text: string): void {
    const fragment = text.split("\n").map((line) => {
      const children = parseFtreTokens(line).reduce<Array<SkillTokenElement | { text: string }>>((nodes, segment) => {
        if (segment.ref?.type === "skill") {
          nodes.push({
            type: "skill-token" as const,
            ref: segment.ref as SkillTokenElement["ref"],
            children: [{ text: "" }],
          } as SkillTokenElement);
          return nodes;
        }
        if (segment.text) nodes.push({ text: segment.text });
        return nodes;
      }, []);
      return {
        type: "paragraph" as const,
        children: children.length > 0 ? children : [{ text: "" }],
      };
    });
    this.editor.insertFragment(fragment as Descendant[]);
  }

  serialize(): SerializedInput {
    return ChatInputEditor.serializeValue(this._value);
  }

  get isEmpty(): boolean {
    const { text } = this.serialize();
    return text.length === 0;
  }

  static serializeValue(nodes: Descendant[]): SerializedInput {
    // 每个 paragraph 对应一行文本；空段落是空字符串，代表用户按下的空行。
    // 段落之间用 \n 连接，从而忠实保留连续换行（多次 Shift+Enter）。
    const lineTexts: string[] = [];

    for (const node of nodes) {
      if (!SlateElement.isElement(node) || node.type !== "paragraph") continue;

      let lineText = "";
      for (const child of node.children) {
        if ("text" in child) {
          lineText += (child as { text: string }).text;
        } else if (child.type === "skill-token") {
          lineText += serializeFtreRef(child.ref);
        }
      }
      lineTexts.push(lineText);
    }

    // 首尾整体去空白，但保留中间的连续空行。
    const fullText = lineTexts.join("\n").trim();

    // 用户输入只会产生 text 段落，text 与 parts 必须一致：
    // 直接把整段文本作为单个 text part，避免逐段合并时丢失空行。
    return {
      text: fullText,
      parts: fullText ? [{ type: "text", text: fullText }] : [],
    };
  }
}
