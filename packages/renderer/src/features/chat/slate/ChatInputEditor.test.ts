import { Editor, Element as SlateElement, Transforms } from "slate";
import { describe, expect, it } from "vitest";
import { ChatInputEditor } from "./ChatInputEditor";

describe("ChatInputEditor Skill token", () => {
  it("leaves the caret after the inserted Skill token", () => {
    const input = new ChatInputEditor();
    input.editor.children = [{
      type: "paragraph",
      children: [{ text: "/review later" }],
    }];
    const range = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 7 },
    };
    Transforms.select(input.editor, range);

    input.replaceRangeWithSkill(range, {
      version: "v1",
      type: "skill",
      name: "review-code",
      args: {},
      raw: "![ftre:skill](ftre://v1/skill/review-code)",
    });

    expect(ChatInputEditor.serializeValue(input.editor.children).text).toBe(
      "![ftre:skill](ftre://v1/skill/review-code) later",
    );
    expect(input.editor.selection).not.toBeNull();
    expect(Editor.above(input.editor, {
      at: input.editor.selection!.focus,
      match: (node) => SlateElement.isElement(node) && node.type === "skill-token",
    })).toBeFalsy();
    expect(input.getSkillSearch()).toBeNull();
  });

  it("serializes a selected Skill as canonical Markdown", () => {
    expect(
      ChatInputEditor.serializeValue([
        {
          type: "paragraph",
          children: [
            {
              type: "skill-token",
              ref: {
                version: "v1",
                type: "skill",
                name: "review-code",
                args: {},
                raw: "![ftre:skill](ftre://v1/skill/review-code)",
              },
              children: [{ text: "" }],
            },
            { text: " src" },
          ],
        },
      ]).text,
    ).toBe("![ftre:skill](ftre://v1/skill/review-code) src");
  });

  it("converts pasted bare Skill URIs into inline tokens before serialization", () => {
    const input = new ChatInputEditor();
    input.editor.children = [{ type: "paragraph", children: [{ text: "" }] }];
    Transforms.select(input.editor, Editor.start(input.editor, [0]));
    input.insertTextWithExtensions("before ftre://v1/skill/review-code?path=src after");

    expect(ChatInputEditor.serializeValue(input.editor.children)).toMatchObject({
      text: "before ![ftre:skill](ftre://v1/skill/review-code?path=src) after",
    });
  });
});
