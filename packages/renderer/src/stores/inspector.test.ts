import { beforeEach, describe, expect, it } from "vitest";
import {
  INSPECTOR_TERMINAL_TAB_ID,
  useInspector,
} from "./inspector";

beforeEach(() => {
  useInspector.setState({ tabs: [], activeTabId: null });
});

describe("inspector terminal tab", () => {
  it("creates multiple terminal tabs with workspace labels", () => {
    useInspector.getState().openTerminalTab("term-1", "ftre");

    const first = useInspector.getState();
    expect(first.activeTabId).toBe(`${INSPECTOR_TERMINAL_TAB_ID}-term-1`);
    expect(first.tabs).toHaveLength(1);
    expect(first.tabs[0]).toMatchObject({
      id: `${INSPECTOR_TERMINAL_TAB_ID}-term-1`,
      type: "terminal",
      title: "ftre",
      terminalId: "term-1",
    });

    useInspector.getState().openTerminalTab("term-2", "ftre (1)");
    expect(useInspector.getState().tabs).toHaveLength(2);
    expect(useInspector.getState().activeTabId).toBe(`${INSPECTOR_TERMINAL_TAB_ID}-term-2`);

    useInspector.getState().openTerminalTab("term-1", "ftre");
    expect(useInspector.getState().tabs).toHaveLength(2);
    expect(useInspector.getState().activeTabId).toBe(`${INSPECTOR_TERMINAL_TAB_ID}-term-1`);
  });

  it("can reopen a terminal tab after closing it", () => {
    const terminalTabId = `${INSPECTOR_TERMINAL_TAB_ID}-term-1`;
    useInspector.getState().openTerminalTab("term-1", "ftre");
    useInspector.getState().closeTab(terminalTabId);

    expect(useInspector.getState().tabs).toHaveLength(0);
    expect(useInspector.getState().activeTabId).toBeNull();

    useInspector.getState().openTerminalTab("term-1", "ftre");
    expect(useInspector.getState().tabs[0]?.type).toBe("terminal");
  });
});
