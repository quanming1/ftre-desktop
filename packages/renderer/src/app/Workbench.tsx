import { useState, useEffect, useCallback, useRef } from "react";
import { ErrorBoundary, ResizeHandle } from "@ftre/ui";
import { TitleBar } from "./TitleBar";
import { pathParent } from "@/utils/pathUtils";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { SessionPanel } from "@/features/session/SessionPanel";
import { SkillsPanel } from "@/features/skills/SkillsPanel";
import { ScheduledTaskPanel } from "@/features/task/ScheduledTaskPanel";
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { InspectorPanel } from "@/features/inspector/InspectorPanel";
import { FilePalette } from "@/components/FilePalette";
import { CommandPalette } from "@/components/CommandPalette";
import { GlobalSearchPalette } from "@/features/global-search/GlobalSearchPalette";
import { Toaster } from "sonner";
import { useLayout, type PanelId, INSPECTOR_WIDTH_MIN, INSPECTOR_WIDTH_MAX } from "@/stores/layout";
import { useWorkspace } from "@/stores/workspace";
import { useEditor } from "@/stores/editor";
import { useChat } from "@/stores/chat";
import { useTheme } from "@/stores/theme";
import { useGlobalShortcuts } from "@/lib/shortcuts";
import { registerDefaultShortcuts } from "@/lib/default-shortcuts";
import { globalEventStream } from "@/services/global-event-stream";
import { performanceMetrics } from "@/services/performance-metrics";

