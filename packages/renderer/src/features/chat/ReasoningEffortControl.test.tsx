import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReasoningEffortControl } from "./ReasoningEffortControl";

describe("ReasoningEffortControl", () => {
  it("renders configured efforts as a discrete slider and updates the selected effort", () => {
    const onChange = vi.fn();

    render(
      <ReasoningEffortControl
        values={["none", "low", "high", "max"]}
        value="high"
        onChange={onChange}
      />,
    );

    expect(screen.getByText("高级")).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "推理强度：高级" });
    expect(slider).toHaveValue("3");
    expect(slider).toHaveAttribute("aria-valuetext", "高级");

    fireEvent.change(slider, { target: { value: "4" } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("max");
  });

  it("keeps the empty-string default value selectable without sending redundant updates", () => {
    const onChange = vi.fn();

    render(
      <ReasoningEffortControl
        values={["", "high", "max"]}
        value=""
        onChange={onChange}
      />,
    );

    const slider = screen.getByRole("slider", { name: "推理强度：默认" });
    expect(slider).toHaveValue("0");

    fireEvent.change(slider, { target: { value: "0" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adds the default option when the model omits it from its configured values", () => {
    const onChange = vi.fn();

    render(
      <ReasoningEffortControl
        values={["none", "low", "high", "max"]}
        value=""
        onChange={onChange}
      />,
    );

    const slider = screen.getByRole("slider", { name: "推理强度：默认" });
    expect(slider).toHaveValue("0");

    fireEvent.change(slider, { target: { value: "1" } });
    expect(onChange).toHaveBeenCalledWith("none");
  });

  it.each([
    ["minimal", "极低"],
    ["medium", "中等"],
    ["xhigh", "超高"],
  ])("labels %s as %s", (value, label) => {
    render(<ReasoningEffortControl values={[value]} value={value} onChange={vi.fn()} />);

    expect(screen.getByRole("slider", { name: `推理强度：${label}` })).toHaveAttribute(
      "aria-valuetext",
      label,
    );
  });
});
