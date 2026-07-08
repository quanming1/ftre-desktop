/**
 * InspectorPanel — 右侧扩展面板（编辑器风格）
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { X, FileText, Loader2, GitCompareArrows, ListTree } from "lucide-react";
import { OverlayScrollbarsComponent, type OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { useInspector, type InspectorTab } from "@/stores/inspector";
import { CodeEditorWidget, MonacoDiffViewer, type CodeEditorFile } from "@ftre/editor";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { ResizeHandle } from "@/components/ResizeHandle";
import { useLayout } from "@/stores/layout";
import { FileTreeSidebar } from "./FileTreeSidebar";
import { FileIconView } from "@/components/FileIconView";

/** path → CodeEditorFile 内存缓存，切回已加载的 tab 秒切 */
const fileCache = new Map<string, CodeEditorFile>();

export function InspectorPanel() {
  const tabs = useInspector((s) => s.tabs);
  const activeTabId = useInspector((s) => s.activeTabId);
  const setActiveTab = useInspector((s) => s.setActiveTab);
  const closeTab = useInspector((s) => s.closeTab);
  const closeOtherTabs = useInspector((s) => s.closeOtherTabs);
  const closeTabsToRight = useInspector((s) => s.closeTabsToRight);
  const closeAllTabs = useInspector((s) => s.closeAllTabs);
  const fileTreeOpen = useInspector((s) => s.fileTreeOpen);
  const toggleFileTree = useInspector((s) => s.toggleFileTree);
  const fileTreeWidth = useLayout((s) => s.fileTreeWidth);
  const setFileTreeWidth = useLayout((s) => s.setFileTreeWidth);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

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
        fileTreeOpen={fileTreeOpen}
        onToggleFileTree={toggleFileTree}
      />
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {fileTreeOpen && (
          <>
            <div className="shrink-0 border-r border-border overflow-hidden" style={{ width: fileTreeWidth, background: "#f9fafb" }}>
              <FileTreeSidebar />
            </div>
            <ResizeHandle
              direction="horizontal"
              onResize={(delta) => {
                setFileTreeWidth(fileTreeWidth + delta);
                return delta;
              }}
            />
          </>
        )}
        <div className="flex-1 min-w-0 overflow-hidden bg-surface relative">
          {tabs.length === 0 ? (
            <EmptyState />
          ) : (
            tabs.map((tab) => (
              <div
                key={tab.id}
                className="absolute inset-0"
                style={{ display: tab.id === activeTabId ? "block" : "none" }}
              >
                <div className="h-full w-full">
                  <InspectorTabContent tab={tab} active={tab.id === activeTabId} />
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
  fileTreeOpen: boolean;
  onToggleFileTree: () => void;
}) {
  const overlayRef = useRef<OverlayScrollbarsComponentRef | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    tabId: string;
  } | null>(null);

  const getScrollElement = useCallback((): HTMLElement | null => {
    const osInstance = overlayRef.current?.osInstance();
    return osInstance?.elements()?.viewport ?? null;
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const container = getScrollElement();
      if (container) {
        container.scrollLeft += e.deltaY;
      }
    },
    [getScrollElement],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, tabId });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const getContextMenuItems = useCallback(
    (tabId: string): ContextMenuItem[] => [
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
    ],
    [onClose, onCloseOthers, onCloseRight, onCloseAll],
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
      <OverlayScrollbarsComponent
        ref={overlayRef}
        defer
        options={{
          overflow: { x: "scroll", y: "hidden" },
          scrollbars: { autoHide: "leave", autoHideDelay: 120 },
        }}
        className="flex-1 min-w-0 h-full"
        onWheel={handleWheel}
      >
        <div className="flex items-end justify-start h-full min-w-max">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const filePath = tab.filePath ?? tab.title;
            return (
              <button
                key={tab.id}
                onClick={() => onActivate(tab.id)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                  }
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(tab.id);
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                className={`group relative flex items-center gap-2 h-full text-[13px] whitespace-nowrap font-sans transition-all duration-150 select-none px-3.5 ${
                  isActive
                    ? "z-10 bg-surface text-t-primary shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                    : "text-t-muted hover:bg-elevated hover:text-t-secondary"
                }`}
              >
                {isActive && (
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-white/40" />
                )}
                {tab.type === "diff" ? (
                  <GitCompareArrows size={15} className="shrink-0 text-t-ghost" />
                ) : tab.type === "image" ? (
                  <FileIconView path={filePath} size={16} />
                ) : (
                  <FileIconView path={filePath} size={16} />
                )}
                <span className="max-w-[180px] truncate">{tab.title}</span>
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
          })}
        </div>
      </OverlayScrollbarsComponent>
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

function InspectorTabContent({ tab, active }: { tab: InspectorTab; active: boolean }) {
  if (tab.type === "diff") {
    return <DiffPreviewContent tab={tab} active={active} />;
  }
  if (tab.type === "image") {
    return <ImagePreviewContent filePath={tab.filePath!} active={active} />;
  }
  return (
    <FilePreviewContent
      filePath={tab.filePath!}
      content={tab.content}
      revealLine={tab.revealLine}
      revealEndLine={tab.revealEndLine}
      revealNonce={tab.revealNonce}
      active={active}
    />
  );
}

function ImagePreviewContent({ filePath, active }: { filePath: string; active: boolean }) {
  const displayPath = filePath.replace(/\\/g, "/");
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setSrc(null);
    setError(false);
    window.desktop.fs.readImageBase64(filePath).then((result) => {
      if (result.error || !result.dataUrl) {
        setError(true);
      } else {
        setSrc(result.dataUrl);
      }
    });
  }, [filePath]);

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-3 py-1.5 border-b border-border shrink-0 flex items-baseline gap-2 bg-surface overflow-hidden">
        <span className="text-[12px] font-mono text-t-ghost truncate min-w-0" title={filePath}>
          {displayPath}
        </span>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-auto p-4">
        {error ? (
          <p className="text-sm text-red-500">无法加载图片</p>
        ) : src ? (
          <img
            src={src}
            alt={displayPath}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <Loader2 size={20} className="animate-spin text-t-ghost" />
        )}
      </div>
    </div>
  );
}

