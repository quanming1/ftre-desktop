import { useState, useEffect, useCallback, useRef } from "react";
import { ErrorBoundary } from "@ftre/ui";
import { TitleBar } from "./TitleBar";
import { ActivityBar } from "./ActivityBar";
import { Sidebar } from "@/features/explorer/Sidebar";
import { EditorArea } from "@/features/editor/EditorArea";
import { pathParent } from "@/utils/pathUtils";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { SessionPanel } from "@/features/session/SessionPanel";
import { TerminalDropdown } from "@/features/terminal/TerminalDropdown";
import { AgentChatDropdown } from "@/features/agent-chat/AgentChatDropdown";
import { TaskDropdown } from "@/features/task/TaskDropdown";
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { FilePalette } from "@/components/FilePalette";
import { CommandPalette } from "@/components/CommandPalette";
import { GlobalSearchPalette } from "@/features/global-search/GlobalSearchPalette";
import { Toaster } from "sonner";
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
  const sessionsWidth = useLayout((s) => s.sessionsWidth);
  const setSessionsWidth = useLayout((s) => s.setSessionsWidth);
  const centerRatio = useLayout((s) => s.centerRatio);
  const setCenterRatio = useLayout((s) => s.setCenterRatio);
  const activeSidebarView = useLayout((s) => s.activeSidebarView);
  const panelOrder = useLayout((s) => s.panelOrder);
  const panelVisible = useLayout((s) => s.panelVisible);
  const activeLeftPanel = useLayout((s) => s.activeLeftPanel);

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

  // Filter visible panels based on panelVisible state
  const visiblePanels = panelOrder.filter((id) => panelVisible[id]);

  // Calculate CSS order for each panel based on panelOrder
  const getOrder = (id: PanelId): number => {
    const index = panelOrder.indexOf(id);
    // Each panel + its resize handle = 2 slots
    return index * 2;
  };

  // Get resize handle order (between panels)
  const getResizeHandleOrder = (afterPanelId: PanelId): number => {
    const index = panelOrder.indexOf(afterPanelId);
    return index * 2 + 1;
  };

  // Compute flex style for each panel
  // sessions and sidebar use fixed width, editor and chat share remaining space
  const getPanelStyle = (id: PanelId): React.CSSProperties => {
    if (id === "sessions") {
      return { width: sessionsWidth, flexShrink: 0, order: getOrder(id) };
    }
    if (id === "sidebar") {
      return { width: sidebarWidth, flexShrink: 0, order: getOrder(id) };
    }
    // For editor and chat, use flex-grow with ratio
    const flexPanels = visiblePanels.filter(
      (p) => p !== "sidebar" && p !== "sessions",
    );
    const flexIndex = flexPanels.indexOf(id);
    if (flexPanels.length === 1) {
      return { flex: 1, order: getOrder(id) };
    }
    // Use flex-grow to distribute remaining space proportionally
    const flexGrow = flexIndex === 0 ? centerRatio : 100 - centerRatio;
    return { flex: `${flexGrow} 1 0%`, order: getOrder(id) };
  };

  // Check if a resize handle should be visible
  const isResizeHandleVisible = (afterPanelId: PanelId): boolean => {
    const index = visiblePanels.indexOf(afterPanelId);
    return index >= 0 && index < visiblePanels.length - 1;
  };

  // Create resize handler for fixed-width panels (sessions, sidebar)
  // The resize handle is placed AFTER afterPanelId, so:
  // - If the target panel === afterPanelId, it's on the LEFT of the handle -> delta positive = grow
  // - If the target panel === nextPanelId, it's on the RIGHT of the handle -> delta positive = shrink
  const createFixedPanelResizeHandler = useCallback(
    (targetPanel: "sessions" | "sidebar", afterPanelId: PanelId) => {
      return (delta: number) => {
        // Read current width from store at call time, not at creation time
        const state = useLayout.getState();
        const currentWidth =
          targetPanel === "sessions" ? state.sessionsWidth : state.sidebarWidth;
        const setWidth =
          targetPanel === "sessions"
            ? state.setSessionsWidth
            : state.setSidebarWidth;

        const currentOrder = state.panelOrder;
        const index = currentOrder.indexOf(afterPanelId);
        const nextPanelId = currentOrder[index + 1];
        // If target panel is on the RIGHT of the handle, reverse delta
        const adjustedDelta = nextPanelId === targetPanel ? -delta : delta;
        setWidth(Math.max(140, Math.min(400, currentWidth + adjustedDelta)));
      };
    },
    [], // No dependencies - reads from store at call time
  );

  // Resize handler for editor/chat divider
  const createCenterResizeHandler = useCallback(
    (afterPanelId: PanelId) => {
      return (delta: number) => {
        const container = containerRef.current;
        if (!container) return;

        // Read current state from store at call time
        const state = useLayout.getState();
        const {
          panelVisible: pv,
          sessionsWidth: sw,
          sidebarWidth: sbw,
          centerRatio: cr,
          panelOrder: po,
        } = state;

        // Available width = container width minus fixed panels
        const sessionsW = pv.sessions ? sw : 0;
        const sidebarW = pv.sidebar ? sbw : 0;
        const availableWidth = container.offsetWidth - sessionsW - sidebarW;
        if (availableWidth <= 0) return;
        // Convert pixel delta to ratio delta
        const ratioDelta = (delta / availableWidth) * 100;

        // centerRatio is assigned to the FIRST flex panel
        const visiblePs = po.filter((id) => pv[id]);
        const flexPanels = visiblePs.filter(
          (p) => p !== "sidebar" && p !== "sessions",
        );
        const firstPanel = flexPanels[0];

        // If afterPanelId === firstPanel, dragging right increases firstPanel
        // If afterPanelId !== firstPanel, it means firstPanel is on the right, reverse
        const adjustedRatioDelta =
          afterPanelId === firstPanel ? ratioDelta : -ratioDelta;
        state.setCenterRatio(
          Math.max(10, Math.min(90, cr + adjustedRatioDelta)),
        );
      };
    },
    [], // No dependencies - reads from store at call time
  );

  // Determine which resize handler to use based on adjacent panels
  const getResizeHandler = (afterPanelId: PanelId) => {
    const index = panelOrder.indexOf(afterPanelId);
    const nextPanelId = panelOrder[index + 1];
    if (afterPanelId === "sessions" || nextPanelId === "sessions") {
      return createFixedPanelResizeHandler("sessions", afterPanelId);
    }
    if (afterPanelId === "sidebar" || nextPanelId === "sidebar") {
      return createFixedPanelResizeHandler("sidebar", afterPanelId);
    }
    return createCenterResizeHandler(afterPanelId);
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-base overflow-hidden">
      <TitleBar />

      {/* Main area - use CSS order to control panel arrangement without remounting */}
      <div className="flex-1 flex overflow-hidden" ref={containerRef}>
        <ActivityBar />

        {/* Settings 模式：独占整个右侧区域 */}
        {activeLeftPanel === "settings" && (
          <div className="flex-1 h-full overflow-hidden">
            <ErrorBoundary>
              <SettingsPanel />
            </ErrorBoundary>
          </div>
        )}

        {/* Chat 模式：正常显示 Sessions Panel */}
        {activeLeftPanel === "chat" && panelVisible.sessions && (
          <div
            className="h-full overflow-hidden"
            style={getPanelStyle("sessions")}
          >
            <ErrorBoundary>
              <SessionPanel />
            </ErrorBoundary>
          </div>
        )}
        {activeLeftPanel === "chat" &&
          panelVisible.sessions &&
          isResizeHandleVisible("sessions") && (
            <div
              className="h-full shrink-0"
              style={{ order: getResizeHandleOrder("sessions") }}
            >
              <ResizeHandle
                direction="horizontal"
                onResize={getResizeHandler("sessions")}
              />
            </div>
          )}

        {/* Sidebar Panel - 只在 chat 模式显示 */}
        {activeLeftPanel === "chat" && panelVisible.sidebar && (
          <div
            className="h-full overflow-hidden"
            style={getPanelStyle("sidebar")}
          >
            <ErrorBoundary>
              <Sidebar />
            </ErrorBoundary>
          </div>
        )}
        {activeLeftPanel === "chat" &&
          panelVisible.sidebar &&
          isResizeHandleVisible("sidebar") && (
            <div
              className="h-full shrink-0"
              style={{ order: getResizeHandleOrder("sidebar") }}
            >
              <ResizeHandle
                direction="horizontal"
                onResize={getResizeHandler("sidebar")}
              />
            </div>
          )}

        {/* Editor Panel - 只在 chat 模式显示 */}
        {activeLeftPanel === "chat" && panelVisible.editor && (
          <div
            className="h-full flex flex-col overflow-hidden"
            style={getPanelStyle("editor")}
          >
            <div className="flex-1 overflow-hidden">
              <ErrorBoundary>
                <EditorArea />
              </ErrorBoundary>
            </div>
          </div>
        )}
        {activeLeftPanel === "chat" &&
          panelVisible.editor &&
          isResizeHandleVisible("editor") && (
            <div
              className="h-full shrink-0"
              style={{ order: getResizeHandleOrder("editor") }}
            >
              <ResizeHandle
                direction="horizontal"
                onResize={getResizeHandler("editor")}
              />
            </div>
          )}

        {/* Chat Panel */}
        {panelVisible.chat && activeLeftPanel === "chat" && (
          <div className="h-full overflow-hidden" style={getPanelStyle("chat")}>
            <ErrorBoundary>
              <ChatPanel key={rootPath} />
            </ErrorBoundary>
          </div>
        )}
        {panelVisible.chat &&
          activeLeftPanel === "chat" &&
          isResizeHandleVisible("chat") && (
            <div
              className="h-full shrink-0"
              style={{ order: getResizeHandleOrder("chat") }}
            >
              <ResizeHandle
                direction="horizontal"
                onResize={getResizeHandler("chat")}
              />
            </div>
          )}
      </div>

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
      <Toaster
        position="bottom-left"
        theme="dark"
        richColors
        closeButton
        expand={false}
        style={{ fontFamily: "var(--font-sans)" }}
      />
    </div>
  );
}
