import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InlineInput } from "./InlineInput";

describe("InlineInput - file name validation", () => {
  const noop = () => {};

  it("shows error for illegal characters and blocks Enter submit", () => {
    const onSubmit = vi.fn();
    render(<InlineInput depth={0} onSubmit={onSubmit} onCancel={noop} siblingNames={[]} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "file?.txt" } });
    expect(screen.getByText(/illegal characters/i)).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows error for duplicate sibling name (case-insensitive)", () => {
    const onSubmit = vi.fn();
    render(<InlineInput depth={0} onSubmit={onSubmit} onCancel={noop} siblingNames={["README.md"]} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "readme.md" } });
    expect(screen.getByText(/already exists/i)).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onCancel for whitespace-only input on Enter", () => {
    const onCancel = vi.fn();
    render(<InlineInput depth={0} onSubmit={noop} onCancel={onCancel} siblingNames={[]} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onCancel on blur when validation fails", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<InlineInput depth={0} onSubmit={onSubmit} onCancel={onCancel} siblingNames={["test.txt"]} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "test.txt" } });
    fireEvent.blur(input);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("submits valid file name on Enter", () => {
    const onSubmit = vi.fn();
    render(<InlineInput depth={0} onSubmit={onSubmit} onCancel={noop} siblingNames={["other.txt"]} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "newfile.txt" } });
    expect(screen.queryByText(/illegal|already exists/i)).toBeNull();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("newfile.txt");
  });

  it("clears error when input becomes valid", () => {
    render(<InlineInput depth={0} onSubmit={noop} onCancel={noop} siblingNames={[]} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "bad*.txt" } });
    expect(screen.getByText(/illegal characters/i)).toBeTruthy();

    fireEvent.change(input, { target: { value: "good.txt" } });
    expect(screen.queryByText(/illegal characters/i)).toBeNull();
  });

  it("applies red border style when error is present", () => {
    render(<InlineInput depth={0} onSubmit={noop} onCancel={noop} siblingNames={[]} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "file|name" } });
    expect(input.className).toContain("border-red-500");
  });

  it("defaults siblingNames to empty array when not provided", () => {
    const onSubmit = vi.fn();
    render(<InlineInput depth={0} onSubmit={onSubmit} onCancel={noop} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "anyname.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("anyname.txt");
  });
});
