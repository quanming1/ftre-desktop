import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { X, FolderOpen, ChevronLeft, ChevronRight, Pin } from "lucide-react";
import { getFileIcon } from "./file-icons";

/** Represents an open file tab */
export interface TabFile {
  path: string;
  name: string;
  modified: boolean;
  pinned: boolean;
}

/** Represents a group of tabs */
export interface TabGroup {
  id: string;
  openFiles: TabFile[];
  activeFile: string | null;
}

/** Context menu item for tab actions */
export interface TabContextMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  separator?: boolean;
  disabled?: boolean;
  action: () => void;
}

export interface TabBarProps {
  /** Optional group ID; if not provided, uses activeGroupId */
  groupId?: string;
  /** All editor groups */
  groups: TabGroup[];
  /** Currently active group ID */
  activeGroupId: string;
  /** Callback when file browser toggle is clicked */
  onToggleFiles?: () => void;

  // Tab actions
  /** Set a file as active */
  setActive: (path: string) => void;
  /** Close a file */
  closeFile: (path: string) => void;
  /** Close all files except the specified one */
  closeOtherFiles: (path: string) => void;
  /** Close all files to the right of the specified one */
  closeFilesToRight: (path: string) => void;
  /** Close all saved (unmodified) files */
  closeSavedFiles: () => void;
  /** Pin a file */
  pinFile: (path: string) => void;
  /** Unpin a file */
  unpinFile: (path: string) => void;
  /** Reorder tabs within a group */
  reorderTabs: (groupId: string, fromIndex: number, toIndex: number) => void;

  // File operations (provided by host)
  /** Save a file - returns promise that resolves when done */
  saveFile: (path: string, name: string, resolveContent: () => string) => Promise<void>;
  /** Resolve content for a file path */
  resolveContent: (path: string) => string;

  // UI customization (render props)
  /** Render context menu - if not provided, default context menu is disabled */
  renderContextMenu?: (props: {
    items: TabContextMenuItem[];
    position: { x: number; y: number };
    onClose: () => void;
  }) => ReactNode;
  /** Render confirm dialog - if not provided, unsaved changes warning is disabled */
  renderConfirmDialog?: (props: {
    title: string;
    message: string;
    buttons: Array<{
      label: string;
      variant: "default" | "danger" | "primary";
      action: () => void;
    }>;
  }) => ReactNode;

  // Optional: reveal in sidebar action
  onRevealInSidebar?: (path: string) => void;
}

