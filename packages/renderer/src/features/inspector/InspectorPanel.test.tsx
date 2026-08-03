import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useInspector } from "@/stores/inspector";
import { InspectorPanel } from "./InspectorPanel";

describe("InspectorPanel fixed state tab", () => {
  beforeEach(() => {
    useInspector.setState({ tabs: [], activeTabId: null, fileTreeOpen: false });
  });

  it("始终展示不可关闭的 state.json 与 Traces 固定 tab", () => {
    render(<InspectorPanel />);
    const stateTab = screen.getByRole("button", { name: "state.json" });
    expect(screen.getByRole("button", { name: "Traces" })).toBeInTheDocument();
    expect(stateTab).toBeInTheDocument();
    expect(screen.queryByTitle("关闭")).not.toBeInTheDocument();

    fireEvent.click(stateTab);
    expect(useInspector.getState().activeTabId).toBe("inspector-session-state");
    expect(useInspector.getState().tabs).toEqual([]);
  });
});
