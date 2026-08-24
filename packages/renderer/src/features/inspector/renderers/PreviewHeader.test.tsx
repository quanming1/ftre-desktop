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
  it("不显示 hover 绝对路径提示，但仍可点击复制绝对路径", async () => {
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
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.click(pathButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(absolutePath));
  });

  it("点击目录段以该目录为根打开文件列表，并可打开同级文件", async () => {
    const listDirectory = vi
      .fn()
      .mockResolvedValueOnce({
        entries: [
          { name: "src", path: "E:/proj/src", isDir: true, ext: null },
        ],
      })
      .mockResolvedValueOnce({
        entries: [
          { name: "app.ts", path: "E:/proj/src/app.ts", isDir: false, ext: "ts" },
          { name: "other.ts", path: "E:/proj/src/other.ts", isDir: false, ext: "ts" },
        ],
      });
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: { fs: { listDirectory } },
    });
    const onOpenFile = vi.fn();

    render(
      <PreviewHeader
        fileName="E:/proj/src/app.ts"
        variant="breadcrumb"
        pathPicker={{ onOpenFile }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "浏览目录：proj" }));
    expect(await screen.findByText("src")).toBeInTheDocument();
    expect(listDirectory).toHaveBeenNthCalledWith(1, "E:/proj");
    expect(await screen.findByRole("treeitem", { name: "app.ts" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("treeitem", { name: "other.ts" }));
    expect(onOpenFile).toHaveBeenCalledWith({
      name: "other.ts",
      path: "E:/proj/src/other.ts",
      isDir: false,
      ext: "ts",
    });
  });
});