function GlassGutter({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none shrink-0 bg-surface/75 backdrop-blur-xl backdrop-saturate-150 ${className}`}
    />
  );
}

export function Workbench() {
  const [filePaletteOpen, setFilePaletteOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const resolvedMode = useTheme((s) => s.resolvedMode);

  // Layout store state
  const sessionsWidth = useLayout((s) => s.sessionsWidth);
  const setSessionsWidth = useLayout((s) => s.setSessionsWidth);
  const sessionsCollapsed = useLayout((s) => s.sessionsCollapsed);
  const centerRatio = useLayout((s) => s.centerRatio);
  const inspectorWidth = useLayout((s) => s.inspectorWidth);
  const setCenterRatio = useLayout((s) => s.setCenterRatio);
  const panelOrder = useLayout((s) => s.panelOrder);
  const panelVisible = useLayout((s) => s.panelVisible);
  const activeLeftPanel = useLayout((s) => s.activeLeftPanel);

  const containerRef = useRef<HTMLDivElement>(null);

  // ── Live resize: drag directly manipulates DOM width, commit to store on release ──
  // 拖动期间不更新 store 也不触发 React 重渲染，直接改 DOM style.width；
  // 松手时一次性把最终宽度写回 store。chat 是 flex:1，自动跟随填充。
  // transition/will-change 也通过直接 DOM 操作控制，避免 setResizing 触发整树重渲染。
  const sessionsRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<
    { target: "sessions" | "inspector"; currentWidth: number } | null
  >(null);

  const startLiveDrag = useCallback(
    (target: "sessions" | "inspector") => {
      const state = useLayout.getState();
      dragStateRef.current = {
        target,
        currentWidth:
          target === "sessions" ? state.sessionsWidth : state.inspectorWidth,
      };
      // 直接操作 DOM：关闭过渡动画 + 提示浏览器为 width 变化预创建合成层
      const ref = target === "sessions" ? sessionsRef : inspectorRef;
      if (ref.current) {
        ref.current.style.transition = "none";
        ref.current.style.willChange = "width";
      }
    },
    [],
  );

  const endLiveDrag = useCallback(() => {
    const drag = dragStateRef.current;
    if (drag) {
      const ref = drag.target === "sessions" ? sessionsRef : inspectorRef;
      if (ref.current) {
        ref.current.style.transition = "";
        ref.current.style.willChange = "";
      }
      if (drag.target === "sessions") {
        useLayout.getState().setSessionsWidth(drag.currentWidth);
      } else {
        useLayout.getState().setInspectorWidth(drag.currentWidth);
      }
      dragStateRef.current = null;
    }
  }, []);

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

  // Register default shortcut bindings + preload default workspace
  useEffect(() => {
    registerDefaultShortcuts();
    useChat.getState().initDefaultWorkspace();
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
  // sessions uses fixed width; chat and inspector share the remaining space
  // transition 恒为 "width 160ms ease"（折叠/展开动画）；拖动时由 startLiveDrag 直接操作 DOM 覆盖为 none
  // contain: layout 隔离面板间 reflow 传播（chat 内消息列表 DOM 最多，隔离收益最大）
  const getPanelStyle = (id: PanelId): React.CSSProperties => {
    if (id === "sessions") {
      return {
        width: sessionsCollapsed ? 48 : sessionsWidth,
        flexShrink: 0,
        order: getOrder(id),
        transition: "width 160ms ease",
        contain: "layout",
      };
    }
    if (id === "inspector") {
      return {
        width: inspectorWidth,
        flexShrink: 0,
        order: getOrder(id),
        transition: "width 160ms ease",
        contain: "layout",
      };
    }
    // For editor and chat, use flex-grow with ratio
    const flexPanels = visiblePanels.filter((p) => p !== "sessions");
    const flexIndex = flexPanels.indexOf(id);
    if (flexPanels.length === 1) {
      return { flex: 1, order: getOrder(id), contain: "layout" };
    }
    // Use flex-grow to distribute remaining space proportionally
    const flexGrow = flexIndex === 0 ? centerRatio : 100 - centerRatio;
    return { flex: `${flexGrow} 1 0%`, order: getOrder(id), contain: "layout" };
  };

  // Check if a resize handle should be visible
  const isResizeHandleVisible = (afterPanelId: PanelId): boolean => {
    if (sessionsCollapsed && afterPanelId === "sessions") return false;
    const index = visiblePanels.indexOf(afterPanelId);
    return index >= 0 && index < visiblePanels.length - 1;
  };

  // Create resize handler for fixed-width panels (sessions, inspector)
  // The resize handle is placed AFTER afterPanelId, so:
  // - If the target panel === afterPanelId, it's on the LEFT of the handle -> delta positive = grow
  // - If the target panel === nextPanelId, it's on the RIGHT of the handle -> delta positive = shrink
  const createFixedPanelResizeHandler = useCallback(
    (targetPanel: "sessions" | "inspector", afterPanelId: PanelId) => {
      return (delta: number): number => {
        const state = useLayout.getState();
        const drag = dragStateRef.current;
        const isLiveDrag = drag?.target === targetPanel;

        // Live drag 时从 dragState 取实时宽度（store 未更新），否则从 store 取
        const currentWidth = isLiveDrag
          ? drag.currentWidth
          : targetPanel === "sessions" ? state.sessionsWidth : state.inspectorWidth;
        const setWidth =
          targetPanel === "sessions" ? state.setSessionsWidth : state.setInspectorWidth;

        const currentOrder = state.panelOrder;
        const index = currentOrder.indexOf(afterPanelId);
        const nextPanelId = currentOrder[index + 1];
        const reverse = nextPanelId === targetPanel;
        const adjustedDelta = reverse ? -delta : delta;
        const clampedWidth = Math.max(
            targetPanel === "inspector" ? INSPECTOR_WIDTH_MIN : 140,
          Math.min(
            targetPanel === "inspector" ? INSPECTOR_WIDTH_MAX : 400,
            currentWidth + adjustedDelta,
          ),
        );
        const appliedAdjusted = clampedWidth - currentWidth;

        if (isLiveDrag) {
          // 拖动期间直接操作 DOM，不触发 React 重渲染
          drag.currentWidth = clampedWidth;
          const ref =
            targetPanel === "sessions" ? sessionsRef : inspectorRef;
          if (ref.current) {
            ref.current.style.width = `${clampedWidth}px`;
          }
        } else {
          // 非拖动场景走 store 更新
          setWidth(clampedWidth);
        }
        return reverse ? -appliedAdjusted : appliedAdjusted;
      };
    },
    [],
  );

  // Resize handler for editor/chat divider
  const createCenterResizeHandler = useCallback(
    (afterPanelId: PanelId) => {
      return (delta: number): number => {
        const container = containerRef.current;
        if (!container) return 0;

        // Read current state from store at call time
        const state = useLayout.getState();
        const {
          panelVisible: pv,
          sessionsWidth: sw,
          centerRatio: cr,
          panelOrder: po,
        } = state;

        // Available width = container width minus fixed panels
        const sessionsW = pv.sessions ? sw : 0;
        const availableWidth = container.offsetWidth - sessionsW;
        if (availableWidth <= 0) return 0;
        // Convert pixel delta to ratio delta
        const ratioDelta = (delta / availableWidth) * 100;

        // centerRatio is assigned to the FIRST flex panel
        const visiblePs = po.filter((id) => pv[id]);
        const flexPanels = visiblePs.filter((p) => p !== "sessions");
        const firstPanel = flexPanels[0];

        // If afterPanelId === firstPanel, dragging right increases firstPanel
        // If afterPanelId !== firstPanel, it means firstPanel is on the right, reverse
        const reverse = afterPanelId !== firstPanel;
        const adjustedRatioDelta = reverse ? -ratioDelta : ratioDelta;
        const clampedRatio = Math.max(10, Math.min(90, cr + adjustedRatioDelta));
        const appliedRatio = clampedRatio - cr;
        state.setCenterRatio(clampedRatio);
        const appliedAdjusted = (appliedRatio * availableWidth) / 100;
        return reverse ? -appliedAdjusted : appliedAdjusted;
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
    if (afterPanelId === "inspector" || nextPanelId === "inspector") {
      return createFixedPanelResizeHandler("inspector", afterPanelId);
    }
    return createCenterResizeHandler(afterPanelId);
  };

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{
        background: [
          "radial-gradient(circle at 4% 0%, color-mix(in srgb, var(--ftre-status-info) 18%, transparent), transparent 42%)",
          "radial-gradient(circle at 72% 8%, color-mix(in srgb, var(--ftre-accent-default) 7%, transparent), transparent 38%)",
          "radial-gradient(circle at 96% 100%, color-mix(in srgb, var(--ftre-status-error) 8%, transparent), transparent 48%)",
          "var(--ftre-bg-workbench)",
        ].join(", "),
      }}
    >
      <TitleBar />

      {/* Main area - use CSS order to control panel arrangement without remounting */}
      <div className="flex-1 flex overflow-hidden" ref={containerRef}>
        {/* Content area with rounded top-left corner */}
        <div className="flex-1 flex overflow-hidden bg-transparent">

        {activeLeftPanel === "settings" ? (
          /* Settings 模式：SettingsPanel 完全接管左侧 SessionPanel + 右侧区域 */
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            <GlassGutter className="h-1" />
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <GlassGutter className="w-1.5" />
              <div className="relative min-w-0 flex-1 overflow-hidden bg-surface/75 backdrop-blur-xl backdrop-saturate-150">
                <div className="relative z-10 h-full overflow-hidden rounded-xl bg-surface">
                  <ErrorBoundary>
                    <SettingsPanel />
                  </ErrorBoundary>
                </div>
              </div>
              <GlassGutter className="w-1.5" />
            </div>
            <GlassGutter className="h-1" />
          </div>
        ) : (
        <>
        {/* Sessions Panel — 在所有模式下保持挂载（顶部内化了模式切换） */}
        {panelVisible.sessions && (
          <div
            ref={sessionsRef}
            className="flex h-full flex-col overflow-hidden"
            style={getPanelStyle("sessions")}
          >
            <GlassGutter className="h-1" />
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <GlassGutter className="w-1.5" />
              <div className="min-w-0 flex-1 overflow-hidden bg-surface/75 backdrop-blur-xl backdrop-saturate-150">
                <ErrorBoundary>
                  <SessionPanel />
                </ErrorBoundary>
              </div>
            </div>
            <GlassGutter className="h-1" />
          </div>
        )}
        {panelVisible.sessions &&
          isResizeHandleVisible("sessions") && (
            <div
              className="relative z-20 h-full w-0 shrink-0"
              style={{ order: getResizeHandleOrder("sessions") }}
            >
              <ResizeHandle
                direction="horizontal"
                className="absolute left-0 top-0 z-20 h-full w-2.5 -translate-x-1/2"
                onResize={getResizeHandler("sessions")}
                onResizeStart={() => startLiveDrag("sessions")}
                onResizeEnd={() => endLiveDrag()}
              />
            </div>
          )}

        {/* Skills 模式：占满 SessionPanel 右侧的所有空间 */}
        {activeLeftPanel === "skills" && (
          <div
            className="flex h-full flex-1 flex-col overflow-hidden"
            style={{ order: 999 }}
          >
            <GlassGutter className="h-1" />
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="min-w-0 flex-1 overflow-hidden rounded-xl bg-surface">
                <ErrorBoundary>
                  <SkillsPanel />
                </ErrorBoundary>
              </div>
              <GlassGutter className="w-1.5" />
            </div>
            <GlassGutter className="h-1" />
          </div>
        )}

        {/* Cron 模式：占满 SessionPanel 右侧的所有空间 */}
        {activeLeftPanel === "cron" && (
          <div
            className="flex h-full flex-1 flex-col overflow-hidden"
            style={{ order: 999 }}
          >
            <GlassGutter className="h-1" />
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="min-w-0 flex-1 overflow-hidden rounded-xl bg-surface">
                <ErrorBoundary>
                  <ScheduledTaskPanel />
                </ErrorBoundary>
              </div>
              <GlassGutter className="w-1.5" />
            </div>
            <GlassGutter className="h-1" />
          </div>
        )}

        {/* Chat Panel */}
        {panelVisible.chat && activeLeftPanel === "chat" && (
          <div
            className="flex h-full flex-col overflow-hidden"
            style={getPanelStyle("chat")}
          >
            <GlassGutter className="h-1" />
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="relative min-w-0 flex-1 overflow-hidden bg-surface/75 backdrop-blur-xl backdrop-saturate-150">
                <div className="relative z-10 h-full overflow-hidden rounded-l-xl bg-surface">
                  <ErrorBoundary>
                    <ChatPanel key={rootPath} />
                  </ErrorBoundary>
                </div>
              </div>
              {!panelVisible.inspector && <GlassGutter className="w-1.5" />}
            </div>
            <GlassGutter className="h-1" />
          </div>
        )}
        {panelVisible.chat &&
          activeLeftPanel === "chat" &&
          isResizeHandleVisible("chat") && (
            <div
              className="relative z-20 h-full w-0 shrink-0"
              style={{ order: getResizeHandleOrder("chat") }}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-0 z-10 h-full w-px bg-border-subtle/70"
              />
              <ResizeHandle
                direction="horizontal"
                className="absolute left-0 top-0 z-20 h-full w-2.5 -translate-x-1/2"
                onResize={getResizeHandler("chat")}
                onResizeStart={() => startLiveDrag("inspector")}
                onResizeEnd={() => endLiveDrag()}
              />
            </div>
          )}

        {/* Inspector Panel — 右侧扩展面板（CSS 隐藏，不销毁组件，保持文件树状态） */}
        <div
          ref={inspectorRef}
          className="flex h-full flex-col overflow-hidden"
          style={
            (panelVisible.inspector && activeLeftPanel === "chat")
              ? getPanelStyle("inspector")
              : { width: 0, minWidth: 0, maxWidth: 0, opacity: 0, overflow: "hidden" }
          }
        >
          <GlassGutter className="h-1" />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="min-w-0 flex-1 overflow-hidden rounded-none bg-surface">
              <ErrorBoundary>
                <InspectorPanel />
              </ErrorBoundary>
            </div>
            <GlassGutter className="w-1.5" />
          </div>
          <GlassGutter className="h-1" />
        </div>
        {panelVisible.inspector &&
          activeLeftPanel === "chat" &&
          isResizeHandleVisible("inspector") && (
            <div
              className="h-full shrink-0"
              style={{ order: getResizeHandleOrder("inspector") }}
            >
              <ResizeHandle
                direction="horizontal"
                onResize={getResizeHandler("inspector")}
                onResizeStart={() => startLiveDrag("inspector")}
                onResizeEnd={() => endLiveDrag()}
              />
            </div>
          )}
        </>
        )}
        </div>
      </div>

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
        theme={resolvedMode}
        closeButton
        expand={false}
        style={{
          fontFamily: "var(--font-sans)",
          background: "var(--ftre-bg-elevated, #1a1b1d)",
          border: "1px solid var(--ftre-border-default, #3c3c3c)",
          color: "var(--ftre-text-primary, #e8e8e8)",
        }}
        toastOptions={{
          style: {
            background: "var(--ftre-bg-elevated, #1a1b1d)",
            border: "1px solid var(--ftre-border-default, #3c3c3c)",
            color: "var(--ftre-text-primary, #e8e8e8)",
          },
        }}
      />
    </div>
  );
}
