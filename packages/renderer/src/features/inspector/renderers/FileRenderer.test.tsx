import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileRenderer } from "./FileRenderer";
import type { FileTab } from "@/stores/inspector";

// CodeDiff 依赖真实高亮/布局环境，测试只关心切换逻辑，mock 为纯文本容器
vi.mock("@jiang_quan_ming/react-code-diff", () => ({
  CodeDiff: ({ newValue }: { newValue?: string }) => (
    <div data-testid="code-diff">{newValue}</div>
  ),
}));

beforeEach(() => {
  // FileRenderer 的 snapshot 注册 / 轮询会调用 fs.stat
  window.desktop = {
    fs: {
      stat: vi.fn().mockResolvedValue({ mtime: 1 }),
      readFile: vi.fn().mockResolvedValue({ content: "", language: null, error: null }),
    },
  } as unknown as typeof window.desktop;
});

function makeTab(overrides: Partial<FileTab> = {}): FileTab {
  return {
    id: "tab-1",
    type: "file",
    toolCallId: "tc-1",
    title: "a.md",
    filePath: "E:/docs/a.md",
    content: "# Hello Title\n\n**bold text**",
    revealNonce: 0,
    ...overrides,
  };
}

describe("FileRenderer 渲染预览", () => {
  it("md 文件默认渲染视图，可切到源码，渲染视图 keep-alive", async () => {
    const { container } = render(
      <FileRenderer tab={makeTab()} active wordWrap={false} />,
    );

    // 默认即渲染视图：markdown 被渲染为富文本
    const heading = await screen.findByRole("heading", { name: "Hello Title" });
    expect(heading.tagName).toBe("H1");
    expect(screen.getByText("bold text").tagName).toBe("STRONG");
    // 源码视图隐藏但保持挂载（keep-alive，切回无需重新高亮）
    expect(screen.getByTestId("code-diff").closest(".hidden")).not.toBeNull();

    // 切到源码视图
    fireEvent.click(screen.getByTitle("查看源码"));
    expect(screen.getByTestId("code-diff").closest(".hidden")).toBeNull();
    // 渲染视图保持挂载但隐藏（keep-alive，避免重复解析）
    const markdownBody = container.querySelector(".markdown-body");
    expect(markdownBody).not.toBeNull();
    expect(markdownBody!.closest(".hidden")).not.toBeNull();

    // 切回渲染视图
    fireEvent.click(screen.getByTitle("预览渲染结果"));
    expect((await screen.findByRole("heading", { name: "Hello Title" })).tagName).toBe("H1");
  });

  it("html 文件默认以 sandbox iframe 渲染，切回源码时卸载 iframe", async () => {
    const html = "<h1>Hello HTML</h1>";
    const { container } = render(
      <FileRenderer
        tab={makeTab({ filePath: "E:/docs/a.html", title: "a.html", content: html })}
        active
        wordWrap={false}
      />,
    );

    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    const iframe = container.querySelector("iframe")!;
    // 无 allow-same-origin：opaque origin，脚本无法访问主窗口
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
    expect(iframe).toHaveAttribute("srcdoc", html);
    expect(iframe).toHaveAttribute("title", "E:/docs/a.html");

    // 切回源码：iframe 卸载，不让脚本在后台持续运行
    fireEvent.click(screen.getByTitle("查看源码"));
    await waitFor(() => expect(container.querySelector("iframe")).toBeNull());
  });

  it("非 md / html 文件不显示渲染预览按钮", () => {
    render(
      <FileRenderer
        tab={makeTab({ filePath: "E:/docs/a.ts", title: "a.ts", content: "const a = 1;" })}
        active
        wordWrap={false}
      />,
    );

    expect(screen.queryByTitle("预览渲染结果")).not.toBeInTheDocument();
    expect(screen.queryByTitle("查看源码")).not.toBeInTheDocument();
  });
});
