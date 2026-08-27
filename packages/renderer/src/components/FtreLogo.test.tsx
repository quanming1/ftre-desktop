import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { FtreLogo } from "./FtreLogo";

describe("FtreLogo", () => {
  it("渲染品牌 SVG，并提供可访问名称", () => {
    render(<FtreLogo />);

    const logo = screen.getByRole("img", { name: "Ftre" });
    expect(logo).toHaveAttribute("src");
    expect(logo).toHaveAttribute("alt", "Ftre");
  });

  it("按 size 映射显示尺寸，同时保留方形图标容器", () => {
    render(<FtreLogo size={2.5} />);

    const logo = screen.getByRole("img", { name: "Ftre" });
    expect(logo).toHaveAttribute("width", "25");
    expect(logo).toHaveAttribute("height", "25");
  });
});