export function TabBar({
  groupId,
  groups,
  activeGroupId,
  onToggleFiles,
  setActive,
  closeFile,
  closeOtherFiles,
  closeFilesToRight,
  closeSavedFiles,
  pinFile,
  unpinFile,
  reorderTabs,
  saveFile,
  resolveContent,
  renderContextMenu,
  renderConfirmDialog,
  onRevealInSidebar,
}: TabBarProps) {
  // Resolve which group to display: explicit groupId prop, or fall back to active group
  const resolvedGroupId = groupId ?? activeGroupId;
  const group = groups.find((g) => g.id === resolvedGroupId) ?? groups[0];
  const openFiles = group?.openFiles ?? [];
  const activeFile = group?.activeFile ?? null;

  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<string | null>(null);

  /** Close file entry — shows confirmation if unsaved */
  const requestClose = useCallback(
    (filePath: string) => {
      const file = openFiles.find((f) => f.path === filePath);
      if (file?.modified && renderConfirmDialog) {
        setPendingClose(filePath);
      } else {
        closeFile(filePath);
      }
    },
    [openFiles, closeFile, renderConfirmDialog],
  );

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    filePath: string;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, filePath: string) => {
      e.preventDefault();
      if (renderContextMenu) {
        setContextMenu({ position: { x: e.clientX, y: e.clientY }, filePath });
      }
    },
    [renderContextMenu],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const getContextMenuItems = useCallback(
    (filePath: string): TabContextMenuItem[] => {
      const file = openFiles.find((f) => f.path === filePath);
      const isPinned = file?.pinned ?? false;

      const items: TabContextMenuItem[] = [
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
      ];

      if (onRevealInSidebar) {
        items.push({
          id: "reveal-in-sidebar",
          label: "在侧边栏中定位",
          action: () => onRevealInSidebar(filePath),
        });
      }

      return items;
    },
    [
      openFiles,
      requestClose,
      closeOtherFiles,
      closeFilesToRight,
      closeSavedFiles,
      pinFile,
      unpinFile,
      onRevealInSidebar,
    ],
  );

  // Drag-and-drop state — use ref for dragIndex to avoid stale closures
  const dragIndexRef = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(null);

  // Overflow scroll state
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = tabsContainerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => updateScrollState());
    observer.observe(el);
    el.addEventListener("scroll", updateScrollState);
    updateScrollState();

    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", updateScrollState);
    };
  }, [updateScrollState, openFiles.length]);

  const scrollTabs = useCallback((direction: "left" | "right") => {
    const el = tabsContainerRef.current;
    if (!el) return;
    const amount = direction === "left" ? -150 : 150;
    el.scrollBy({ left: amount, behavior: "instant" });
  }, []);

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
        reorderTabs(resolvedGroupId, currentDragIndex, toIndex);
      }

      dragIndexRef.current = null;
      setDragIndex(null);
      setDropIndicatorIndex(null);
    },
    [resolvedGroupId, reorderTabs],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const container = tabsContainerRef.current;
    if (container) {
      container.scrollLeft += e.deltaY;
    }
  }, []);

  const handleContainerDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
    },
    [],
  );

  // Handle pending close dialog
  const pendingCloseFile = pendingClose ? openFiles.find((f) => f.path === pendingClose) : null;

  // Clear pendingClose if the file was closed by other means
  useEffect(() => {
    if (pendingClose && !openFiles.find((f) => f.path === pendingClose)) {
      setPendingClose(null);
    }
  }, [pendingClose, openFiles]);

  const handleSaveAndClose = useCallback(() => {
    if (!pendingCloseFile) return;
    saveFile(pendingCloseFile.path, pendingCloseFile.name, () =>
      resolveContent(pendingCloseFile.path),
    )
      .then(() => closeFile(pendingCloseFile.path))
      .catch(() => {
        /* saveFile should handle errors internally */
      })
      .finally(() => setPendingClose(null));
  }, [pendingCloseFile, saveFile, resolveContent, closeFile]);

  return (
    <div className="h-[38px] bg-base flex items-end shrink-0">
      {/* File browser trigger */}
      <button
        onClick={onToggleFiles}
        className="flex items-center justify-center w-[38px] h-full text-t-muted hover:text-t-primary hover:bg-white/[0.06] transition-colors duration-150 shrink-0"
      >
        <FolderOpen size={15} strokeWidth={1.5} />
      </button>

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
      <div
        ref={tabsContainerRef}
        className="flex items-end flex-1 min-w-0 overflow-x-auto h-full relative scrollbar-none"
        onDragOver={handleContainerDragOver}
        onWheel={handleWheel}
      >
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
              className={`group relative flex items-center gap-2 h-full text-[13px] whitespace-nowrap font-sans transition-colors duration-150 border-r border-border select-none ${
                file.pinned ? "px-2.5" : "px-3.5"
              } ${isDragging ? "opacity-40" : ""} ${isActive ? "bg-surface text-t-primary" : "bg-base text-t-muted hover:bg-elevated hover:text-t-secondary"}`}
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
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-neon" />
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
      {contextMenu &&
        renderContextMenu &&
        renderContextMenu({
          items: getContextMenuItems(contextMenu.filePath),
          position: contextMenu.position,
          onClose: closeContextMenu,
        })}

      {/* Unsaved file close confirmation */}
      {pendingCloseFile &&
        renderConfirmDialog &&
        renderConfirmDialog({
          title: "未保存的更改",
          message: `"${pendingCloseFile.name}" 有未保存的更改，是否保存？`,
          buttons: [
            {
              label: "不保存",
              variant: "danger",
              action: () => {
                closeFile(pendingCloseFile.path);
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
          ],
        })}
    </div>
  );
}
