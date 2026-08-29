import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileRenderer } from "./FileRenderer";
import { useInspector } from "@/stores/inspector";
import type { FileTab } from "@/stores/inspector";

// CodeDiff 依赖真实高亮/布局环境，测试只关心切换逻辑，mock 为纯文本容器。
// 源码视图 oldValue 恒为 ""，diff 视图 oldValue 为暂存区内容——用 testid 区分两者。
// codeDiffConfig 会 import 库的 mergeConfig，这里把它也转发出来（真实实现）。
vi.mock("@jiang_quan_ming/react-code-diff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jiang_quan_ming/react-code-diff")>();
  return {
    ...actual,
    CodeDiff: ({ oldValue, newValue }: { oldValue?: string; newValue?: string }) => (
      <div data-testid={oldValue ? "code-diff-git" : "code-diff"}>{newValue}</div>
    ),
  };
});

// indexDiff IPC 由测试直接控制（beforeEach 里重置为"无未暂存修改"）
const { mockIndexDiff } = vi.hoisted(() => ({ mockIndexDiff: vi.fn() }));

// mermaid 是动态 import，vitest 对动态 import 的 mock 同样生效
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mmd-svg"></svg>' }),
  },
}));

beforeEach(() => {
  // FileRenderer 的 snapshot 注册 / 轮询会调用 fs.stat；暂存区 Diff 走 git.indexDiff
  window.desktop = {
    fs: {
      stat: vi.fn().mockResolvedValue({ mtime: 1 }),
      readFile: vi.fn().mockResolvedValue({ content: "", language: null, error: null }),
    },
    git: {
      indexDiff: mockIndexDiff,
    },
  } as unknown as typeof window.desktop;
  mockIndexDiff.mockReset().mockResolvedValue({ available: false });
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

  it("虚拟 Skill 快照不回退到磁盘读取", async () => {
    const readFile = vi.spyOn(window.desktop.fs, "readFile");
    const stat = vi.spyOn(window.desktop.fs, "stat");
    render(
      <FileRenderer
        tab={makeTab({
          filePath: "ftre://v1/skill/review-code/SKILL.md",
          title: "SKILL.md",
          content: "# Review code",
        })}
        active
        wordWrap={false}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Review code" })).toBeInTheDocument();
    expect(readFile).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /浏览目录/ })).not.toBeInTheDocument();
  });

  it("虚拟资源缺少快照时也不访问文件系统", async () => {
    const readFile = vi.spyOn(window.desktop.fs, "readFile");
    const stat = vi.spyOn(window.desktop.fs, "stat");
    render(
      <FileRenderer
        tab={makeTab({
          filePath: "ftre://v1/skill/missing/SKILL.md",
          title: "SKILL.md",
          content: null,
        })}
        active
        wordWrap={false}
      />,
    );

    expect(await screen.findByText("资源内容快照不可用")).toBeInTheDocument();
    expect(readFile).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
  });

  it("git 无未暂存修改（干净 / 仅已暂存 / untracked）的文件不显示暂存区 Diff 按钮", () => {
    // indexDiff 默认 available:false（beforeEach），覆盖干净、仅已暂存、untracked
    render(
      <FileRenderer
        tab={makeTab({ filePath: "E:/docs/a.ts", title: "a.ts", content: "const a = 1;" })}
        active
        wordWrap={false}
      />,
    );
    expect(screen.queryByTitle("查看与暂存区的差异")).not.toBeInTheDocument();
  });

  it("preload bridge 暂不可用时安全降级，不访问 undefined.git", () => {
    const previous = window.desktop;
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: undefined,
    });
    try {
      expect(() => render(
        <FileRenderer
          tab={makeTab({ filePath: "E:/docs/a.ts", title: "a.ts", content: "const a = 1;" })}
          active
          wordWrap={false}
        />,
      )).not.toThrow();
    } finally {
      Object.defineProperty(window, "desktop", {
        configurable: true,
        value: previous,
        writable: true,
      });
    }
  });

  it("点击暂存区 Diff 按钮新开 DiffTab（before=暂存区，after=当前内容）", async () => {
    mockIndexDiff.mockResolvedValue({ available: true, staged: "const a = 1;" });
    const openDiffSpy = vi.spyOn(useInspector.getState(), "openDiffPreview");
    try {
      render(
        <FileRenderer
          tab={makeTab({ filePath: "E:/docs/a.ts", title: "a.ts", content: "const a = 2;" })}
          active
          wordWrap={false}
        />,
      );

      fireEvent.click(await screen.findByTitle("查看与暂存区的差异"));
      // openIndexDiff 是 async（await indexDiff），等其完成后再断言
      await waitFor(() => expect(openDiffSpy).toHaveBeenCalledTimes(1));
      expect(openDiffSpy).toHaveBeenCalledWith(
        "gitdiff-E:/docs/a.ts",
        "E:/docs/a.ts",
        "const a = 1;", // before：暂存区版本
        "const a = 2;", // after：当前预览内容（工作区）
        0,
        0,
        "a.ts",
      );
    } finally {
      openDiffSpy.mockRestore();
    }
  });

  it("git 状态变为无未暂存修改后（stage / 还原）按钮消失", async () => {
    mockIndexDiff.mockResolvedValue({ available: true, staged: "const a = 1;" });
    const tab = makeTab({
      filePath: "E:/docs/a.ts", title: "a.ts", content: "const a = 2;",
    });
    const { rerender } = render(
      <FileRenderer tab={tab} active wordWrap={false} />,
    );
    expect(await screen.findByTitle("查看与暂存区的差异")).toBeInTheDocument();

    // 切走再切回（effect 以 active 为依赖重新查询），此时 git 已无未暂存修改
    mockIndexDiff.mockResolvedValue({ available: false });
    rerender(<FileRenderer tab={tab} active={false} wordWrap={false} />);
    rerender(<FileRenderer tab={tab} active wordWrap={false} />);
    await waitFor(() => {
      expect(screen.queryByTitle("查看与暂存区的差异")).not.toBeInTheDocument();
    });
  });

  it("md 内 mermaid 代码块渲染为图表，切源码视图可见 mermaid 源码", async () => {
    const tab = makeTab({
      content: "# 流程\n\n```mermaid\ngraph TD\nA-->B\n```",
    });
    const { container } = render(
      <FileRenderer tab={tab} active wordWrap={false} />,
    );

    // 渲染视图：mermaid 块渲染为 SVG
    await waitFor(() => expect(screen.getByTestId("mmd-svg")).toBeInTheDocument());

    // 切到源码视图：mermaid 源码在 CodeDiff 中可见，SVG 隐藏
    fireEvent.click(screen.getByTitle("查看源码"));
    expect(screen.getByTestId("code-diff").textContent).toContain("graph TD");
    expect(screen.getByTestId("mmd-svg").closest(".hidden")).not.toBeNull();

    // 切回渲染视图：图表重新可见
    fireEvent.click(screen.getByTitle("预览渲染结果"));
    await waitFor(() => expect(screen.getByTestId("mmd-svg").closest(".hidden")).toBeNull());
    expect(container.querySelector(".markdown-body")).not.toBeNull();
  });
});
