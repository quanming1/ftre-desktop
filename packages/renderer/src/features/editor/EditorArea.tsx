/**
 * EditorArea — 编辑器区域组件
 *
 * 使用简化版 SimpleEditor 组件，支持：
 * - 多编辑器组（分屏）
 * - 文件切换
 * - Diff 视图
 * - Settings 面板
 */

import { useEffect, useCallback, useState, useRef } from "react";
import { X, Code2, FileText } from "lucide-react";
import { useEditor, SETTINGS_PATH } from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import { useNotification } from "@/stores/notification";
import { useChat } from "@/stores/chat";
import {
  CodeEditorWidget,
  SettingsEditorWidget,
  MonacoDiffViewer,
  DiffBar,
  getTextModelResolverService,
  wasRecentlySaved,
  type MonacoDiffViewerHandle,
} from "@ftre/editor";
import { SettingsPanel } from "@/features/settings";
import { Breadcrumb } from "./Breadcrumb";
import { TabBar } from "./TabBar";

/**
 * 加载未 hydrate 的文件内容
 * 当从持久化状态恢复时，非 active 的 tab 的 loaded 为 false
 * 用户点击这些 tab 时需要加载文件内容
 */

// 当前正在进行的 hydrate 请求 ID，用于竞态控制
let currentHydrateRequestId = 0;
const pendingHydrate = new Map<string, Promise<void>>();

async function hydrateFileIfNeeded(filePath: string) {
  // 检查是否已有进行中的请求
  if (pendingHydrate.has(filePath)) {
    return pendingHydrate.get(filePath);
  }

  const requestId = ++currentHydrateRequestId;

  const hydratePromise = (async () => {
    try {
      const state = useEditor.getState();
      let file: { loaded: boolean; language: string } | undefined;

      for (const group of state.groups) {
        const found = group.openFiles.find((f) => f.path === filePath);
        if (found) {
          file = found;
          break;
        }
      }

      if (!file || file.loaded) return;

      // 跳过虚拟路径
      if (
        filePath.startsWith("ftre://") ||
        filePath.startsWith("diff:") ||
        filePath.startsWith("untitled:")
      ) {
        return;
      }

      // 读取文件内容
      let content: string;
      let language: string | undefined;

      try {
        const result = await window.desktop.fs.readFile(filePath);
        if (result.error) {
          // 文件不存在或无法读取
          console.warn(`Failed to load file ${filePath}:`, result.error);
          // 标记为已加载（加载失败）但保持空内容，避免一直 Loading
          useEditor
            .getState()
            .hydrateFileContent(filePath, "", file.language);
          
          // 可选：显示通知
          useNotification.getState().addNotification({
            level: "warning",
            message: `无法加载文件：${filePath}`,
          });
          return;
        }
        content = result.content;
        language = result.language;
      } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        // 标记为已加载（加载失败）
        useEditor
          .getState()
          .hydrateFileContent(filePath, "", file.language);
        return;
      }

      // 检查是否被后续请求覆盖（竞态控制）
      if (requestId !== currentHydrateRequestId) {
        return;
      }

      useEditor
        .getState()
        .hydrateFileContent(filePath, content, language || file.language);
    } finally {
      pendingHydrate.delete(filePath);
    }
  })();

  pendingHydrate.set(filePath, hydratePromise);
  return hydratePromise;
}

