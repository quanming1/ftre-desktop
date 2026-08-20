import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/stores/chat";
import {
  ChatOutline,
  getHistoryItems,
  getMarkerWidth,
  getPreviewText,
} from "./ChatOutline";

const message = (
  id: string,
  role: ChatMessage["role"],
  content: string,
): ChatMessage => ({ id, role, content, timestamp: 1 });

function setRect(element: HTMLElement, rect: Partial<DOMRect> = {}) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 600,
      height: 600,
      left: 40,
      right: 940,
      top: 0,
      width: 900,
      x: 40,
      y: 0,
      toJSON: () => ({}),
      ...rect,
    }),
  });
}

function renderOutline(messages: ChatMessage[], width = 900) {
  const container = document.createElement("div");
  setRect(container, { width, right: 40 + width });
  const scrollContainerRef = { current: container };
  const scrollIntoView = vi.fn();

  const anchors = messages
    .filter((item) => item.role === "user")
    .map((item) => {
      const anchor = document.createElement("div");
      anchor.id = `msg-${item.id}`;
      setRect(anchor, { top: 100 });
      Object.defineProperty(anchor, "scrollIntoView", {
        configurable: true,
        value: scrollIntoView,
      });
      document.body.appendChild(anchor);
      return anchor;
    });

  const result = render(
    <ChatOutline messages={messages} scrollContainerRef={scrollContainerRef} />,
  );
  return { ...result, anchors, scrollIntoView };
}

afterEach(() => {
  document.querySelectorAll('[id^="msg-"]').forEach((element) => element.remove());
});

describe("ChatOutline", () => {
  it("只为用户消息生成定位条目，并折叠预览文本", () => {
    const items = getHistoryItems([
      message("u1", "user", "  第一条\n 用户消息  "),
      message("a1", "assistant", "assistant"),
      message("u2", "user", "第二条用户消息"),
    ]);

    expect(items).toEqual([
      { id: "u1", text: "第一条 用户消息", responseText: "assistant", index: 0 },
      { id: "u2", text: "第二条用户消息", responseText: "", index: 1 },
    ]);
    expect(getPreviewText("a".repeat(181))).toHaveLength(181);
    expect(getMarkerWidth(2, -1)).toBe(6);
    expect(getMarkerWidth(3, 3)).toBe(27);
    expect(getMarkerWidth(2, 3)).toBeLessThan(getMarkerWidth(3, 3));
    expect(getMarkerWidth(20, 3)).toBe(6);
  });

  it("仅悬停激活瀑布轨道、显示摘要，并允许点击定位", () => {
    const { scrollIntoView } = renderOutline([
      message("u1", "user", "第一条用户消息的摘要"),
      message("a1", "assistant", "assistant"),
      message("u2", "user", "第二条用户消息"),
    ]);

    const firstMarker = screen.getByRole("button", { name: /定位到第 1 条用户消息/ });
    const secondMarker = screen.getByRole("button", { name: /定位到第 2 条用户消息/ });

    fireEvent.focus(firstMarker);
    expect(screen.queryByText("第一条用户消息的摘要")).not.toBeInTheDocument();

    fireEvent.mouseEnter(firstMarker);
    expect(screen.getByText("第一条用户消息的摘要")).toBeInTheDocument();
    expect(screen.getByText("assistant")).toBeInTheDocument();

    fireEvent.mouseEnter(secondMarker);
    expect(secondMarker).toHaveStyle({ width: "27px" });
    expect(firstMarker).toHaveStyle({ width: "24px" });
    expect(screen.getByText("第二条用户消息")).toBeInTheDocument();

    fireEvent.click(firstMarker);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("离开导航后轨道立即恢复短线，且不使用过渡动画", () => {
    renderOutline([message("u1", "user", "窄窗口摘要")], 640);

    const marker = screen.getByRole("button", { name: /定位到第 1 条用户消息/ });
    fireEvent.mouseEnter(marker);
    expect(screen.queryByText("窄窗口摘要")).not.toBeInTheDocument();
    expect(marker).toHaveStyle({ width: "27px" });

    fireEvent.mouseLeave(screen.getByLabelText("会话消息历史"));
    expect(marker).toHaveStyle({ width: "6px" });
    expect(marker.className).not.toContain("transition-");
  });
});
