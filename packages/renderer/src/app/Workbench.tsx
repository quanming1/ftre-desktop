import { useState, useEffect, useCallback, useRef } from "react";
import { TitleBar } from "./TitleBar";
import { StatusBar } from "./StatusBar";
import {
  ActivityBar,
  ACTIVITY_BAR_WIDTH,
} from "@/features/activity-bar/ActivityBar";
import { Sidebar } from "@/features/explorer/Sidebar";
import { EditorArea } from "@/features/editor/EditorArea";
import { pathParent } from "@/utils/pathUtils";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { TerminalDropdown } from "@/features/terminal/TerminalDropdown";
import { AgentChatDropdown } from "@/features/agent-chat/AgentChatDropdown";
import { TaskDropdown } from "@/features/task/TaskDropdown";
import { FilePalette } from "@/components/FilePalette";
import { CommandPalette } from "@/components/CommandPalette";
import { GlobalSearchPalette } from "@/features/global-search/GlobalSearchPalette";
import { NotificationStack } from "@/components/NotificationStack";
import { ResizeHandle } from "@/components/ResizeHandle";
import { useLayout, type PanelId } from "@/stores/layout";
import { useWorkspace } from "@/stores/workspace";
import { useEditor } from "@/stores/editor";
import { useGlobalShortcuts } from "@/lib/shortcuts";
import { registerDefaultShortcuts } from "@/lib/default-shortcuts";
import { globalEventStream } from "@/services/global-event-stream";
import { performanceMetrics } from "@/services/performance-metrics";

