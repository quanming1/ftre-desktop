import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PreviewHeader } from "./PreviewHeader";

const { writeText } = vi.hoisted(() => ({ writeText: vi.fn() }));

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

describe("PreviewHeader breadcrumb", () => {
  it("悬停展示绝对路径，点击复制绝对路径", async () => {
    const absolutePath = "E:\\octo-web\\src\\__visual__\\DriveChrome.stories.tsx";

    render(
      <PreviewHeader
        fileName={absolutePath}
        variant="breadcrumb"
        left={<span>+2</span>}
      />,
    );

    const pathButton = screen.getByRole("button", {
      name: `复制绝对路径：${absolutePath}`,
    });
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(pathButton).not.toHaveAttribute("title");

    fireEvent.pointerMove(pathButton);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(absolutePath);

    fireEvent.click(pathButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(absolutePath));
  });
});
