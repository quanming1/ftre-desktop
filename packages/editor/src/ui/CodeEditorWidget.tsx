/**
 * CodeEditorWidget - 基于新架构的 React 编辑器组件
 *
 * 使用新的 EditorPanes + TextCodeEditorPane 架构：
 * - EditorPanes 管理 EditorPane 实例池，支持复用
 * - TextCodeEditorPane 管理 Monaco Editor 实例
 * - FileEditorInput 表示要编辑的文件
 * - EditorMemento 持久化 ViewState
 *
 * 优势：
 * 1. 编辑器实例复用，不销毁重建
 * 2. ViewState 同步恢复，无可见滚动动画
 * 3. 清晰的分层架构，职责分离
 */

import { useRef, useCallback, useEffect, useLayoutEffect, memo } from "react";
import * as monaco from "monaco-editor";
import {
  EditorPanes,
  FileEditorInput,
  UntitledEditorInput,
  type IEditorOpenContext,
  type ITextEditorOptions,
  type IEditorGroup,
  saveAllEditorMementos,
  getTextModelResolverService,
  type TextCodeEditorPane,
} from "../workbench";
import {
  CodeEditorPaneFactory,
  type IContentStore,
  type ICodeEditorPaneFactoryOptions,
} from "./CodeEditorPaneFactory";
import { registerFtreTheme } from "./theme-registry";
import { getActiveThemeId } from "./themes";

// ═══════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════

export interface CodeEditorFile {
  /** 文件路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 语言 ID */
  language: string;
  /** 文件内容 */
  content: string;
  /** 是否已加载 */
  loaded: boolean;
}

