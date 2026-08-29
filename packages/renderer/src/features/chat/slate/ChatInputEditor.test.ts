import { describe, expect, it } from "vitest";
import { ChatInputEditor } from "./ChatInputEditor";

describe("ChatInputEditor Skill token", () => {
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
});
