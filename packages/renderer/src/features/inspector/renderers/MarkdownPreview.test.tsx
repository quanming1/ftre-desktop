import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownPreview, parseMarkdownFrontmatter } from "./MarkdownPreview";

const MARKDOWN = `---
name: review-code
description: >
  Review the change
  before merging.
enabled: true
metadata:
  owner: platform
---
# Review body

正文内容
`;

describe("MarkdownPreview frontmatter", () => {
  it("解析文件开头的 YAML 并从正文中剥离", () => {
    const result = parseMarkdownFrontmatter(MARKDOWN);

    expect(result.entries).toEqual([
      { key: "name", value: "review-code" },
      { key: "description", value: "Review the change before merging." },
      { key: "enabled", value: "true" },
      { key: "metadata", value: "owner: platform" },
    ]);
    expect(result.body).toContain("# Review body");
    expect(result.body).not.toContain("name: review-code");
  });

  it("将 YAML 字段渲染为表格，正文继续使用 Markdown 渲染", async () => {
    render(<MarkdownPreview content={MARKDOWN} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("description")).toBeInTheDocument();
    expect(screen.getByText("Review the change before merging.")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Review body" })).toBeInTheDocument();
    expect(screen.getByText("正文内容")).toBeInTheDocument();
  });
});
