/**
 * InspectorPanel — 右侧扩展面板（编辑器风格）
 *
 * Tab 渲染通过 tabRegistry 分发，新增 tab 类型只需注册 renderer。
 */
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  memo,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Activity, X, FileText, Braces, ChevronDown, Folder, FolderOpen, ScrollText, Plus, TerminalSquare, Trash2, ClipboardCheck } from "lucide-react";
import { GitCompareArrows } from "lucide-react";
import { OverlayScrollbarsComponent, type OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ErrorBoundary,
} from "@ftre/ui";
import {
  INSPECTOR_SESSION_STATE_TAB_ID,
  INSPECTOR_TRACE_TAB_ID,
  INSPECTOR_WS_LOG_TAB_ID,
  useInspector,
  type InspectorTab,
} from "@/stores/inspector";
import { useWorkspace } from "@/stores/workspace";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { terminalManager } from "@/services/terminal";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { ResizeHandle } from "@/components/ResizeHandle";
import { useLayout, FILE_TREE_WIDTH_MIN, FILE_TREE_WIDTH_MAX } from "@/stores/layout";
import { FileTreeSidebar } from "./FileTreeSidebar";
import { FileIconView } from "@/components/FileIconView";
import { getTabMeta } from "./tabRegistry";
import { useRipple, RippleLayer } from "@/components/Ripple";
import { useSmoothTabReorder, compareByMountOrder } from "./useSmoothTabReorder";
import { SessionStateRenderer } from "./SessionStateRenderer";
import { TracePanel } from "@/features/traces/TracePanel";
import { WsLogInspectorPanel } from "./WsLogInspectorPanel";

/** 获取当前会话工作目录；终端标题仍显示根工作区名称。 */
function getCurrentSessionWorkspace(): string | null {
  const chat = useChat.getState();
  const session = useSession.getState();
  if (chat.sessionId) {
    const current = session.allSessions.find((item) => item.session_id === chat.sessionId);
    if (current?.workspace) return current.workspace;
  }
  return chat.pendingWorkspace ?? null;
}

