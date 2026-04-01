import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { TitleBar } from "./TitleBar";
import { StatusBar } from "./StatusBar";
import { ActivityBar, ACTIVITY_BAR_WIDTH } from "@/features/activity-bar/ActivityBar";
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

    const unsubscribe = window.desktop.fs.onFileChanged((changedPath: string) => {
      // 刷新文件树（通知 ExplorerView 重新加载受影响的目录）
      const parentDir = pathParent(changedPath) || rootPath;
      window.dispatchEvent(new CustomEvent("ftre:tree-refresh", { detail: { dirPath: parentDir } }));
      window.dispatchEvent(new CustomEvent("ftre:tree-refresh", { detail: { dirPath: rootPath } }));

      // 编辑器内容刷新由 EditorArea.tsx 的 onFileChanged 处理，不在此重复
    });

    return () => {
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
    window.addEventListener("ftre:toggle-command-palette", onToggleCommandPalette);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("ftre:toggle-file-palette", onToggleFilePalette);
      window.removeEventListener("ftre:toggle-command-palette", onToggleCommandPalette);
      window.removeEventListener("keydown", onEscape);
    };
  }, []);

  // ── Resize handlers ─────────────────────────────────────────────────

  // Filter visible panels (sidebar hidden when activeSidebarView is null)
  const visiblePanels = panelOrder.filter((id) => id !== 'sidebar' || sidebarVisible);

  // Compute width for each panel
  // Sidebar uses fixed width, editor and chat share remaining space using centerRatio
  const getPanelWidth = (id: PanelId, index: number): string => {
    if (id === 'sidebar') {
      return `${sidebarWidth}px`;
    }
    // For editor and chat, use flex percentages
    // The first non-sidebar panel gets centerRatio%, second gets the rest
    const nonSidebarPanels = visiblePanels.filter((p) => p !== 'sidebar');
    const nonSidebarIndex = nonSidebarPanels.indexOf(id);
    if (nonSidebarPanels.length === 1) {
      return '100%';
    }
    if (nonSidebarIndex === 0) {
      return `${centerRatio}%`;
    }
    return `${100 - centerRatio}%`;
  };

  // Resize handler for sidebar
  const onSidebarResize = useCallback(
    (delta: number) => {
      setSidebarWidth(Math.max(140, Math.min(400, sidebarWidth + delta)));
    },
    [setSidebarWidth, sidebarWidth],
  );

  // Resize handler for editor/chat divider
  const onCenterResize = useCallback(
    (delta: number) => {
      const container = containerRef.current;
      if (!container) return;
      // Available width = container width minus activitybar minus sidebar
      const activityBarWidth = ACTIVITY_BAR_WIDTH;
      const sidebarW = sidebarVisible ? sidebarWidth : 0;
      const availableWidth = container.offsetWidth - activityBarWidth - sidebarW;
      if (availableWidth <= 0) return;
      // Convert pixel delta to ratio delta
      const ratioDelta = (delta / availableWidth) * 100;
      setCenterRatio(centerRatio + ratioDelta);
    },
    [setCenterRatio, centerRatio, sidebarVisible, sidebarWidth],
  );

  // Determine which resize handler to use based on panels
  const getResizeHandler = (leftPanelId: PanelId, rightPanelId: PanelId) => {
    if (leftPanelId === 'sidebar' || rightPanelId === 'sidebar') {
      return onSidebarResize;
    }
    return onCenterResize;
  };

  // ── Panel rendering ─────────────────────────────────────────────────

  const renderPanel = (id: PanelId, width: string) => {
    switch (id) {
      case 'sidebar':
        return (
          <div className="shrink-0 h-full overflow-hidden" style={{ width }}>
            <Sidebar />
          </div>
        );
      case 'editor':
        return (
          <div className="h-full flex flex-col overflow-hidden" style={{ width }}>
            <div className="flex-1 overflow-hidden">
              <EditorArea onToggleFiles={toggleSidebar} />
            </div>
          </div>
        );
      case 'chat':
        return (
          <div className="h-full overflow-hidden" style={{ width }}>
            <ChatPanel key={rootPath} />
          </div>
        );
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-base overflow-hidden">
      <TitleBar />

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden" ref={containerRef}>
        {/* Activity Bar */}
        <ActivityBar />

        {/* Panels rendered in order */}
        {visiblePanels.map((id, index) => {
          const width = getPanelWidth(id, index);
          const isLast = index === visiblePanels.length - 1;
          const nextPanelId = visiblePanels[index + 1];

          return (
            <Fragment key={id}>
              {renderPanel(id, width)}
              {!isLast && (
                <ResizeHandle
                  direction="horizontal"
                  onResize={getResizeHandler(id, nextPanelId)}
                />
              )}
            </Fragment>
          );
        })}
      </div>

      <StatusBar />

      {/* 终端下拉弹窗 — 始终挂载，CSS 控制显隐 */}
      <TerminalDropdown />

      {/* Agent 群聊弹窗 — 始终挂载，CSS 控制显隐 */}
      <AgentChatDropdown />

      {/* 任务监控弹窗 — 始终挂载，CSS 控制显隐 */}
      <TaskDropdown />

      <FilePalette open={filePaletteOpen} onClose={() => setFilePaletteOpen(false)} />
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
      <GlobalSearchPalette />
      <NotificationStack />
    </div>
  );
}
