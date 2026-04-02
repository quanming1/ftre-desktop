import { useEffect, useCallback, useState } from "react";
import { X, Code2, FileText } from "lucide-react";
import { useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import { useNotification } from "@/stores/notification";
import { editorCore, editorManager } from "@ftre/editor/core";
import { ManagedEditor, MonacoDiffViewer, DiffBar } from "@ftre/editor/ui";
import { handleOpenFile } from "@/features/chat/toolActions";
import { Breadcrumb } from "./Breadcrumb";
import { TabBar } from "./TabBar";

interface EditorAreaProps {
  onToggleFiles?: () => void;
}

export function EditorArea({ onToggleFiles }: EditorAreaProps) {
  const groups = useEditor((s) => s.groups);
  const activeGroupId = useEditor((s) => s.activeGroupId);
  const pendingDiffs = useEditor((s) => s.pendingDiffs);
  const minimapEnabled = useLayout((s) => s.minimapEnabled);
  const [sideBySide, setSideBySide] = useState(true);

  // Listen for split-editor event (Ctrl+\ dispatches splitEditor via default-shortcuts)
  useEffect(() => {
    const handleSplitEditor = () => {
      useEditor.getState().splitEditor();
    };
    window.addEventListener("ftre:split-editor", handleSplitEditor);
    return () =>
      window.removeEventListener("ftre:split-editor", handleSplitEditor);
  }, []);

  // Listen for file-renamed event — update open tabs across all groups + EditorManager slot pool
  useEffect(() => {
    const handler = (e: Event) => {
      const { oldPath, newPath, isDir } = (e as CustomEvent).detail;
      useEditor.getState().handleFileRenamed(oldPath, newPath, isDir);
      // 同步更新 EditorManager 的 slot/model/viewState 映射
      if (isDir) {
        // 目录重命名：EditorManager 没有批量 rename，逐个处理 slot 内命中的路径
        const slotPaths = editorManager.getSlotPaths();
        const oldPrefix =
          oldPath.endsWith("/") || oldPath.endsWith("\\")
            ? oldPath
            : oldPath + "/";
        for (const p of slotPaths) {
          if (
            p.startsWith(oldPrefix) ||
            p.replace(/\\/g, "/").startsWith(oldPrefix.replace(/\\/g, "/"))
          ) {
            const newFilePath = newPath + p.slice(oldPath.length);
            editorManager.handleFileRenamed(p, newFilePath);
          }
        }
      } else {
        editorManager.handleFileRenamed(oldPath, newPath);
      }
    };
    window.addEventListener("ftre:file-renamed", handler);
    return () => window.removeEventListener("ftre:file-renamed", handler);
  }, []);

  // Listen for file-deleted event — close tabs for deleted files across all groups + EditorManager slot pool
  useEffect(() => {
    const handler = (e: Event) => {
      const { path, isDir } = (e as CustomEvent).detail;
      useEditor.getState().handleFileDeleted(path, isDir);
      // 同步清理 EditorManager 中对应的 slot/model/viewState
      if (isDir) {
        editorManager.handleDirectoryDeleted(path);
      } else {
        editorManager.handleFileDeleted(path);
      }
    };
    window.addEventListener("ftre:file-deleted", handler);
    return () => window.removeEventListener("ftre:file-deleted", handler);
  }, []);

  // Listen for save-all event — save all modified files across all groups
  useEffect(() => {
    const handler = async () => {
      const state = useEditor.getState();
      for (const group of state.groups) {
        for (const f of group.openFiles) {
          if (f.modified) {
            // 从 editorCore 取最新内容，不用 store 中的 f.content（可能过时）
            const content = editorCore.resolveContent(f.path);
            const result = await window.desktop.fs.writeFile(f.path, content);
            if (result.success) {
              editorCore.setDiskContent(f.path, content);
              useEditor.getState().markSaved(f.path);
            }
          }
        }
      }
    };
    window.addEventListener("ftre:save-all", handler);
    return () => window.removeEventListener("ftre:save-all", handler);
  }, []);

  // ── File change watching ──────────────────────────────────────────
  // Windows 下 Workbench 已对 rootPath 建立 recursive watcher，这里不再为每个打开文件重复建 watcher，
  // 避免同一文件变化被 root watcher 和 file watcher 同时上报。

  // Listen for external file changes and auto-refresh or notify
  useEffect(() => {
    const cleanup = window.desktop?.fs.onFileChanged(
      async (filePath: string) => {
        const state = useEditor.getState();

        // Find the file across all groups
        let fileEntry: { modified: boolean } | undefined;
        for (const group of state.groups) {
          const found = group.openFiles.find((f) => f.path === filePath);
          if (found) {
            fileEntry = found;
            break;
          }
        }

        if (!fileEntry) return;

        if (!fileEntry.modified) {
          // Auto-refresh: read new content and update store
          try {
            const result = await window.desktop.fs.readFile(filePath);
            if (!result.error) {
              useEditor.getState().refreshFile(filePath, result.content);
            }
          } catch {
            // Silently ignore read errors for watcher refreshes
          }
        } else {
          // File has unsaved modifications — ask the user
          const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
          useNotification.getState().addNotification({
            level: "warning",
            message: `"${fileName}" 已被外部修改。是否重新加载？未保存的更改将丢失。`,
            actions: [
              {
                label: "重新加载",
                onClick: async () => {
                  try {
                    const result = await window.desktop.fs.readFile(filePath);
                    if (!result.error) {
                      useEditor
                        .getState()
                        .refreshFile(filePath, result.content);
                    }
                  } catch {
                    // ignore
                  }
                },
              },
              {
                label: "保留本地",
                onClick: () => {
                  // No-op: user keeps their local changes
                },
              },
            ],
          });
        }
      },
    );

    return () => {
      cleanup?.();
    };
  }, []);

  const handleGroupClick = useCallback((groupId: string) => {
    useEditor.getState().setActiveGroup(groupId);
  }, []);

  const handleCloseGroup = useCallback((groupId: string) => {
    useEditor.getState().closeGroup(groupId);
  }, []);

  const handleOpenSourceFile = useCallback((filePath: string) => {
    handleOpenFile(filePath);
  }, []);

  return (
    <div className="h-full bg-surface flex flex-row overflow-hidden">
      {groups.map((group, index) => {
        const isActive = group.id === activeGroupId;
        const currentFile = group.openFiles.find(
          (f) => f.path === group.activeFile,
        );
        const showCloseButton = groups.length > 1;

        return (
          <div
            key={group.id}
            className={`flex-1 min-w-0 flex flex-col overflow-hidden ${index > 0 ? "border-l border-border" : ""} ${isActive ? "" : "opacity-90"}`}
            onClick={() => handleGroupClick(group.id)}
            data-testid={`editor-group-${group.id}`}
            data-group-id={group.id}
          >
            {/* Group header: TabBar + optional close button */}
            <div className="flex items-stretch shrink-0">
              <div className="flex-1 min-w-0">
                <TabBar
                  groupId={group.id}
                  onToggleFiles={index === 0 ? onToggleFiles : undefined}
                />
              </div>
              {showCloseButton && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseGroup(group.id);
                  }}
                  className="flex items-center justify-center w-[38px] bg-base text-t-muted hover:text-t-primary hover:bg-white/[0.06] transition-colors duration-150 shrink-0 border-b border-border"
                  aria-label={`关闭编辑器组 ${group.id}`}
                  data-testid={`close-group-${group.id}`}
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              )}
            </div>

            {/* Editor content */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {currentFile ? (
                <>
                  <Breadcrumb groupId={group.id} />
                  <div className="flex-1 overflow-hidden">
                    {(() => {
                      const activeDiff = pendingDiffs.find(
                        (d) => d.tabPath === currentFile.path,
                      );
                      return activeDiff ? (
                        <>
                          <DiffBar
                            diff={activeDiff}
                            renderSideBySide={sideBySide}
                            onToggleMode={() => setSideBySide(!sideBySide)}
                            onOpenSourceFile={handleOpenSourceFile}
                          />
                          <MonacoDiffViewer
                            diff={activeDiff}
                            language={currentFile.language}
                            renderSideBySide={sideBySide}
                          />
                        </>
                      ) : (
                        <ManagedEditor
                          file={currentFile}
                          minimapEnabled={minimapEnabled}
                        />
                      );
                    })()}
                  </div>
                </>
              ) : (
                <WelcomePlaceholder />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Welcome placeholder shown when no file is open in a group */
function WelcomePlaceholder() {
  const recentFiles = useEditor((s) => s.recentFiles);

  const [loadingRecent, setLoadingRecent] = useState<string | null>(null);

  const handleOpenRecent = async (filePath: string) => {
    if (loadingRecent) return; // 防止重复点击
    setLoadingRecent(filePath);
    try {
      const result = await window.desktop.fs.readFile(filePath);
      if (result.error) {
        // 文件不存在或读取失败 — 通知用户并从最近文件列表中移除
        useNotification.getState().addNotification({
          level: "error",
          message: `无法打开文件：${filePath}`,
        });
        useEditor.getState().removeRecentFile(filePath);
        return;
      }
      const name = filePath.split(/[\\/]/).pop() ?? filePath;
      useEditor.getState().openFile({
        path: filePath,
        name,
        language: result.language || "plaintext",
        content: result.content,
      });
    } catch {
      useNotification.getState().addNotification({
        level: "error",
        message: `无法读取文件：${filePath}`,
      });
    } finally {
      setLoadingRecent(null);
    }
  };

  const shortcuts = [
    { keys: "Ctrl+P", description: "跳转到文件" },
    { keys: "Ctrl+Shift+P", description: "命令面板" },
    { keys: "Ctrl+Shift+F", description: "在文件中搜索" },
    { keys: "Ctrl+`", description: "切换终端" },
    { keys: "Ctrl+B", description: "切换侧边栏" },
    { keys: "Ctrl+\\", description: "拆分编辑器" },
    { keys: "切换小地图", description: "通过命令面板" },
  ];

  return (
    <div
      className="h-full flex items-center justify-center flex-col gap-6"
      data-testid="welcome-placeholder"
    >
      {/* App Logo */}
      <div className="flex flex-col items-center gap-2">
        <Code2 size={48} className="text-t-muted" strokeWidth={1} />
        <div className="text-[24px] text-t-secondary font-mono tracking-wider">
          Ftre
        </div>
        <div className="text-[13px] text-t-muted font-mono">
          AI 原生代码编辑器
        </div>
      </div>

      {/* Recent Files */}
      {recentFiles.length > 0 && (
        <div
          className="flex flex-col gap-1.5 mt-2 w-72"
          data-testid="recent-files-section"
        >
          <div className="text-[12px] text-t-muted font-mono uppercase tracking-wider mb-1.5">
            最近的文件
          </div>
          {recentFiles.slice(0, 8).map((filePath) => (
            <button
              key={filePath}
              onClick={() => handleOpenRecent(filePath)}
              disabled={loadingRecent === filePath}
              className={`flex items-center gap-2.5 text-[13px] text-t-secondary font-mono hover:text-t-primary hover:bg-white/[0.04] px-2.5 py-1.5 rounded-md transition-colors duration-150 text-left truncate${loadingRecent === filePath ? " opacity-50 pointer-events-none" : ""}`}
              title={filePath}
              data-testid={`recent-file-${filePath}`}
            >
              <FileText size={14} className="shrink-0 text-t-muted" />
              <span className="truncate">{filePath.split("/").pop()}</span>
              <span className="text-[11px] text-t-dim truncate ml-auto">
                {filePath}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Keyboard Shortcuts */}
      <div
        className="flex flex-col gap-2.5 mt-2 text-[12px] text-t-muted font-mono"
        data-testid="shortcuts-section"
      >
        {shortcuts.map((s) => (
          <div key={s.keys} className="flex items-center gap-3.5">
            <span className="text-t-muted bg-panel px-2 py-1 rounded-md text-[11px] min-w-[110px] text-right">
              {s.keys}
            </span>
            <span>{s.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
