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

describe("inspector audit tab", () => {
  it("按工作区复用工作区审阅 Tab，不覆盖其他工作区", () => {
    useInspector.getState().openAuditTab("E:\\workspace", { scope: "workspace" });

    const first = useInspector.getState();
    const firstTab = first.tabs[0];
    expect(first.activeTabId).toBe(firstTab?.id);
    expect(first.tabs).toHaveLength(1);
    expect(firstTab).toMatchObject({
      type: "audit",
      title: "workspace · 审阅",
      workspacePath: "E:/workspace",
      scope: "workspace",
    });

    useInspector.getState().openAuditTab("E:\\other-workspace", { scope: "workspace" });
    const second = useInspector.getState();
    expect(second.tabs).toHaveLength(2);
    expect(second.tabs[1]).toMatchObject({
      title: "other-workspace · 审阅",
      workspacePath: "E:/other-workspace",
      scope: "workspace",
    });

    useInspector.getState().openAuditTab("E:/workspace/", { scope: "workspace" });
    const reused = useInspector.getState();
    expect(reused.tabs).toHaveLength(2);
    expect(reused.activeTabId).toBe(firstTab?.id);
  });

  it("按工作区和轮次区分审阅 Tab，工作区审阅与轮次审阅可以并存", () => {
    useInspector.getState().openAuditTab("E:/workspace", { scope: "workspace" });
    const workspaceTab = useInspector.getState().tabs[0];
    useInspector.getState().openAuditTab("E:/workspace", {
      scope: "turn",
      turnId: "message-1",
      turnChanges: [],
    });
    useInspector.getState().openAuditTab("E:/workspace", {
      scope: "turn",
      turnId: "message-2",
      turnChanges: [],
    });

    const state = useInspector.getState();
    expect(state.tabs).toHaveLength(3);
    expect(state.tabs.filter((tab) => tab.type === "audit" && tab.scope === "turn")).toHaveLength(2);

    useInspector.getState().openAuditTab("E:/workspace", {
      scope: "turn",
      turnId: "message-1",
      turnChanges: [{
        toolCallId: "tool-1",
        filePath: "src/index.ts",
        operation: "edit",
        additions: 1,
        deletions: 0,
        before: "old",
        after: "new",
      }],
    });
    expect(useInspector.getState().tabs).toHaveLength(3);
    expect(useInspector.getState().tabs.find((tab) => tab.type === "audit" && tab.turnId === "message-1")?.turnChanges).toHaveLength(1);

    expect(workspaceTab?.type).toBe("audit");
    if (workspaceTab) useInspector.getState().closeTab(workspaceTab.id);
    expect(useInspector.getState().tabs).toHaveLength(2);
    useInspector.getState().openAuditTab("E:/workspace", { scope: "workspace" });
    expect(useInspector.getState().tabs.filter((tab) => tab.type === "audit" && tab.scope === "workspace")).toHaveLength(1);
  });

  it("新建会话只激活已有工作区审阅，不创建空 Tab", () => {
    expect(useInspector.getState().activateWorkspaceAudit("E:/workspace")).toBe(false);
    expect(useInspector.getState().tabs).toHaveLength(0);

    useInspector.getState().openAuditTab("E:\\workspace", { scope: "workspace" });
    const tabId = useInspector.getState().tabs[0]?.id;
    useInspector.getState().setActiveTab("missing");
    expect(useInspector.getState().activateWorkspaceAudit("e:/workspace/")).toBe(true);
    expect(useInspector.getState().activeTabId).toBe(tabId);
  });
});
