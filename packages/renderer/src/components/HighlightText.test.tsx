import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { HighlightText } from "./HighlightText";

describe("HighlightText", () => {
  it("高亮命中片段（mark 包裹，大小写不敏感）", () => {
    render(<HighlightText text="部署 the Gateway 部署完成" query="部署" />);
    const marks = screen.getAllByText("部署");
    expect(marks).toHaveLength(2);
    expect(marks.every((m) => m.tagName === "MARK")).toBe(true);
  });

  it("ASCII 大小写不敏感高亮", () => {
    render(<HighlightText text="Deploy the Gateway" query="deploy" />);
    expect(screen.getByText("Deploy").tagName).toBe("MARK");
    expect(screen.getByText(/the Gateway/).tagName).toBe("SPAN");
  });

  it("多段命中穿插渲染", () => {
    render(<HighlightText text="aXbXcXd" query="x" />);
    expect(screen.getAllByText("X")).toHaveLength(3);
  });

  it("空 query 或未命中时无 mark", () => {
    const { rerender } = render(<HighlightText text="普通文本" query="" />);
    expect(screen.getByText("普通文本").tagName).toBe("SPAN");
    rerender(<HighlightText text="普通文本" query="不存在" />);
    expect(screen.getByText("普通文本").tagName).toBe("SPAN");
    expect(screen.queryByRole("mark")).toBeNull();
  });
});
