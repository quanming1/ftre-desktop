import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageTab } from "@/stores/inspector";
import { ImageRenderer } from "./ImageRenderer";

const { readImageBase64 } = vi.hoisted(() => ({
  readImageBase64: vi.fn(),
}));

vi.mock("@/stores/inspector", () => ({
  useInspector: { getState: () => ({ openImagePreview: vi.fn(), openFilePreview: vi.fn() }) },
}));
vi.mock("./PreviewHeader", () => ({
  PreviewHeader: () => <div data-testid="preview-header" />,
}));

const tab: ImageTab = {
  id: "image-1",
  type: "image",
  toolCallId: "tool-1",
  title: "preview.png",
  filePath: "E:/workspace/preview.png",
  revealNonce: 0,
};

beforeEach(() => {
  readImageBase64.mockReset();
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: { fs: { readImageBase64 } },
  });
});

describe("ImageRenderer", () => {
  it("使用 IPC 返回的 dataUrl 渲染图片", async () => {
    readImageBase64.mockResolvedValue({ dataUrl: "data:image/png;base64,AAAA" });

    render(<ImageRenderer tab={tab} active wordWrap={false} />);

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "E:/workspace/preview.png" })).toHaveAttribute(
        "src",
        "data:image/png;base64,AAAA",
      );
    });
  });

  it("IPC 返回空 dataUrl 时显示失败状态", async () => {
    readImageBase64.mockResolvedValue({ dataUrl: "", error: "read failed" });

    render(<ImageRenderer tab={tab} active wordWrap={false} />);

    await waitFor(() => {
      expect(screen.getByText("无法加载图片")).toBeInTheDocument();
    });
  });

  it("IPC reject 时也显示失败状态而不是永久加载", async () => {
    readImageBase64.mockRejectedValue(new Error("IPC unavailable"));

    render(<ImageRenderer tab={tab} active wordWrap={false} />);

    await waitFor(() => {
      expect(screen.getByText("无法加载图片")).toBeInTheDocument();
    });
  });
});