export interface CodeEditorWidgetProps {
  /** 当前文件 */
  file: CodeEditorFile;
  /** minimap 是否启用 */
  minimapEnabled?: boolean;
  /** 内容变化回调 */
  onContentChange?: (path: string) => void;
  /** dirty 状态变化回调 */
  onDirtyChange?: (path: string, dirty: boolean) => void;
  /** 光标位置变化回调 */
  onCursorChange?: (line: number, column: number) => void;
  /** 保存文件回调 */
  onSave?: (path: string, content: string) => Promise<boolean>;
  /** 添加消息到聊天回调 */
  onAddToChat?: (message: string) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 创建一个简单的编辑器组实现
 */
function createSimpleEditorGroup(id: number): IEditorGroup {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const closeListeners: Array<(e: any) => void> = [];

  return {
    id,
    label: `Group ${id}`,
    activeEditor: undefined,
    onWillCloseEditor: (listener) => {
      closeListeners.push(listener);
      return {
        dispose: () => {
          const index = closeListeners.indexOf(listener);
          if (index !== -1) {
            closeListeners.splice(index, 1);
          }
        },
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════════════════════

export const CodeEditorWidget = memo(
  function CodeEditorWidget({
    file,
    minimapEnabled = true,
    onContentChange,
    onDirtyChange,
    onCursorChange,
    onSave,
    onAddToChat,
  }: CodeEditorWidgetProps) {
    // 容器 ref
    const containerRef = useRef<HTMLDivElement>(null);

    // EditorPanes 实例
    const editorPanesRef = useRef<EditorPanes | null>(null);

    // 工厂实例
    const factoryRef = useRef<CodeEditorPaneFactory | null>(null);

    // 内容存储 ref（用于内容提供者）
    const contentStoreRef = useRef<IContentStore>({
      getContent: () => undefined,
      getLanguage: () => undefined,
    });

    // 当前文件路径
    const currentFilePathRef = useRef<string | null>(null);

    // 是否已初始化
    const initializedRef = useRef(false);

    // 当前文件信息（用于内容存储）
    const currentFileRef = useRef<CodeEditorFile | null>(null);

    // 回调 refs（避免依赖问题）
    const callbacksRef = useRef({
      onContentChange,
      onDirtyChange,
      onCursorChange,
      onSave,
      onAddToChat,
    });

    // 更新回调 refs
    callbacksRef.current = {
      onContentChange,
      onDirtyChange,
      onCursorChange,
      onSave,
      onAddToChat,
    };

    // 更新当前文件引用
    currentFileRef.current = file;

    // 更新内容存储
    contentStoreRef.current = {
      getContent: (path: string) => {
        if (currentFileRef.current && currentFileRef.current.path === path) {
          return currentFileRef.current.content;
        }
        return undefined;
      },
      getLanguage: (path: string) => {
        if (currentFileRef.current && currentFileRef.current.path === path) {
          return currentFileRef.current.language;
        }
        return undefined;
      },
    };

    /**
     * 获取活动的 TextCodeEditorPane
     */
    const getActivePane = useCallback((): TextCodeEditorPane | null => {
      const panes = editorPanesRef.current;
      if (!panes) return null;
      return panes.activeEditorPane as TextCodeEditorPane | null;
    }, []);

    /**
     * 获取编辑器实例
     */
    const getEditor =
      useCallback((): monaco.editor.IStandaloneCodeEditor | null => {
        const pane = getActivePane();
        if (!pane) return null;
        return pane.getControl() as monaco.editor.IStandaloneCodeEditor | null;
      }, [getActivePane]);

    /**
     * 切换到新文件
     */
    const switchToFile = useCallback(async (newFile: CodeEditorFile) => {
      const panes = editorPanesRef.current;
      if (!panes) return;

      const oldPath = currentFilePathRef.current;

      // 如果是相同文件，跳过
      if (oldPath === newFile.path) {
        return;
      }

      // 创建 FileEditorInput
      const input = new FileEditorInput({
        path: newFile.path,
        name: newFile.name,
        language: newFile.language,
      });

      // 打开编辑器上下文
      const context: IEditorOpenContext = {
        newInGroup: oldPath === null,
        restored: false,
      };

      // 编辑器选项
      const options: ITextEditorOptions = {
        pinned: true,
      };

      // 打开编辑器
      const result = await panes.openEditor(input, options, context);

      if (result.pane) {
        currentFilePathRef.current = newFile.path;
      }
    }, []);

    /**
     * 初始化编辑器（使用 useLayoutEffect 确保在 DOM 更新后立即运行）
     */
    useLayoutEffect(() => {
      const container = containerRef.current;

      // 如果没有容器或已经初始化，跳过
      if (!container || (initializedRef.current && editorPanesRef.current)) {
        return;
      }

      // 注册主题
      registerFtreTheme(monaco);

      // 初始化 TextModelResolverService
      const modelService = getTextModelResolverService();
      if (!modelService.isInitialized()) {
        modelService.init(monaco);
      }

      // 创建编辑器组
      const group = createSimpleEditorGroup(1);

      // 创建工厂配置（使用 ref 访问回调，避免依赖问题）
      const factoryOptions: ICodeEditorPaneFactoryOptions = {
        monaco,
        editorOptions: {
          fontSize: 14,
          fontFamily:
            "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
          lineHeight: 22,
          minimap: { enabled: minimapEnabled },
          scrollBeyondLastLine: false,
          renderLineHighlight: "line",
          padding: { top: 10, bottom: 10 },
          smoothScrolling: false,
          theme: getActiveThemeId(),
        },
        callbacks: {
          onDidChangeContent: (resource) => {
            callbacksRef.current.onContentChange?.(resource);
          },
          onDidChangeDirty: (resource, dirty) => {
            callbacksRef.current.onDirtyChange?.(resource, dirty);
          },
          onDidChangeCursorPosition: (line, column) => {
            callbacksRef.current.onCursorChange?.(line, column);
          },
          onSaveRequest: async (resource, content) => {
            if (callbacksRef.current.onSave) {
              return await callbacksRef.current.onSave(resource, content);
            }
            return false;
          },
          onAddToChat: (message) => {
            callbacksRef.current.onAddToChat?.(message);
          },
        },
        contentStore: contentStoreRef.current,
      };

      // 创建工厂
      const factory = new CodeEditorPaneFactory(factoryOptions);
      factoryRef.current = factory;

      // 创建 EditorPanes
      const panes = new EditorPanes(group, factory);
      panes.create(container);
      editorPanesRef.current = panes;

      // 初始布局 - 必须在打开文件前调用
      const rect = container.getBoundingClientRect();
      panes.layout({
        width: rect.width || container.offsetWidth || 100,
        height: rect.height || container.offsetHeight || 100,
      });

      initializedRef.current = true;

      return () => {
        // 保存所有 ViewState
        saveAllEditorMementos();

        // 销毁 EditorPanes（它会自行清理 DOM）
        if (editorPanesRef.current) {
          editorPanesRef.current.dispose();
          editorPanesRef.current = null;
        }

        // 不要手动清理 DOM，让 React 处理
        // Monaco 的 dispose 已经清理了它创建的元素

        factoryRef.current = null;
        initializedRef.current = false;
        currentFilePathRef.current = null;
      };
      // 依赖 file.loaded 确保在文件加载后重新检查初始化
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file.loaded]);

    // ResizeObserver effect - 监听容器尺寸变化并调用 layout
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      let rafId: number | null = null;

      const resizeObserver = new ResizeObserver((entries) => {
        // 使用 requestAnimationFrame 避免过于频繁的布局计算
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }

        rafId = requestAnimationFrame(() => {
          const entry = entries[0];
          if (!entry) return;

          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0 && editorPanesRef.current) {
            editorPanesRef.current.layout({ width, height });
          }
        });
      });

      resizeObserver.observe(container);

      // 初始布局 - 如果 editorPanes 已存在则立即布局
      // 使用 setTimeout 确保 DOM 已完全渲染
      setTimeout(() => {
        const rect = container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && editorPanesRef.current) {
          editorPanesRef.current.layout({
            width: rect.width,
            height: rect.height,
          });
        }
      }, 0);

      return () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
        resizeObserver.disconnect();
      };
    }, []);