export function InspectorPanel() {
  const tabs = useInspector((s) => s.tabs);
  const activeTabId = useInspector((s) => s.activeTabId);
  const setActiveTab = useInspector((s) => s.setActiveTab);
  const closeTab = useInspector((s) => s.closeTab);
  const closeOtherTabs = useInspector((s) => s.closeOtherTabs);
  const closeTabsToRight = useInspector((s) => s.closeTabsToRight);
  const closeAllTabs = useInspector((s) => s.closeAllTabs);
  const reorderTabs = useInspector((s) => s.reorderTabs);
  const openFilePreview = useInspector((s) => s.openFilePreview);
  const openTerminalTab = useInspector((s) => s.openTerminalTab);
  const fileTreeOpen = useInspector((s) => s.fileTreeOpen);
  const toggleFileTree = useInspector((s) => s.toggleFileTree);
  const wordWrap = useInspector((s) => s.wordWrap);
  const fileTreeWidth = useLayout((s) => s.fileTreeWidth);
  const setFileTreeWidth = useLayout((s) => s.setFileTreeWidth);
  const effectiveActiveTabId = activeTabId ?? INSPECTOR_SESSION_STATE_TAB_ID;
  const contentTabs = useMemo(() => [...tabs].sort(compareByMountOrder), [tabs]);

  // ── LRU keep-alive: 最多保留 MAX_KEEP_ALIVE 个 tab 在 DOM 中 ──
  // 超出的 LRU tab 被卸载，切回时重新挂载（state 丢失，但 DOM 开销可控）
  const MAX_KEEP_ALIVE = 5;
  const prevLruRef = useRef<string[]>([]);
  const lruOrder = useMemo(() => {
    const prev = prevLruRef.current;
    const tabIds = new Set(tabs.map((t) => t.id));
    const order: string[] = [];
    // active tab 始终是最新
    if (activeTabId && tabIds.has(activeTabId)) {
      order.push(activeTabId);
    }
    // 按 LRU 顺序补充其余 tab
    for (const id of prev) {
      if (id !== activeTabId && tabIds.has(id)) {
        order.push(id);
      }
    }
    // 新开的 tab（不在 prev 中）追加到末尾
    for (const tab of tabs) {
      if (!order.includes(tab.id)) {
        order.push(tab.id);
      }
    }
    prevLruRef.current = order;
    return order;
  }, [tabs, activeTabId]);

  const keepAliveIds = useMemo(() => {
    const ids = new Set(lruOrder.slice(0, MAX_KEEP_ALIVE));
    // 审计页保留在 DOM 中：它维护展开项和已加载 Diff，切换到其他 Tab 时不应丢失。
    tabs.forEach((tab) => {
      if (tab.type === "audit") ids.add(tab.id);
    });
    return ids;
  }, [lruOrder, tabs]);
  const renderableTabs = useMemo(
    () => contentTabs.filter((tab) => keepAliveIds.has(tab.id)),
    [contentTabs, keepAliveIds],
  );

  // ── Live resize: fileTree 拖动直接操作 DOM，松手时 commit 到 store ──
  const fileTreeOuterRef = useRef<HTMLDivElement>(null);
  const fileTreeInnerRef = useRef<HTMLDivElement>(null);
  const fileTreeDragRef = useRef<number | null>(null);

  const createAndOpenTerminal = useCallback(async (cwd?: string) => {
    const workspace = useWorkspace.getState().rootPath;
    if (!workspace) return null;

    const terminalId = await terminalManager.createTerminal(
      workspace,
      cwd ?? getCurrentSessionWorkspace() ?? workspace,
    );
    if (!terminalId) return null;

    const info = terminalManager.getTerminalInfo(terminalId);
    openTerminalTab(terminalId, info?.label ?? "终端");
    if (!useLayout.getState().panelVisible.inspector) {
      useLayout.getState().togglePanelVisible("inspector");
    }
    return terminalId;
  }, [openTerminalTab]);

  const handleOpenTerminal = useCallback(() => {
    void createAndOpenTerminal();
  }, [createAndOpenTerminal]);

  const closeTerminalForTab = useCallback((tabId: string) => {
    const tab = useInspector.getState().tabs.find((item) => item.id === tabId);
    if (tab?.type === "terminal") {
      terminalManager.closeTerminal(tab.terminalId);
    }
  }, []);

  const handleCloseTab = useCallback((tabId: string) => {
    closeTerminalForTab(tabId);
    closeTab(tabId);
  }, [closeTab, closeTerminalForTab]);

  const handleCloseOtherTabs = useCallback((tabId: string) => {
    useInspector.getState().tabs
      .filter((tab) => tab.id !== tabId && tab.type === "terminal")
      .forEach((tab) => terminalManager.closeTerminal(tab.terminalId));
    closeOtherTabs(tabId);
  }, [closeOtherTabs]);

  const handleCloseTabsToRight = useCallback((tabId: string) => {
    const allTabs = useInspector.getState().tabs;
    const index = allTabs.findIndex((tab) => tab.id === tabId);
    if (index >= 0) {
      allTabs.slice(index + 1)
        .filter((tab) => tab.type === "terminal")
        .forEach((tab) => terminalManager.closeTerminal(tab.terminalId));
    }
    closeTabsToRight(tabId);
  }, [closeTabsToRight]);

  const handleCloseAllTabs = useCallback(() => {
    useInspector.getState().tabs
      .filter((tab) => tab.type === "terminal")
      .forEach((tab) => terminalManager.closeTerminal(tab.terminalId));
    closeAllTabs();
  }, [closeAllTabs]);

  // 保留文件树“在终端打开”的行为，但将终端落点迁移到 Inspector Tab。
  useEffect(() => {
    const onOpenTerminal = () => handleOpenTerminal();
    const onOpenTerminalAt = async (event: Event) => {
      const { dirPath } = (event as CustomEvent<{ dirPath?: string }>).detail ?? {};
      if (!dirPath) return;
      await createAndOpenTerminal(dirPath);
    };
    window.addEventListener("ftre:open-terminal-tab", onOpenTerminal);
    window.addEventListener("ftre:open-terminal-at", onOpenTerminalAt);
    return () => {
      window.removeEventListener("ftre:open-terminal-tab", onOpenTerminal);
      window.removeEventListener("ftre:open-terminal-at", onOpenTerminalAt);
    };
  }, [createAndOpenTerminal, handleOpenTerminal]);


  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface">
      <InspectorTabBar
        tabs={tabs}
        activeTabId={effectiveActiveTabId}
        onActivate={setActiveTab}
        onClose={handleCloseTab}
        onCloseOthers={handleCloseOtherTabs}
        onCloseRight={handleCloseTabsToRight}
        onCloseAll={handleCloseAllTabs}
        onOpenOriginalFile={openFilePreview}
        fileTreeOpen={fileTreeOpen}
        onToggleFileTree={toggleFileTree}
        onReorder={reorderTabs}
        onOpenTerminal={handleOpenTerminal}
      />
      <div className="flex-1 min-h-0 flex overflow-hidden">
            <div
              ref={fileTreeOuterRef}
              className={`shrink-0 overflow-hidden ${fileTreeOpen ? "border-r border-border-subtle" : ""}`}
              style={{
                width: fileTreeOpen ? fileTreeWidth : 0,
                minWidth: fileTreeOpen ? fileTreeWidth : 0,
                background: "#ffffff",
                overflow: "hidden",
              }}
            >
              <div ref={fileTreeInnerRef} style={{ width: fileTreeWidth, height: "100%" }}>
                <FileTreeSidebar />
              </div>
            </div>
            {fileTreeOpen && (
              <ResizeHandle
                direction="horizontal"
                className="w-[3px]"
                onResizeStart={() => {
                  fileTreeDragRef.current = useLayout.getState().fileTreeWidth;
                }}
                onResize={(delta) => {
                  if (fileTreeDragRef.current !== null) {
                    const oldW = fileTreeDragRef.current;
                    const w = Math.max(
                      FILE_TREE_WIDTH_MIN,
                      Math.min(FILE_TREE_WIDTH_MAX, oldW + delta),
                    );
                    fileTreeDragRef.current = w;
                    const px = `${w}px`;
                    if (fileTreeOuterRef.current) {
                      fileTreeOuterRef.current.style.width = px;
                      fileTreeOuterRef.current.style.minWidth = px;
                    }
                    if (fileTreeInnerRef.current) {
                      fileTreeInnerRef.current.style.width = px;
                    }
                    return w - oldW;
                  }
                  setFileTreeWidth(fileTreeWidth + delta);
                  return delta;
                }}
                onResizeEnd={() => {
                  if (fileTreeDragRef.current !== null) {
                    setFileTreeWidth(fileTreeDragRef.current);
                    fileTreeDragRef.current = null;
                  }
                }}
              />
            )}
        <div
          className="flex-1 min-w-0 overflow-hidden bg-surface relative"
        >
          <div
            className="absolute inset-0"
            style={{
              visibility: effectiveActiveTabId === INSPECTOR_SESSION_STATE_TAB_ID ? "visible" : "hidden",
              pointerEvents: effectiveActiveTabId === INSPECTOR_SESSION_STATE_TAB_ID ? "auto" : "none",
              zIndex: effectiveActiveTabId === INSPECTOR_SESSION_STATE_TAB_ID ? 1 : 0,
            }}
          >
            <TabErrorBoundary tabId={INSPECTOR_SESSION_STATE_TAB_ID}>
              <SessionStateRenderer active={effectiveActiveTabId === INSPECTOR_SESSION_STATE_TAB_ID} />
            </TabErrorBoundary>
          </div>
          <div
            className="absolute inset-0"
            style={{
              visibility: effectiveActiveTabId === INSPECTOR_TRACE_TAB_ID ? "visible" : "hidden",
              pointerEvents: effectiveActiveTabId === INSPECTOR_TRACE_TAB_ID ? "auto" : "none",
              zIndex: effectiveActiveTabId === INSPECTOR_TRACE_TAB_ID ? 1 : 0,
            }}
          >
            <TabErrorBoundary tabId={INSPECTOR_TRACE_TAB_ID}>
              <TracePanel active={effectiveActiveTabId === INSPECTOR_TRACE_TAB_ID} />
            </TabErrorBoundary>
          </div>
          <div
            className="absolute inset-0"
            style={{
              visibility: effectiveActiveTabId === INSPECTOR_WS_LOG_TAB_ID ? "visible" : "hidden",
              pointerEvents: effectiveActiveTabId === INSPECTOR_WS_LOG_TAB_ID ? "auto" : "none",
              zIndex: effectiveActiveTabId === INSPECTOR_WS_LOG_TAB_ID ? 1 : 0,
            }}
          >
            <TabErrorBoundary tabId={INSPECTOR_WS_LOG_TAB_ID}>
              <WsLogInspectorPanel active={effectiveActiveTabId === INSPECTOR_WS_LOG_TAB_ID} />
            </TabErrorBoundary>
          </div>
          {renderableTabs.map((tab) => (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{
                visibility: tab.id === effectiveActiveTabId ? "visible" : "hidden",
                pointerEvents: tab.id === effectiveActiveTabId ? "auto" : "none",
                zIndex: tab.id === effectiveActiveTabId ? 1 : 0,
              }}
            >
              <div className="h-full w-full">
                <TabErrorBoundary tabId={tab.id}>
                  <InspectorTabContent tab={tab} active={tab.id === effectiveActiveTabId} wordWrap={wordWrap} />
                </TabErrorBoundary>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InspectorTabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseRight,
  onCloseAll,
  onOpenOriginalFile,
  fileTreeOpen,
  onToggleFileTree,
  onReorder,
  onOpenTerminal,
}: {
  tabs: InspectorTab[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseRight: (id: string) => void;
  onCloseAll: () => void;
  onOpenOriginalFile: (toolCallId: string, path: string, title?: string, revealLine?: number, revealEndLine?: number, content?: string) => void;
  fileTreeOpen: boolean;
  onToggleFileTree: () => void;
  onReorder: (fromId: string, toIndex: number) => void;
  onOpenTerminal: () => void;
}) {
  const overlayRef = useRef<OverlayScrollbarsComponentRef | null>(null);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    tabId: string;
  } | null>(null);

  const tabDrag = useSmoothTabReorder(tabs, onReorder);

  const getScrollElement = useCallback((): HTMLElement | null => {
    const osInstance = overlayRef.current?.osInstance();
    return osInstance?.elements()?.viewport ?? null;
  }, []);

  // 检测左右溢出：是否有隐藏 tab + 数量
  const [hiddenLeft, setHiddenLeft] = useState(0);
  const [hiddenRight, setHiddenRight] = useState(0);
  const updateScrollState = useCallback(() => {
    const el = getScrollElement();
    if (!el) { setHiddenLeft(0); setHiddenRight(0); return; }
    // 遍历子 tab button 统计左右隐藏数量
    const cRect = el.getBoundingClientRect();
    let left = 0, right = 0;
    for (const child of el.querySelectorAll('[data-tab-btn]')) {
      const r = (child as HTMLElement).getBoundingClientRect();
      if (r.right < cRect.left + 2) left++;
      else if (r.left > cRect.right - 2) right++;
    }
    setHiddenLeft(left);
    setHiddenRight(right);
  }, [getScrollElement]);
  useEffect(() => {
    updateScrollState();
    // OverlayScrollbars 的 onScroll 不一定触发，直接在 viewport 上加原生监听
    const el = getScrollElement();
    if (!el) return;
    el.addEventListener("scroll", updateScrollState, { passive: true });

    // React onWheel 是 passive 的，preventDefault 会警告，改用原生 { passive: false }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("scroll", updateScrollState);
      el.removeEventListener("wheel", onWheel);
    };
  }, [tabs, getScrollElement, updateScrollState]);

  // active tab 变化时滚动定位到可视区域
  useEffect(() => {
    if (!activeTabId) return;
    const el = activeTabRef.current;
    if (!el) return;
    const container = getScrollElement();
    if (!container) return;
    const elRect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    if (elRect.left < cRect.left) {
      container.scrollLeft -= cRect.left - elRect.left + 8;
    } else if (elRect.right > cRect.right) {
      container.scrollLeft += elRect.right - cRect.right + 8;
    }
    updateScrollState();
  }, [activeTabId, getScrollElement, updateScrollState]);

  const wordWrap = useInspector((s) => s.wordWrap);
  const toggleWordWrap = useInspector((s) => s.toggleWordWrap);

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, tabId });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const fixedTabs = [
    { id: INSPECTOR_SESSION_STATE_TAB_ID, label: "state.json", Icon: Braces },
    { id: INSPECTOR_TRACE_TAB_ID, label: "Traces", Icon: Activity },
    { id: INSPECTOR_WS_LOG_TAB_ID, label: "WS Logs", Icon: ScrollText },
  ] as const;
  const activeFixedTab = fixedTabs.find((tab) => tab.id === activeTabId) ?? fixedTabs[0];
  const ActiveFixedIcon = activeFixedTab.Icon;

  const getContextMenuItems = useCallback(
    (tabId: string): ContextMenuItem[] => {
      const tab = tabs.find((t) => t.id === tabId);
      const items: ContextMenuItem[] = [];

      // diff tab 专属：打开原始文件
      // toolCallId 统一用 original-${filePath}，与 FileTreeSidebar Changes 右键菜单一致
      if (tab?.type === "diff" && tab.filePath) {
        const absPath = tab.filePath.replace(/\\/g, "/");
        items.push({
          id: "open-original",
          label: "打开原始文件",
          icon: FileText,
          action: () => {
            onOpenOriginalFile(
              `original-${absPath}`,
              tab.filePath,
              undefined,
              undefined,
              undefined,
              undefined,
            );
          },
        });
        items.push({
          id: "sep-diff",
          label: "",
          separator: true,
          action: () => {},
        });
      }

      if (tab?.type === "terminal") {
        items.push({
          id: "clear-terminal",
          label: "清除终端内容",
          icon: Trash2,
          action: () => terminalManager.clearTerminal(tab.terminalId),
        });
      } else if (tab?.type !== "audit") {
        items.push({
          id: "wordwrap",
          label: "开启/关闭自动换行",
          action: () => toggleWordWrap(),
        });
      }

      items.push(
        {
          id: "sep0",
          label: "",
          separator: true,
          action: () => {},
        },
        {
          id: "close",
          label: "关闭",
          action: () => onClose(tabId),
        },
        {
          id: "close-others",
          label: "关闭其他",
          action: () => onCloseOthers(tabId),
        },
        {
          id: "close-right",
          label: "关闭右侧",
          action: () => onCloseRight(tabId),
        },
        {
          id: "sep",
          label: "",
          separator: true,
          action: () => {},
        },
        {
          id: "close-all",
          label: "关闭全部",
          action: () => onCloseAll(),
        },
      );

      return items;
    },
    [tabs, onClose, onCloseOthers, onCloseRight, onCloseAll, toggleWordWrap, onOpenOriginalFile],
  );

  return (
    <div className="h-10 flex items-center gap-1 shrink-0 px-2" style={{ background: "#ffffff" }}>
      <button
        onClick={onToggleFileTree}
        title="文件树"
        className={`flex h-7 w-[52px] shrink-0 items-center justify-center gap-1 rounded-lg transition-colors ${
          fileTreeOpen
            ? "bg-surface text-t-primary shadow-sm"
            : "text-t-ghost hover:bg-hover hover:text-t-secondary"
        }`}
      >
        {fileTreeOpen ? <FolderOpen size={14} /> : <Folder size={14} />}
      </button>
      <div className="mx-1 h-5 w-px shrink-0 bg-border" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="切换固定面板"
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-surface px-2.5 text-[12px] text-t-primary shadow-sm transition-colors hover:bg-hover"
          >
            <ActiveFixedIcon size={14} />
            <span>{activeFixedTab.label}</span>
            <ChevronDown size={12} className="text-t-ghost" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={5}
          className="min-w-[150px] rounded-xl border-0 bg-surface shadow-[0_8px_24px_rgba(15,23,42,0.14)]"
        >
          {fixedTabs.map(({ id, label, Icon }) => (
            <DropdownMenuItem
              key={id}
              onSelect={() => onActivate(id)}
              className={id === activeFixedTab.id
                ? "bg-hover text-t-primary"
                : "text-t-secondary hover:bg-hover hover:text-t-primary"}
            >
              <Icon size={14} />
              <span>{label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="relative flex-1 min-w-0 h-full">
        <OverlayScrollbarsComponent
          ref={overlayRef}
          defer
          options={{
            overflow: { x: "scroll", y: "hidden" },
            scrollbars: { autoHide: "never", autoHideDelay: 0 },
          }}
          className="h-full tabbar-scroll-area"
          onScroll={updateScrollState}
        >
          <div className="flex items-center justify-start h-full min-w-max px-1">
            <div
              ref={tabDrag.containerRef}
              className="flex items-center justify-start h-full gap-1"
            >
              {tabs.map((tab, index) => (
                <div
                  key={tab.id}
                  data-tab-id={tab.id}
                  className="flex h-full shrink-0 items-center"
                  style={tabDrag.getItemStyle(tab.id, index)}
                >
                  <TabButton
                    tab={tab}
                    isActive={tab.id === activeTabId}
                    activeRef={activeTabRef}
                    onActivate={onActivate}
                    onClose={onClose}
                    onContextMenu={handleContextMenu}
                    onDragPointerDown={tabDrag.handlePointerDown}
                    onDragPointerMove={tabDrag.handlePointerMove}
                    onDragPointerUp={tabDrag.handlePointerUp}
                    shouldSuppressClick={tabDrag.shouldSuppressClick}
                  />
                </div>
              ))}
            </div>
          </div>
        </OverlayScrollbarsComponent>
        {hiddenLeft > 0 && (
          <div className="absolute left-0 top-0 bottom-0 flex items-center pointer-events-none bg-white pr-2 pl-1 shadow-[4px_0_4px_-2px_rgba(0,0,0,0.08)]">
            <span className="text-[10px] font-mono font-bold text-t-ghost">+{hiddenLeft}</span>
          </div>
        )}
        {hiddenRight > 0 && (
          <div className="absolute right-0 top-0 bottom-0 flex items-center justify-end pointer-events-none bg-white pl-2 pr-1 shadow-[-4px_0_4px_-2px_rgba(0,0,0,0.08)]">
            <span className="text-[10px] font-mono font-bold text-t-ghost">+{hiddenRight}</span>
          </div>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="新建面板"
            aria-label="新建面板"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-t-ghost transition-colors hover:bg-hover hover:text-t-primary"
          >
            <Plus size={15} strokeWidth={1.8} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={5}
          className="min-w-[170px] rounded-[14px] border border-black/[0.06] bg-white p-1.5 shadow-[0_10px_30px_rgba(15,23,42,0.14)] data-[state=open]:animate-none data-[state=closed]:animate-none"
        >
          <DropdownMenuItem
            onSelect={onOpenTerminal}
            className="h-9 gap-2 rounded-lg px-3 text-t-secondary transition-colors hover:bg-[#f3f3f4] hover:text-t-primary focus:bg-[#f3f3f4] focus:text-t-primary data-[highlighted]:bg-[#f3f3f4] data-[highlighted]:text-t-primary"
          >
            <TerminalSquare size={14} />
            <span className="flex-1">终端</span>
            <span className="text-[11px] text-t-ghost">Ctrl+`</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {contextMenu && (
        <ContextMenu
          items={getContextMenuItems(contextMenu.tabId)}
          position={contextMenu.position}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}

// ─── 单个 Tab 按钮（独立 ripple） ──────────────────────────────────

const TabButton = memo(function TabButton({
  tab,
  isActive,
  activeRef,
  onActivate,
  onClose,
  onContextMenu,
  onDragPointerDown,
  onDragPointerMove,
  onDragPointerUp,
  shouldSuppressClick,
}: {
  tab: InspectorTab;
  isActive: boolean;
  activeRef: React.RefObject<HTMLButtonElement | null>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, tabId: string) => void;
  onDragPointerDown: (e: ReactPointerEvent<HTMLElement>, tabId: string) => void;
  onDragPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onDragPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  shouldSuppressClick: () => boolean;
}) {
  const { ripples, trigger, remove } = useRipple();
  const meta = getTabMeta(tab.type);
  const filePath = "filePath" in tab ? tab.filePath : tab.title;

  return (
    <button
      data-tab-btn
      ref={isActive ? activeRef : undefined}
      draggable={false}
      onPointerDown={(e) => onDragPointerDown(e, tab.id)}
      onPointerMove={onDragPointerMove}
      onPointerUp={onDragPointerUp}
      onPointerCancel={onDragPointerUp}
      onClick={(e) => {
        if (shouldSuppressClick()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        trigger(e);
        onActivate(tab.id);
      }}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose(tab.id);
        }
      }}
      onContextMenu={(e) => onContextMenu(e, tab.id)}
      className={`group relative overflow-hidden flex h-8 items-center gap-2.5 rounded-lg pl-3.5 pr-7 text-[12.5px] whitespace-nowrap font-sans transition-all duration-150 select-none ${
        isActive
          ? "z-10 text-t-primary"
          : "text-t-muted hover:bg-elevated hover:text-t-secondary"
      }`}
      style={isActive ? {
        background: "#f0f1f3",
        boxShadow: "0 1px 2px rgba(15,23,42,0.08)",
      } : undefined}
    >
      <RippleLayer items={ripples} onEnd={remove} />
      {meta?.icon(tab) ?? <FileIconView path={filePath} size={16} />}
      <span className="max-w-[180px] truncate">{meta?.title(tab) ?? tab.title}</span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-r from-transparent via-white/80 to-white opacity-0 transition-opacity duration-100 group-hover:opacity-100"
      />
      <span
        data-tab-close
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.id);
        }}
        className="absolute right-1 top-1/2 z-20 -translate-y-1/2 rounded p-0.5 text-t-muted opacity-0 transition-opacity duration-100 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 cursor-pointer hover:bg-black/[0.08] hover:text-t-primary"
      >
        <X size={12} strokeWidth={1.5} />
      </span>
    </button>
  );
});

// ⚠️ memo 包装：切 tab 时只有 active 值变化的 tab 会 re-render，
// 其余 tab 的 props（tab 引用、wordWrap）不变则跳过，
// 避免所有 tab 同时 re-render → MonacoDiffViewer 即使自己 memo 了也会被调用
const InspectorTabContent = memo(function InspectorTabContent(props: { tab: InspectorTab; active: boolean; wordWrap: boolean }) {
  const meta = getTabMeta(props.tab.type);
  if (!meta) {
    return null;
  }
  return <>{meta.renderer(props)}</>;
});

/**
 * TabErrorBoundary — 捕获 Monaco InstantiationService disposed 等致命错误，
 * 提供重试按钮，重试时通过递增 key 强制重新挂载 Monaco 编辑器。
 */
function TabErrorBoundary({ tabId, children }: { tabId: string; children: ReactNode }) {
  const [resetKey, setResetKey] = useState(0);
  return (
    <ErrorBoundary
      key={`${tabId}-${resetKey}`}
      level="region"
      onReset={() => setResetKey((k) => k + 1)}
    >
      {children}
    </ErrorBoundary>
  );
}

// ─── 渲染器注册 ──────────────────────────────────────────────────
// 在模块加载时注册，确保 InspectorPanel 使用前就绪。

import { registerTabMeta } from "./tabRegistry";
import { FileRenderer } from "./renderers/FileRenderer";
import { DiffRenderer } from "./renderers/DiffRenderer";
import { ImageRenderer } from "./renderers/ImageRenderer";
import { TerminalRenderer } from "./renderers/TerminalRenderer";
import { AuditRenderer } from "./AuditRenderer";

registerTabMeta("file", {
  icon: (tab) => <FileIconView path={"filePath" in tab ? tab.filePath : tab.title} size={16} />,
  title: (tab) => tab.title,
  renderer: (props) => <FileRenderer {...props} />,
});

registerTabMeta("diff", {
  icon: () => <GitCompareArrows size={15} className="shrink-0 text-t-ghost" />,
  title: (tab) => `Diff-${tab.title}`,
  renderer: (props) => <DiffRenderer {...props} />,
});

registerTabMeta("image", {
  icon: (tab) => <FileIconView path={"filePath" in tab ? tab.filePath : tab.title} size={16} />,
  title: (tab) => tab.title,
  renderer: (props) => <ImageRenderer {...props} />,
});

registerTabMeta("terminal", {
  icon: () => <TerminalSquare size={15} className="shrink-0 text-t-ghost" />,
  title: (tab) => tab.title,
  renderer: (props) => <TerminalRenderer {...props} />,
});

registerTabMeta("audit", {
  icon: () => <ClipboardCheck size={15} className="shrink-0 text-t-ghost" />,
  title: (tab) => tab.title,
  renderer: (props) => <AuditRenderer {...props} />,
});