function DiffPreviewContent({ tab, active }: { tab: InspectorTab; active: boolean }) {
  const displayPath = (tab.filePath ?? "").replace(/\\/g, "/");
  const containerRef = useRef<HTMLDivElement>(null);
  const language = useMemo(() => {
    const ext = displayPath.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
    const map: Record<string, string> = {
      ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
      py: "python", json: "json", md: "markdown", go: "go", rs: "rust",
      java: "java", c: "c", cpp: "cpp", sh: "shell", yml: "yaml", yaml: "yaml",
    };
    return map[ext] ?? "plaintext";
  }, [displayPath]);

  // tab 变为活跃时触发 layout，让 Monaco 重新计算尺寸
  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent("ftre:editor-layout", { detail: {} }));
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [active]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface">
      <div className="px-3 py-1.5 border-b border-border shrink-0 flex items-baseline gap-2 bg-surface overflow-hidden">
        <GitCompareArrows size={13} className="text-t-ghost shrink-0 self-center" />
        <span className="text-[12px] font-mono text-t-ghost truncate min-w-0" title={tab.filePath ?? ""}>
          {displayPath}
        </span>
        {tab.additions > 0 && (
          <span className="text-[11px] font-mono text-green-600 shrink-0">+{tab.additions}</span>
        )}
        {tab.deletions > 0 && (
          <span className="text-[11px] font-mono text-red-500 shrink-0">-{tab.deletions}</span>
        )}
      </div>
      <div className="flex-1 min-h-0 relative bg-surface">
        {tab.before !== null && tab.after !== null && (
          <MonacoDiffViewer
            diff={{
              id: tab.id,
              filePath: tab.filePath ?? "",
              tabPath: tab.filePath ?? "",
              originalContent: tab.before,
              newContent: tab.after,
              toolName: "edit",
              isApproximate: false,
            }}
            language={language}
            renderSideBySide={true}
            theme="ftre-light"
            revealNonce={tab.revealNonce}
          />
        )}
      </div>
    </div>
  );
}

/**
 * 文件预览内容：优先使用 content 快照（来自 read 工具 metadata），
 * 无快照时从磁盘读取。fileCache 缓存已加载文件，切回时秒切。
 * 文件加载完成后，如果有 revealLine 则自动跳转并选中。
 */
