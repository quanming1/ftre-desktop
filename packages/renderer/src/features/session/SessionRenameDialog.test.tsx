import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionRenameDialog } from "./SessionRenameDialog";

describe("SessionRenameDialog", () => {
  it("通过 Portal 全屏居中渲染并支持保存", () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const onCancel = vi.fn();

    render(
      <SessionRenameDialog
        value="旧标题"
        onChange={onChange}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    const overlay = screen.getByTestId("session-rename-overlay");
    expect(overlay.parentElement).toBe(document.body);
    expect(overlay).toHaveClass("fixed", "inset-0", "items-center", "justify-center");
    expect(screen.getByRole("dialog", { name: "重命名聊天" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "新标题" } });
    expect(onChange).toHaveBeenCalledWith("新标题");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("点击关闭按钮或遮罩可以取消", () => {
    const onCancel = vi.fn();
    render(
      <SessionRenameDialog
        value="标题"
        onChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭重命名弹窗" }));
    fireEvent.mouseDown(screen.getByTestId("session-rename-overlay"));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
