import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@ftre/ui";

import { useInspector } from "@/stores/inspector";
import { useLayout } from "@/stores/layout";
import { InspectorPanel } from "./InspectorPanel";

function renderInspectorPanel() {
  return render(
    <TooltipProvider>
      <InspectorPanel />
    </TooltipProvider>,
  );
}

describe("InspectorPanel fixed state tab", () => {
  beforeEach(() => {
    useInspector.setState({ tabs: [], activeTabId: null, fileTreeOpen: false });
    useLayout.setState({
      panelVisible: { ...useLayout.getState().panelVisible, inspector: false },
    });
  });

  it("通过固定面板下拉菜单切换 state.json、Traces 与 WS Logs", () => {
    renderInspectorPanel();
    const stateTab = screen.getByRole("button", { name: "state.json" });
    expect(stateTab).toBeInTheDocument();
    expect(screen.queryByTitle("关闭")).not.toBeInTheDocument();

    fireEvent.pointerDown(stateTab);
    fireEvent.pointerUp(stateTab);
    const tracesOption = screen.getByRole("menuitem", { name: "Traces" });
    expect(tracesOption).toBeInTheDocument();
    fireEvent.click(tracesOption);
    expect(useInspector.getState().activeTabId).toBe("inspector-traces");
    expect(useInspector.getState().tabs).toEqual([]);
  });

  it("文件 tab 的关闭按钮定位在右侧，默认隐藏并在 tab hover 时显示", () => {
    const tabId = "file-tab-1";
    useInspector.setState({
      tabs: [{
        id: tabId,
        type: "file",
        toolCallId: "tool-1",
        title: "DriveChrome.stories.tsx",
        filePath: "E:/octo-web/src/__visual__/DriveChrome.stories.tsx",
        content: "",
        revealNonce: 0,
      }],
      activeTabId: null,
      fileTreeOpen: false,
    });

    renderInspectorPanel();

    const tabButton = document.querySelector<HTMLElement>("[data-tab-btn]");
    const closeButton = tabButton?.querySelector<HTMLElement>("[data-tab-close]");
    expect(closeButton).toHaveClass("absolute", "right-1", "opacity-0", "group-hover:opacity-100");
    expect(tabButton?.querySelector(".bg-gradient-to-r")).toBeInTheDocument();
  });

  it("侧面板打开时将关闭按钮固定在面板右上角", () => {
    useLayout.setState({
      panelVisible: { ...useLayout.getState().panelVisible, inspector: true },
    });

    renderInspectorPanel();

    const closeButton = screen.getByRole("button", { name: "隐藏侧面板" });
    expect(closeButton.parentElement).toHaveClass("absolute", "right-4", "top-2.5");
    fireEvent.click(closeButton);
    expect(useLayout.getState().panelVisible.inspector).toBe(false);
  });
});
