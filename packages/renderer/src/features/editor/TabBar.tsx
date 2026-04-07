import { useState, useRef, useCallback, useEffect } from "react";
import { X, ChevronLeft, ChevronRight, Pin } from "lucide-react";
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from "overlayscrollbars-react";
import { useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import { getFileIcon } from "@/lib/file-icons";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { getDocumentManager } from "@ftre/editor/core";
import { saveFile } from "@ftre/editor/runtime";

interface TabBarProps {
  groupId?: string;
}

export function TabBar({ groupId }: TabBarProps) {
  const {
    groups,
    activeGroupId,
    setActive,
    closeFile,
    closeOtherFiles,
    closeFilesToRight,
    closeSavedFiles,
    pinFile,
    unpinFile,
  } = useEditor();

  // Resolve which group to display: explicit groupId prop, or fall back to active group
  const resolvedGroupId = groupId ?? activeGroupId;
  const group = groups.find((g) => g.id === resolvedGroupId) ?? groups[0];
  const openFiles = group?.openFiles ?? [];
  const activeFile = group?.activeFile ?? null;
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<string | null>(null);

  /** 关闭文件的入口——未保存时弹确认框 */
  const requestClose = useCallback(
    (filePath: string) => {
      const file = openFiles.find((f) => f.path === filePath);
      if (file?.modified) {
        setPendingClose(filePath);
      } else {
        closeFile(filePath);
      }
    },
    [openFiles, closeFile],
  );

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    filePath: string;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, filePath: string) => {
      e.preventDefault();
      setContextMenu({ position: { x: e.clientX, y: e.clientY }, filePath });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const getContextMenuItems = useCallback(
    (filePath: string): ContextMenuItem[] => {
      const file = openFiles.find((f) => f.path === filePath);
      const isPinned = file?.pinned ?? false;

      return [
        {
          id: "pin",
          label: isPinned ? "取消固定" : "固定标签页",
          icon: Pin,
          action: () => (isPinned ? unpinFile(filePath) : pinFile(filePath)),
        },
        {
          id: "sep-pin",
          label: "",
          separator: true,
          action: () => {},
        },
        {
          id: "close",
          label: "关闭",
          action: () => requestClose(filePath),
        },
        {
          id: "close-others",
          label: "关闭其他",
          action: () => closeOtherFiles(filePath),
        },
        {
          id: "close-right",
          label: "关闭右侧所有",
          action: () => closeFilesToRight(filePath),
        },
        {
          id: "close-saved",
          label: "关闭已保存的",
          action: () => closeSavedFiles(),
        },
        {
          id: "separator",
          label: "",
          separator: true,
          action: () => {},
        },
        {
          id: "copy-path",
          label: "复制文件路径",
          action: () => {
            navigator.clipboard.writeText(filePath);
          },
        },
        {
          id: "reveal-in-sidebar",
          label: "在侧边栏中定位",
          action: () => {
            useLayout.getState().setActiveSidebarView("explorer");
            window.dispatchEvent(
              new CustomEvent("ftre:reveal-in-sidebar", {
                detail: { path: filePath },
              }),
            );
          },
        },
      ];
    },
    [
      openFiles,
      requestClose,
      closeOtherFiles,
      closeFilesToRight,
      closeSavedFiles,
      pinFile,
      unpinFile,
    ],
  );

  // Drag-and-drop state — use ref for dragIndex to avoid stale closures
  const dragIndexRef = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(
    null,
  );

  // Overflow scroll state
  const overlayRef = useRef<OverlayScrollbarsComponentRef | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const getScrollElement = useCallback((): HTMLElement | null => {
    return overlayRef.current?.osInstance()?.elements().viewport ?? null;
  }, []);

  const updateScrollState = useCallback(() => {
    const el = getScrollElement();
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, [getScrollElement]);

  useEffect(() => {
    const el = getScrollElement();
    if (!el) return;

    const observer = new ResizeObserver(() => updateScrollState());
    observer.observe(el);
    el.addEventListener("scroll", updateScrollState);
    updateScrollState();

    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", updateScrollState);
    };
  }, [getScrollElement, updateScrollState, openFiles.length]);

  const scrollTabs = useCallback((direction: "left" | "right") => {
    const el = getScrollElement();
    if (!el) return;
    const amount = direction === "left" ? -150 : 150;
    el.scrollBy({ left: amount, behavior: "instant" });
  }, [getScrollElement]);

  // Middle-click close handler
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, filePath: string) => {
      if (e.button === 1) {
        e.preventDefault();
        requestClose(filePath);
      }
    },
    [requestClose],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLButtonElement>, index: number) => {
      dragIndexRef.current = index;
      setDragIndex(index);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    },
    [],
  );

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLButtonElement>) => {
    e.currentTarget.style.opacity = "";
    dragIndexRef.current = null;
    setDragIndex(null);
    setDropIndicatorIndex(null);
  }, []);

  const computeInsertIndex = useCallback(
    (e: React.DragEvent<HTMLButtonElement>, index: number): number | null => {
      const currentDragIndex = dragIndexRef.current;
      if (currentDragIndex === null || currentDragIndex === index) return null;

      const rect = e.currentTarget.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      return e.clientX < midpoint ? index : index + 1;
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLButtonElement>, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const insertIndex = computeInsertIndex(e, index);
      if (insertIndex === null) {
        setDropIndicatorIndex(null);
        return;
      }
      setDropIndicatorIndex(insertIndex);
    },
    [computeInsertIndex],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLButtonElement>, index: number) => {
      e.preventDefault();

      const currentDragIndex = dragIndexRef.current;
      if (currentDragIndex === null) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      let toIndex = e.clientX < midpoint ? index : index + 1;

      // Adjust: if dragging forward, account for the removal of the source
      if (toIndex > currentDragIndex) {
        toIndex -= 1;
      }

      if (toIndex !== currentDragIndex) {
        useEditor
          .getState()
          .reorderTabs(resolvedGroupId, currentDragIndex, toIndex);
      }

      dragIndexRef.current = null;
      setDragIndex(null);
      setDropIndicatorIndex(null);
    },
    [resolvedGroupId],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const container = getScrollElement();
    if (container) {
      container.scrollLeft += e.deltaY;
    }
  }, [getScrollElement]);

  const handleContainerDragOver = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
    },
    [],
  );

  return (
    <div className="h-[38px] bg-base flex items-end shrink-0">
      {/* Left scroll arrow */}
      {canScrollLeft && (
        <button
          onClick={() => scrollTabs("left")}
          className="flex items-center justify-center w-[24px] h-full text-t-muted hover:text-t-primary hover:bg-white/[0.06] transition-colors shrink-0"
          aria-label="向左滚动标签"
          data-testid="scroll-left"
        >
          <ChevronLeft size={14} strokeWidth={1.5} />
        </button>
      )}

      {/* Tabs */}
      <OverlayScrollbarsComponent
        ref={overlayRef}
        defer
        options={{
          overflow: { x: "scroll", y: "hidden" },
          scrollbars: {
            autoHide: "leave",
            autoHideDelay: 120,
          },
        }}
        className="tabbar-scroll-area flex items-end flex-1 min-w-0 h-full relative"
        onDragOver={handleContainerDragOver}
        onWheel={handleWheel}
      >
        <div className="flex items-end justify-start h-full min-w-max">
          {openFiles.map((file, index) => {
            const isActive = file.path === activeFile;
            const isHovered = hoveredTab === file.path;
            const isDragging = dragIndex === index;
            return (
              <button
                key={file.path}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onClick={() => setActive(file.path)}
                onMouseDown={(e) => handleMouseDown(e, file.path)}
                onContextMenu={(e) => handleContextMenu(e, file.path)}
                onMouseEnter={() => setHoveredTab(file.path)}
                onMouseLeave={() => setHoveredTab(null)}
                className={`group relative flex items-center gap-2 h-full text-[13px] whitespace-nowrap font-sans transition-colors duration-150 border border-border select-none ${
                  file.pinned ? "px-2.5" : "px-3.5"
                } ${isDragging ? "opacity-40" : ""} ${isActive ? "z-10 border-b-transparent bg-[#1a1b1d] text-t-primary" : "bg-base text-t-muted hover:bg-elevated hover:text-t-secondary"}`}
                data-tab-index={index}
              >
              {/* Drop indicator line — left side */}
              {dropIndicatorIndex === index && (
                <div
                  className="absolute left-0 top-[4px] bottom-[4px] w-[2px] bg-neon z-10 pointer-events-none"
                  data-testid="drop-indicator"
                />
              )}
              {/* Drop indicator line — right side (for last tab) */}
              {dropIndicatorIndex === index + 1 &&
                index === openFiles.length - 1 && (
                  <div
                    className="absolute right-0 top-[4px] bottom-[4px] w-[2px] bg-neon z-10 pointer-events-none"
                    data-testid="drop-indicator"
                  />
                )}
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-white/40" />
              )}
              {(() => {
                const { icon: FileIcon, color } = getFileIcon(file.name, false);
                return (
                  <FileIcon size={15} className="shrink-0" style={{ color }} />
                );
              })()}
              {!file.pinned && file.name}
              {file.modified && (
                <div className="w-[6px] h-[6px] rounded-full bg-t-primary shrink-0" />
              )}
              {file.pinned ? (
                <Pin
                  size={10}
                  className="text-t-dim shrink-0"
                  strokeWidth={1.5}
                />
              ) : (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    requestClose(file.path);
                  }}
                  className={`ml-1 p-0.5 rounded transition-all cursor-pointer ${
                    isActive || isHovered
                      ? "text-t-muted hover:text-t-primary hover:bg-white/[0.1] opacity-100"
                      : "opacity-0"
                  }`}
                >
                  <X size={12} strokeWidth={1.5} />
                </span>
              )}
              </button>
            );
          })}
        </div>
      </OverlayScrollbarsComponent>

      {/* Right scroll arrow */}
      {canScrollRight && (
        <button
          onClick={() => scrollTabs("right")}
          className="flex items-center justify-center w-[24px] h-full text-t-muted hover:text-t-primary hover:bg-white/[0.06] transition-colors shrink-0"
          aria-label="向右滚动标签"
          data-testid="scroll-right"
        >
          <ChevronRight size={14} strokeWidth={1.5} />
        </button>
      )}

      {/* Tab context menu */}
      {contextMenu && (
        <ContextMenu
          items={getContextMenuItems(contextMenu.filePath)}
          position={contextMenu.position}
          onClose={closeContextMenu}
        />
      )}

      {/* 未保存文件关闭确认 */}
      {pendingClose &&
        (() => {
          const file = openFiles.find((f) => f.path === pendingClose);
          // 文件已被其他机制关闭，自动清除
          if (!file) {
            queueMicrotask(() => setPendingClose(null));
            return null;
          }
          const fileName =
            file.name ?? pendingClose.split(/[\\/]/).pop() ?? "文件";
          const handleSaveAndClose = () => {
            const docManager = getDocumentManager();
            const doc = docManager.get(file.path);
            saveFile(file.path, file.name, () =>
              doc ? doc.getContentForSave() : file.content,
            )
              .then(() => closeFile(file.path))
              .catch(() => {
                /* saveFile 内部已通知用户 */
              })
              .finally(() => setPendingClose(null));
          };
          return (
            <ConfirmDialog
              title="未保存的更改"
              message={`"${fileName}" 有未保存的更改，是否保存？`}
              onConfirm={handleSaveAndClose}
              onCancel={() => setPendingClose(null)}
              buttons={[
                {
                  label: "不保存",
                  variant: "danger",
                  action: () => {
                    closeFile(pendingClose);
                    setPendingClose(null);
                  },
                },
                {
                  label: "取消",
                  variant: "default",
                  action: () => setPendingClose(null),
                },
                {
                  label: "保存",
                  variant: "primary",
                  action: handleSaveAndClose,
                },
              ]}
            />
          );
        })()}
    </div>
  );
}