export function EditorArea() {
  const groups = useEditor((s) => s.groups);
  const activeGroupId = useEditor((s) => s.activeGroupId);
  const pendingDiffs = useEditor((s) => s.pendingDiffs);
  const minimapEnabled = useLayout((s) => s.minimapEnabled);
  const [sideBySide, setSideBySide] = useState(true);
  const diffViewerRef = useRef<MonacoDiffViewerHandle>(null);

  // Hydrate unloaded files when they become active
  useEffect(() => {
    for (const group of groups) {
      if (group.activeFile) {
        const file = group.openFiles.find((f) => f.path === group.activeFile);
        if (file && !file.loaded) {
          hydrateFileIfNeeded(group.activeFile);
        }
      }
    }
  }, [groups]);

  // Listen for split-editor event
  useEffect(() => {
    const handleSplitEditor = () => {
      useEditor.getState().splitEditor();
    };
    window.addEventListener("ftre:split-editor", handleSplitEditor);
    return () =>
      window.removeEventListener("ftre:split-editor", handleSplitEditor);
  }, []);

  // Listen for file-renamed event
  useEffect(() => {
    const handler = (e: Event) => {
      const { oldPath, newPath, isDir } = (e as CustomEvent).detail;
      useEditor.getState().handleFileRenamed(oldPath, newPath, isDir);

      // 同步更新 TextModelResolverService
      const modelService = getTextModelResolverService();
      if (modelService.isInitialized()) {
        modelService.rename(oldPath, newPath);
      }
    };
    window.addEventListener("ftre:file-renamed", handler);
    return () => window.removeEventListener("ftre:file-renamed", handler);
  }, []);

  // Listen for file-deleted event
  useEffect(() => {
    const handler = (e: Event) => {
      const { path, isDir } = (e as CustomEvent).detail;
      useEditor.getState().handleFileDeleted(path, isDir);

      // 同步清理 TextModelResolverService
      const modelService = getTextModelResolverService();
      if (modelService.isInitialized()) {
        modelService.disposeModel(path);
      }
    };
    window.addEventListener("ftre:file-deleted", handler);
    return () => window.removeEventListener("ftre:file-deleted", handler);
  }, []);

  // Listen for save-all event
  useEffect(() => {
    const handler = async () => {
      const modelService = getTextModelResolverService();
      if (!modelService.isInitialized()) return;

      const dirtyUris = modelService.getDirtyUris();
      for (const uri of dirtyUris) {
        const content = modelService.getContentForSave(uri);
        if (content !== undefined) {
          const result = await window.desktop.fs.writeFile(uri, content);
          if (result.success) {
            modelService.markSaved(uri);
            useEditor.getState().markSaved(uri);
          }
        }
      }
    };
    window.addEventListener("ftre:save-all", handler);
    return () => window.removeEventListener("ftre:save-all", handler);
  }, []);

  // Listen for external file changes
  useEffect(() => {
    const cleanup = window.desktop?.fs.onFileChanged(
      async (filePath: string) => {
        if (wasRecentlySaved(filePath)) return;

        const state = useEditor.getState();
        let fileEntry: { modified: boolean } | undefined;

        for (const group of state.groups) {
          const found = group.openFiles.find((f) => f.path === filePath);
          if (found) {
            fileEntry = found;
            break;
          }
        }

        if (!fileEntry) return;

        const modelService = getTextModelResolverService();
        const isDirty =
          modelService.isInitialized() && modelService.isDirty(filePath);

        if (!isDirty) {
          try {
            const result = await window.desktop.fs.readFile(filePath);
            if (!result.error) {
              // 更新 TextModelResolverService
              if (modelService.isInitialized()) {
                modelService.updateContent(filePath, result.content);
              }
              useEditor.getState().refreshFile(filePath, result.content);
            }
          } catch {
            // ignore
          }
        } else {
          const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
          useNotification.getState().addNotification({
            level: "warning",
            message: `"${fileName}" 已被外部修改。是否重新加载？`,
            actions: [
              {
                label: "重新加载",
                onClick: async () => {
                  try {
                    const result = await window.desktop.fs.readFile(filePath);
                    if (!result.error) {
                      // 更新 TextModelResolverService（updateContent 会同时更新 savedVersionId）
                      if (modelService.isInitialized()) {
                        modelService.updateContent(filePath, result.content);
                      }
                      useEditor
                        .getState()
                        .refreshFile(filePath, result.content);
                    }
                  } catch {
                    // ignore
                  }
                },
              },
              { label: "保留本地", onClick: () => {} },
            ],
          });
        }
      },
    );
    return () => cleanup?.();
  }, []);

  const handleGroupClick = useCallback((groupId: string) => {
    useEditor.getState().setActiveGroup(groupId);
  }, []);

  const handleCloseGroup = useCallback((groupId: string) => {
    useEditor.getState().closeGroup(groupId);
  }, []);

  const handleOpenSourceFile = useCallback(async (filePath: string) => {
    try {
      // 1. 获取当前 diff 视图的行号
      const currentLine = diffViewerRef.current?.getCurrentLine() ?? 1;

      // 2. 读取文件内容
      const result = await window.desktop.fs.readFile(filePath);
      if (result.error) {
        console.error("Failed to read file:", result.error);
        return;
      }

      // 3. 关闭 diff tab
      useEditor.getState().rejectDiff(filePath);

      // 4. 打开源文件
      useEditor.getState().openFile({
        path: filePath,
        name: filePath.split(/[\\/]/).pop() ?? filePath,
        language: result.language,
        content: result.content,
      });

      // 5. 跳转到对应行号（延迟执行，等待编辑器挂载）
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("ftre:reveal-line", {
            detail: { filePath, line: currentLine, col: 1 },
          }),
        );
      }, 100);
    } catch (error) {
      console.error("Failed to open source file:", error);
    }
  }, []);

  const handleSaveFile = useCallback(
    async (path: string, content: string): Promise<boolean> => {
      const result = await window.desktop.fs.writeFile(path, content);
      if (result.success) {
        useEditor.getState().markSaved(path);
      }
      return result.success;
    },
    [],
  );

  const handleDirtyChange = useCallback((path: string, dirty: boolean) => {
    useEditor.getState().setModified(path, dirty);
  }, []);

  const handleAddToChat = useCallback((message: string) => {
    useChat.getState().addUserMessage(message);
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
            {/* Group header */}
            <div className="flex items-stretch shrink-0">
              <div className="flex-1 min-w-0">
                <TabBar groupId={group.id} />
              </div>
              {showCloseButton && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseGroup(group.id);
                  }}
                  className="flex items-center justify-center w-[38px] bg-base text-t-muted hover:text-t-primary hover:bg-white/[0.06] transition-colors duration-150 shrink-0"
                  aria-label={`关闭编辑器组 ${group.id}`}
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              )}
            </div>

            {/* Editor content */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {currentFile ? (
                <>
                  {currentFile.path !== SETTINGS_PATH && (
                    <Breadcrumb groupId={group.id} />
                  )}
                  <div className="flex-1 overflow-hidden relative">
                    {/* Settings editor - keep mounted when Settings tab exists in group */}
                    {group.openFiles.some(
                      (f) => f.path === SETTINGS_PATH,
                    ) && (
                      <div
                        className="absolute inset-0"
                        style={{
                          display:
                            currentFile.path === SETTINGS_PATH
                              ? "block"
                              : "none",
                        }}
                      >
                        <SettingsEditorWidget
                          groupId={parseInt(group.id, 10) || 0}
                          renderSettings={() => <SettingsPanel />}
                        />
                      </div>
                    )}

                    {/* Diff viewer */}
                    {currentFile.path !== SETTINGS_PATH &&
                      (() => {
                        const activeDiff = pendingDiffs.find(
                          (d) => d.tabPath === currentFile.path,
                        );
                        if (activeDiff) {
                          return (
                            <>
                              <DiffBar
                                diff={activeDiff}
                                renderSideBySide={sideBySide}
                                onToggleMode={() => setSideBySide(!sideBySide)}
                                onOpenSourceFile={handleOpenSourceFile}
                              />
                              <MonacoDiffViewer
                                ref={diffViewerRef}
                                key={activeDiff.id}
                                diff={activeDiff}
                                language={currentFile.language}
                                renderSideBySide={sideBySide}
                              />
                            </>
                          );
                        }
                        return null;
                      })()}

                    {/* Normal file editor */}
                    {currentFile.path !== SETTINGS_PATH &&
                      !pendingDiffs.some(
                        (d) => d.tabPath === currentFile.path,
                      ) && (
                        <CodeEditorWidget
                          file={{
                            path: currentFile.path,
                            name: currentFile.name,
                            language: currentFile.language,
                            content: currentFile.content,
                            loaded: currentFile.loaded,
                          }}
                          minimapEnabled={minimapEnabled}
                          onSave={handleSaveFile}
                          onDirtyChange={handleDirtyChange}
                          onAddToChat={handleAddToChat}
                          onCursorChange={(line, col) => {
                            window.dispatchEvent(
                              new CustomEvent("ftre:cursor-change", {
                                detail: { line, col },
                              }),
                            );
                          }}
                        />
                      )}
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

/** Welcome placeholder */
function WelcomePlaceholder() {
  const recentFiles = useEditor((s) => s.recentFiles);
  const [loadingRecent, setLoadingRecent] = useState<string | null>(null);

  const handleOpenRecent = async (filePath: string) => {
    if (loadingRecent) return;
    setLoadingRecent(filePath);
    try {
      const result = await window.desktop.fs.readFile(filePath);
      if (result.error) {
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
  ];

  return (
    <div
      className="h-full flex items-center justify-center flex-col gap-6"
      data-testid="welcome-placeholder"
    >
      <div className="flex flex-col items-center gap-2">
        <Code2 size={48} className="text-t-muted" strokeWidth={1} />
        <div className="text-[24px] text-t-secondary font-mono tracking-wider">
          Ftre
        </div>
        <div className="text-[13px] text-t-muted font-mono">
          AI 原生代码编辑器
        </div>
      </div>

      {recentFiles.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-2 w-72">
          <div className="text-[12px] text-t-muted font-mono uppercase tracking-wider mb-1.5">
            最近的文件
          </div>
          {recentFiles.slice(0, 8).map((filePath) => (
            <button
              key={filePath}
              onClick={() => handleOpenRecent(filePath)}
              disabled={loadingRecent === filePath}
              className={`flex items-center gap-2.5 text-[13px] text-t-secondary font-mono hover:text-t-primary hover:bg-white/[0.04] px-2.5 py-1.5 rounded-md transition-colors text-left truncate${loadingRecent === filePath ? " opacity-50" : ""}`}
              title={filePath}
            >
              <FileText size={14} className="shrink-0 text-t-muted" />
              <span className="truncate">{filePath.split("/").pop()}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2.5 mt-2 text-[12px] text-t-muted font-mono">
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