    // 文件切换 effect
    useEffect(() => {
      if (!initializedRef.current || !file.loaded) {
        return;
      }

      // 更新内容存储引用
      if (factoryRef.current) {
        factoryRef.current.setContentStore(contentStoreRef.current);
      }

      switchToFile(file);
    }, [file.path, file.loaded, switchToFile]);

    // minimap 设置变化
    useEffect(() => {
      const pane = getActivePane();
      if (pane) {
        pane.updateEditorOptions({
          minimap: { enabled: minimapEnabled },
        });
      }
    }, [minimapEnabled, getActivePane]);

    // 窗口事件监听
    useEffect(() => {
      const handleApplyCode = (e: Event) => {
        const { code, targetFile } = (e as CustomEvent).detail;
        const currentPath = currentFilePathRef.current;
        if (targetFile && targetFile !== currentPath) return;

        const editor = getEditor();
        if (editor && code) {
          const position = editor.getPosition();
          if (position) {
            editor.executeEdits("apply-code", [
              {
                range: new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column,
                ),
                text: code,
              },
            ]);
          }
        }
      };

      const handleUndo = () => {
        getEditor()?.trigger("menu", "undo", null);
      };

      const handleRedo = () => {
        getEditor()?.trigger("menu", "redo", null);
      };

      const handleRevealLine = (e: Event) => {
        const { filePath, line, col } = (
          e as CustomEvent<{ filePath: string; line: number; col: number }>
        ).detail;
        const currentPath = currentFilePathRef.current;
        if (filePath !== currentPath) return;

        const editor = getEditor();
        if (editor) {
          editor.revealLineInCenter(line);
          editor.setPosition({ lineNumber: line, column: col ?? 1 });
          editor.focus();
        }
      };

      const handleFind = () => {
        getEditor()?.trigger("menu", "actions.find", null);
      };

      const handleReplace = () => {
        getEditor()?.trigger(
          "menu",
          "editor.action.startFindReplaceAction",
          null,
        );
      };

      const handleChangeLanguage = (e: Event) => {
        const { language } = (e as CustomEvent<{ language: string }>).detail;
        if (!language) return;

        const editor = getEditor();
        const currentPath = currentFilePathRef.current;
        if (editor && currentPath) {
          const model = editor.getModel();
          if (model) {
            monaco.editor.setModelLanguage(model, language);
          }
        }
      };

      const handleBeforeUnload = () => {
        saveAllEditorMementos();
      };

      window.addEventListener("ftre:apply-code", handleApplyCode);
      window.addEventListener("ftre:undo", handleUndo);
      window.addEventListener("ftre:redo", handleRedo);
      window.addEventListener("ftre:reveal-line", handleRevealLine);
      window.addEventListener("ftre:find-in-editor", handleFind);
      window.addEventListener("ftre:replace-in-editor", handleReplace);
      window.addEventListener("ftre:change-language", handleChangeLanguage);
      window.addEventListener("beforeunload", handleBeforeUnload);

      return () => {
        window.removeEventListener("ftre:apply-code", handleApplyCode);
        window.removeEventListener("ftre:undo", handleUndo);
        window.removeEventListener("ftre:redo", handleRedo);
        window.removeEventListener("ftre:reveal-line", handleRevealLine);
        window.removeEventListener("ftre:find-in-editor", handleFind);
        window.removeEventListener("ftre:replace-in-editor", handleReplace);
        window.removeEventListener(
          "ftre:change-language",
          handleChangeLanguage,
        );
        window.removeEventListener("beforeunload", handleBeforeUnload);
      };
    }, [getEditor]);

    // 始终渲染容器，loading 状态通过覆盖层显示
    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {!file.loaded && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-t-ghost, #666)",
              fontSize: "13px",
              fontFamily: "monospace",
              backgroundColor: "var(--color-surface, #1e1e1e)",
              zIndex: 10,
            }}
          >
            Loading...
          </div>
        )}
      </div>
    );
  },
  // 自定义比较函数 - 只有这些变化才重新渲染
  (prevProps, nextProps) => {
    return (
      prevProps.minimapEnabled === nextProps.minimapEnabled &&
      prevProps.file.loaded === nextProps.file.loaded &&
      prevProps.file.path === nextProps.file.path &&
      prevProps.file.language === nextProps.file.language
    );
  },
);
