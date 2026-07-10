/**
 * InspectorPanel — 右侧扩展面板（编辑器风格）
 *
 * Tab 渲染通过 tabRegistry 分发，新增 tab 类型只需注册 renderer。
 */
import { useState, useEffect, useCallback, useRef, memo } from "react";
import { X, FileText, Loader2, ListTree } from "lucide-react";
import { GitCompareArrows } from "lucide-react";
import { OverlayScrollbarsComponent, type OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { useInspector, type InspectorTab } from "@/stores/inspector";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { ResizeHandle } from "@/components/ResizeHandle";
import { useLayout } from "@/stores/layout";
import { FileTreeSidebar } from "./FileTreeSidebar";
import { FileIconView } from "@/components/FileIconView";
import { getTabMeta } from "./tabRegistry";
import { useRipple, RippleLayer } from "@/components/Ripple";

export function InspectorPanel() {
  const tabs = useInspector((s) => s.tabs);
  const activeTabId = useInspector((s) => s.activeTabId);
  const setActiveTab = useInspector((s) => s.setActiveTab);
  const closeTab = useInspector((s) => s.closeTab);
  const closeOtherTabs = useInspector((s) => s.closeOtherTabs);
  const closeTabsToRight = useInspector((s) => s.closeTabsToRight);
  const closeAllTabs = useInspector((s) => s.closeAllTabs);
  const openFilePreview = useInspector((s) => s.openFilePreview);
  const fileTreeOpen = useInspector((s) => s.fileTreeOpen);
  const toggleFileTree = useInspector((s) => s.toggleFileTree);
  const wordWrap = useInspector((s) => s.wordWrap);
  const fileTreeWidth = useLayout((s) => s.fileTreeWidth);
  const setFileTreeWidth = useLayout((s) => s.setFileTreeWidth);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface">
      <InspectorTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={setActiveTab}
        onClose={closeTab}
        onCloseOthers={closeOtherTabs}
        onCloseRight={closeTabsToRight}
        onCloseAll={closeAllTabs}
        onOpenOriginalFile={openFilePreview}
        fileTreeOpen={fileTreeOpen}
        onToggleFileTree={toggleFileTree}
      />
      <div className="flex-1 min-h-0 flex overflow-hidden">
            <div
              className="shrink-0 border-r border-border overflow-hidden"
              style={{
                width: fileTreeOpen ? fileTreeWidth : 0,
                minWidth: fileTreeOpen ? fileTreeWidth : 0,
                background: "#f9fafb",
                overflow: "hidden",
              }}
            >
              <div style={{ width: fileTreeWidth, height: "100%" }}>
                <FileTreeSidebar />
              </div>
            </div>
            {fileTreeOpen && (
              <ResizeHandle
                direction="horizontal"
                onResize={(delta) => {
                  setFileTreeWidth(fileTreeWidth + delta);
                  return delta;
                }}
              />
            )}
        <div
          className="flex-1 min-w-0 overflow-hidden bg-surface relative"
        >
          {tabs.length === 0 ? (
            <EmptyState />
          ) : (
            tabs.map((tab) => (
              <div
                key={tab.id}
                className="absolute inset-0"
                style={{
                  visibility: tab.id === activeTabId ? "visible" : "hidden",
                  pointerEvents: tab.id === activeTabId ? "auto" : "none",
                  zIndex: tab.id === activeTabId ? 1 : 0,
                }}
              >
                <div className="h-full w-full">
                  <InspectorTabContent tab={tab} active={tab.id === activeTabId} wordWrap={wordWrap} />
                </div>
              </div>
            ))
          )}
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
}) {
  const overlayRef = useRef<OverlayScrollbarsComponentRef | null>(null);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    tabId: string;
  } | null>(null);

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

      items.push(
        {
          id: "wordwrap",
          label: "开启/关闭自动换行",
          action: () => toggleWordWrap(),
        },
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
    <div className="h-[38px] flex items-end shrink-0 border-b border-border" style={{ background: "#f9fafb" }}>
      <button
        onClick={onToggleFileTree}
        title="文件树"
        className={`h-full w-[32px] shrink-0 flex items-center justify-center border-r border-border transition-colors ${
          fileTreeOpen
            ? "text-t-primary bg-surface"
            : "text-t-ghost hover:text-t-secondary hover:bg-elevated"
        }`}
      >
        <ListTree size={15} />
      </button>
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
          <div className="flex items-end justify-start h-full min-w-max">
            {tabs.map((tab) => (
              <TabButton
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                activeRef={activeTabRef}
                onActivate={onActivate}
                onClose={onClose}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>
        </OverlayScrollbarsComponent>
        {hiddenLeft > 0 && (
          <div className="absolute left-0 top-0 bottom-0 flex items-center pointer-events-none bg-[#f9fafb] pr-2 pl-1 shadow-[4px_0_4px_-2px_rgba(0,0,0,0.08)]">
            <span className="text-[10px] font-mono font-bold text-t-ghost">+{hiddenLeft}</span>
          </div>
        )}
        {hiddenRight > 0 && (
          <div className="absolute right-0 top-0 bottom-0 flex items-center justify-end pointer-events-none bg-[#f9fafb] pl-2 pr-1 shadow-[-4px_0_4px_-2px_rgba(0,0,0,0.08)]">
            <span className="text-[10px] font-mono font-bold text-t-ghost">+{hiddenRight}</span>
          </div>
        )}
      </div>
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
}: {
  tab: InspectorTab;
  isActive: boolean;
  activeRef: React.RefObject<HTMLButtonElement | null>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, tabId: string) => void;
}) {
  const { ripples, trigger, remove } = useRipple();
  const meta = getTabMeta(tab.type);
  const filePath = tab.filePath ?? tab.title;

  return (
    <button
      data-tab-btn
      ref={isActive ? activeRef : undefined}
      onClick={(e) => {
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
      className={`group relative overflow-hidden flex items-center gap-2 h-full text-[13px] whitespace-nowrap font-sans transition-all duration-150 select-none px-3.5 ${
        isActive
          ? "z-10 text-t-primary"
          : "text-t-muted hover:bg-elevated hover:text-t-secondary"
      }`}
      style={isActive ? {
        background: "#f0f1f3",
        boxShadow: "inset 3px 0 0 #059669, 0 -1px 3px rgba(0,0,0,0.06), inset 0 -1px 0 rgba(0,0,0,0.05)",
      } : undefined}
    >
      <RippleLayer items={ripples} onEnd={remove} />
      {isActive && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-white/60" />
      )}
      {meta?.icon(tab) ?? <FileIconView path={filePath} size={16} />}
      <span className="max-w-[180px] truncate">{meta?.title(tab) ?? tab.title}</span>
      <span
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.id);
        }}
        className={`ml-1 p-0.5 rounded transition-all cursor-pointer ${
          isActive
            ? "text-t-muted hover:text-t-primary hover:bg-black/[0.08] opacity-100"
            : "opacity-0 group-hover:opacity-100 text-t-muted hover:text-t-primary hover:bg-black/[0.08]"
        }`}
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
  if (!meta) return null;
  return <>{meta.renderer(props)}</>;
});

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center flex-col gap-2 bg-surface text-t-ghost">
      <FileText size={28} strokeWidth={1.5} />
      <div className="text-[13px] font-mono">暂无预览内容</div>
    </div>
  );
}

// ─── 渲染器注册 ──────────────────────────────────────────────────
// 在模块加载时注册，确保 InspectorPanel 使用前就绪。

import { registerTabMeta } from "./tabRegistry";
import { FileRenderer } from "./renderers/FileRenderer";
import { DiffRenderer } from "./renderers/DiffRenderer";
import { ImageRenderer } from "./renderers/ImageRenderer";

registerTabMeta("file", {
  icon: (tab) => <FileIconView path={tab.filePath ?? tab.title} size={16} />,
  title: (tab) => tab.title,
  renderer: (props) => <FileRenderer {...props} />,
});

registerTabMeta("diff", {
  icon: () => <GitCompareArrows size={15} className="shrink-0 text-t-ghost" />,
  title: (tab) => `Diff-${tab.title}`,
  renderer: (props) => <DiffRenderer {...props} />,
});

registerTabMeta("image", {
  icon: (tab) => <FileIconView path={tab.filePath ?? tab.title} size={16} />,
  title: (tab) => tab.title,
  renderer: (props) => <ImageRenderer {...props} />,
});