function FilePreviewContent({ filePath, content, revealLine, revealEndLine, revealNonce, active }: {
  filePath: string;
  content?: string | null;
  revealLine?: number;
  revealEndLine?: number;
  revealNonce: number;
  active: boolean;
}) {
  // 有 content 快照时直接使用，不走磁盘读取和缓存
  const snapshotFile = useMemo<CodeEditorFile | null>(() => {
    if (content == null) return null;
    const name = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
    return {
      path: filePath,
      name,
      language: detectLanguage(filePath),
      content,
      loaded: true,
    };
  }, [content, filePath]);

  const [file, setFile] = useState<CodeEditorFile | null>(
    () => snapshotFile ?? fileCache.get(filePath) ?? null,
  );
  const [loading, setLoading] = useState(
    snapshotFile == null && !fileCache.has(filePath),
  );
  const [error, setError] = useState<string | null>(null);

  const loadFile = useCallback(async (path: string) => {
    const cached = fileCache.get(path);
    if (cached) {
      setFile(cached);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await window.desktop.fs.readFile(path);
      if (result.error) {
        setError(result.error);
      } else {
        const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
        const f: CodeEditorFile = {
          path,
          name,
          language: result.language || "plaintext",
          content: result.content ?? "",
          loaded: true,
        };
        fileCache.set(path, f);
        setFile(f);
      }
    } catch (e) {
      setError(`无法读取文件: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (snapshotFile) {
      setFile(snapshotFile);
      setLoading(false);
      setError(null);
    } else {
      loadFile(filePath);
    }
  }, [filePath, loadFile, snapshotFile]);

  // 文件加载完成后，如果有 revealLine 则跳转并选中；revealNonce 变化时也重新定位
  useEffect(() => {
    if (!file || !revealLine || revealLine <= 0) return;
    const timer = setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("ftre:goto-line", {
          detail: {
            filePath,
            line: revealLine,
            col: 1,
            endLine: revealEndLine && revealEndLine > 0 ? revealEndLine : undefined,
          },
        }),
      );
    }, 100);
    return () => clearTimeout(timer);
  }, [file, filePath, revealLine, revealEndLine, revealNonce]);

  // tab 变为活跃时触发 layout
  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent("ftre:editor-layout", { detail: {} }));
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [active]);

  // 加载中 / 出错时仍保持 editor 挂载（如果有已缓存文件），只叠加遮罩
  const lineCount = file?.content ? file.content.split("\n").length : 0;
  const byteSize = file?.content ? new Blob([file.content]).size : 0;
  const displayPath = filePath.replace(/\\/g, "/");

  return (
    <div className="flex flex-col h-full bg-surface relative">
      {/* 文件信息 */}
      <div className="px-3 py-1.5 border-b border-border shrink-0 flex items-baseline gap-2 bg-surface overflow-hidden">
        <span className="text-[12px] font-mono text-t-ghost truncate min-w-0" title={filePath}>
          {displayPath}
        </span>
        {file && (
          <>
            <span className="text-[11px] font-mono text-t-faint shrink-0">{lineCount} lines</span>
            <span className="text-[11px] font-mono text-t-faint shrink-0">{formatBytes(byteSize)}</span>
          </>
        )}
      </div>

      {/* Monaco 编辑器 */}
      <div className="flex-1 overflow-hidden bg-surface">
        {file && (
          <CodeEditorWidget
            file={file}
            minimapEnabled={false}
            readOnly
            renderLineHighlight="none"
            theme="ftre-light"
          />
        )}
      </div>

      {/* 加载遮罩 */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-10">
          <Loader2 size={16} className="animate-spin text-t-ghost" />
        </div>
      )}

      {/* 错误遮罩 */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-10 p-4">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center flex-col gap-2 bg-surface text-t-ghost">
      <FileText size={28} strokeWidth={1.5} />
      <div className="text-[13px] font-mono">暂无预览内容</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function detectLanguage(filePath: string): string {
  const ext = filePath.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", json: "json", md: "markdown", go: "go", rs: "rust",
    java: "java", c: "c", cpp: "cpp", sh: "shell", yml: "yaml", yaml: "yaml",
    html: "html", css: "css", xml: "xml", sql: "sql", toml: "ini",
  };
  return map[ext] ?? "plaintext";
}