export function Workbench() {
  const [filePaletteOpen, setFilePaletteOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Layout store state
  const sidebarWidth = useLayout((s) => s.sidebarWidth);
  const setSidebarWidth = useLayout((s) => s.setSidebarWidth);
  const centerRatio = useLayout((s) => s.centerRatio);
  const setCenterRatio = useLayout((s) => s.setCenterRatio);
  const activeSidebarView = useLayout((s) => s.activeSidebarView);
  const toggleSidebar = useLayout((s) => s.toggleSidebar);
  const panelOrder = useLayout((s) => s.panelOrder);

  const sidebarVisible = activeSidebarView !== null;

  const containerRef = useRef<HTMLDivElement>(null);

  // Register global keyboard shortcut listener
  useGlobalShortcuts();

  // Restore all persisted state on mount
  useEffect(() => {
    async function restoreAll() {
      // 1. Layout (synchronous, from localStorage)
      useLayout.getState().restore();
      // 2. Workspace — restore last opened folder
      await useWorkspace.getState().restore();
      // 3. Editor — restore open files (reads content from disk via IPC)
      await useEditor.getState().restore();
    }
    restoreAll();
  }, []);

  // Register default shortcut bindings on mount
  useEffect(() => {
    registerDefaultShortcuts();
  }, []);

  // 全局 SSE 连接：接收所有 session 的实时事件
  useEffect(() => {
    globalEventStream.connect();
    return () => globalEventStream.disconnect();
  }, []);

  // ── File system watcher: sync external changes ─────────────────────
  const rootPath = useWorkspace((s) => s.rootPath);

  useEffect(() => {
    if (!rootPath) return;

    window.desktop.fs.watch(rootPath);

    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingRefreshes = new Map<string, string | undefined>();

    const flushPendingDirs = () => {
      flushTimer = null;
      for (const [dirPath, changedPath] of pendingRefreshes) {
        window.dispatchEvent(
          new CustomEvent("ftre:tree-refresh", {
            detail: { dirPath, changedPath, source: "watcher" },
          }),
        );
      }
      pendingRefreshes.clear();
    };

    const unsubscribe = window.desktop.fs.onFileChanged(
      (changedPath: string) => {
        performanceMetrics.count("fs.fileChanged.events");

        // `.git` 目录变化只影响 Git 状态，不触发 Explorer 树刷新
        if (/[\\/]\.git([\\/]|$)/.test(changedPath)) {
          return;
        }

        // 仅刷新受影响目录，避免每次文件变更都重新刷新整个 rootPath
        const parentDir = pathParent(changedPath) || rootPath;
        pendingRefreshes.set(parentDir, changedPath);

        // 顶层目录本身发生变化时，parentDir 已等于 rootPath；不再额外重复派发
        if (!flushTimer) {
          flushTimer = setTimeout(flushPendingDirs, 120);
        }

        // 编辑器内容刷新由 EditorArea.tsx 的 onFileChanged 处理，不在此重复
      },
    );

    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      pendingRefreshes.clear();
      window.desktop.fs.unwatch(rootPath);
      unsubscribe();
    };
  }, [rootPath]);

  // Listen for custom events dispatched by shortcut handlers
  useEffect(() => {
    const onToggleFilePalette = () => setFilePaletteOpen((v) => !v);
    const onToggleCommandPalette = () => setCommandPaletteOpen((v) => !v);
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFilePaletteOpen(false);
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("ftre:toggle-file-palette", onToggleFilePalette);
    window.addEventListener(
      "ftre:toggle-command-palette",
      onToggleCommandPalette,
    );
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener(
        "ftre:toggle-file-palette",
        onToggleFilePalette,
      );
      window.removeEventListener(
        "ftre:toggle-command-palette",
        onToggleCommandPalette,
      );
      window.removeEventListener("keydown", onEscape);
    };
  }, []);

  // ── Resize handlers ─────────────────────────────────────────────────

  // Filter visible panels (sidebar hidden when activeSidebarView is null)
  const visiblePanels = panelOrder.filter(
    (id) => id !== "sidebar" || sidebarVisible,
  );

  // Calculate CSS order for each panel based on panelOrder
  const getOrder = (id: PanelId): number => {
    const index = panelOrder.indexOf(id);
    // Each panel + its resize handle = 2 slots, sidebar has no trailing handle when last
    return index * 2;
  };

  // Get resize handle order (between panels)
  const getResizeHandleOrder = (afterPanelId: PanelId): number => {
    const index = panelOrder.indexOf(afterPanelId);
    return index * 2 + 1;
  };

  // Compute flex style for each panel
  // Sidebar uses fixed width (shrink-0), editor and chat share remaining space using centerRatio
  const getPanelStyle = (id: PanelId): React.CSSProperties => {
    if (id === "sidebar") {
      return { width: sidebarWidth, flexShrink: 0, order: getOrder(id) };
    }
    // For editor and chat, use flex-grow with ratio
    // The first non-sidebar panel in visiblePanels gets centerRatio, second gets the rest
    const nonSidebarPanels = visiblePanels.filter((p) => p !== "sidebar");
    const nonSidebarIndex = nonSidebarPanels.indexOf(id);
    if (nonSidebarPanels.length === 1) {
      return { flex: 1, order: getOrder(id) };
    }
    // Use flex-grow to distribute remaining space proportionally
    const flexGrow = nonSidebarIndex === 0 ? centerRatio : 100 - centerRatio;
    return { flex: `${flexGrow} 1 0%`, order: getOrder(id) };
  };

  // Check if a resize handle should be visible
  const isResizeHandleVisible = (afterPanelId: PanelId): boolean => {
    const index = visiblePanels.indexOf(afterPanelId);
    return index >= 0 && index < visiblePanels.length - 1;
  };

  // Resize handler for sidebar
  // Delta direction depends on sidebar position relative to adjacent panel
  const onSidebarResize = useCallback(
    (delta: number) => {
      const sidebarIndex = panelOrder.indexOf("sidebar");
      // If sidebar is not the last panel, dragging right increases width
      // If sidebar is the last panel, dragging left increases width (delta is negative)
      const isLast = sidebarIndex === panelOrder.length - 1;
      const adjustedDelta = isLast ? -delta : delta;
      setSidebarWidth(
        Math.max(140, Math.min(400, sidebarWidth + adjustedDelta)),
      );
    },
    [setSidebarWidth, sidebarWidth, panelOrder],
  );

  // Resize handler for editor/chat divider
  // The first non-sidebar panel gets centerRatio, so dragging affects it
  const onCenterResize = useCallback(
    (delta: number) => {
      const container = containerRef.current;
      if (!container) return;
      // Available width = container width minus activitybar minus sidebar
      const activityBarWidth = ACTIVITY_BAR_WIDTH;
      const sidebarW = sidebarVisible ? sidebarWidth : 0;
      const availableWidth =
        container.offsetWidth - activityBarWidth - sidebarW;
      if (availableWidth <= 0) return;
      // Convert pixel delta to ratio delta
      const ratioDelta = (delta / availableWidth) * 100;

      // Find which panel is "first" (gets centerRatio) among editor/chat in current order
      const nonSidebarPanels = visiblePanels.filter((p) => p !== "sidebar");
      const firstPanel = nonSidebarPanels[0];

      // If first panel is to the LEFT of the resize handle, dragging right increases its ratio
      // The resize handle is after the first panel, so positive delta = increase ratio
      // But we need to check if editor or chat is first and adjust accordingly
      const editorIndex = panelOrder.indexOf("editor");
      const chatIndex = panelOrder.indexOf("chat");

      // If editor comes before chat, dragging right increases editor (centerRatio)
      // If chat comes before editor, dragging right increases chat, which means decreasing centerRatio
      if (firstPanel === "editor") {
        setCenterRatio(Math.max(10, Math.min(90, centerRatio + ratioDelta)));
      } else {
        // Chat is first, so centerRatio represents chat's width
        // Dragging right increases chat = increases centerRatio
        setCenterRatio(Math.max(10, Math.min(90, centerRatio + ratioDelta)));
      }
    },
    [
      setCenterRatio,
      centerRatio,
      sidebarVisible,
      sidebarWidth,
      visiblePanels,
      panelOrder,
    ],
  );

  // Determine which resize handler to use based on adjacent panels
  const getResizeHandler = (afterPanelId: PanelId) => {
    const index = panelOrder.indexOf(afterPanelId);
    const nextPanelId = panelOrder[index + 1];
    if (afterPanelId === "sidebar" || nextPanelId === "sidebar") {
      return onSidebarResize;
    }
    return onCenterResize;
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-base overflow-hidden">
      <TitleBar />

      {/* Main area - use CSS order to control panel arrangement without remounting */}
      <div className="flex-1 flex overflow-hidden" ref={containerRef}>
        {/* Activity Bar - always first */}
        <ActivityBar />

        {/* Sidebar Panel */}
        {sidebarVisible && (
          <div
            className="h-full overflow-hidden"
            style={getPanelStyle("sidebar")}
          >
            <Sidebar />
          </div>
        )}
        {sidebarVisible && isResizeHandleVisible("sidebar") && (
          <div
            className="h-full"
            style={{ order: getResizeHandleOrder("sidebar") }}
          >
            <ResizeHandle
              direction="horizontal"
              onResize={getResizeHandler("sidebar")}
            />
          </div>
        )}

        {/* Editor Panel - always mounted, never remounted on reorder */}
        <div
          className="h-full flex flex-col overflow-hidden"
          style={getPanelStyle("editor")}
        >
          <div className="flex-1 overflow-hidden">
            <EditorArea onToggleFiles={toggleSidebar} />
          </div>
        </div>
        {isResizeHandleVisible("editor") && (
          <div
            className="h-full"
            style={{ order: getResizeHandleOrder("editor") }}
          >
            <ResizeHandle
              direction="horizontal"
              onResize={getResizeHandler("editor")}
            />
          </div>
        )}

        {/* Chat Panel - always mounted, never remounted on reorder */}
        <div className="h-full overflow-hidden" style={getPanelStyle("chat")}>
          <ChatPanel key={rootPath} />
        </div>
        {isResizeHandleVisible("chat") && (
          <div
            className="h-full"
            style={{ order: getResizeHandleOrder("chat") }}
          >
            <ResizeHandle
              direction="horizontal"
              onResize={getResizeHandler("chat")}
            />
          </div>
        )}
      </div>

      <StatusBar />

      {/* 终端下拉弹窗 — 始终挂载，CSS 控制显隐 */}
      <TerminalDropdown />

      {/* Agent 群聊弹窗 — 始终挂载，CSS 控制显隐 */}
      <AgentChatDropdown />

      {/* 任务监控弹窗 — 始终挂载，CSS 控制显隐 */}
      <TaskDropdown />

      <FilePalette
        open={filePaletteOpen}
        onClose={() => setFilePaletteOpen(false)}
      />
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
      <GlobalSearchPalette />
      <NotificationStack />
    </div>
  );
}
