/**
 * ManagedEditor — 新架构编辑器组件
 *
 * 基于 Document + SlotPool 架构，职责大幅简化：
 * 1. 从 DocumentManager 获取/创建 Document
 * 2. 如果 doc.state === 'idle'，触发 doc.load()
 * 3. 如果 doc.state === 'loading'，显示 Loading 占位符
 * 4. 如果 doc.state === 'loaded' 或 'hibernated'，调用 SlotPool.acquire 挂载编辑器
 * 5. 组件卸载时调用 SlotPool.release
 *
 * 不再负责：
 * - 内容同步（由 Document 管理）
 * - Dirty 判断（由 Document.isDirty() 提供）
 * - viewState 管理（由 Document 管理）
 * - Monaco 实例复用（由 SlotPool 管理）
 */

import { useRef, useEffect, memo, useState, useMemo } from "react";
import type { editor } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { getDocumentManager, getSlotPool, type DocState } from "../core";
import { saveFile, getHostBridge } from "../runtime";
import { registerFtreTheme } from "./theme-registry";
import { getActiveThemeId } from "./themes";
import type { OpenFile } from "../store/types";

// ── 类型定义 ──

interface ManagedEditorProps {
  file: OpenFile;
  minimapEnabled?: boolean;
}

// ══════════════════════════════════════════════════
//  setupEditorActions — 仅在新建 slot 时调用一次
// ══════════════════════════════════════════════════

function setupEditorActions(
  ed: editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  filePath: string,
  fileName: string,
): Monaco.IDisposable[] {
  const disposables: Monaco.IDisposable[] = [];

  // 主题注册
  registerFtreTheme(monaco);
  monaco.editor.setTheme(getActiveThemeId());

  // Ctrl+S 保存
  disposables.push(
    ed.addAction({
      id: "ftre-save",
      label: "保存文件",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        const doc = getDocumentManager().get(filePath);
        if (!doc) return;

        saveFile(
          filePath,
          fileName,
          () => doc.getContentForSave(),
          () => {
            doc.markSaved();
            try {
              getHostBridge().setModified(filePath, false);
            } catch {
              // ignore
            }
          },
        );
      },
    }),
  );

  // 光标位置变化 → StatusBar
  disposables.push(
    ed.onDidChangeCursorPosition((e) => {
      window.dispatchEvent(
        new CustomEvent("ftre:cursor-change", {
          detail: { line: e.position.lineNumber, col: e.position.column },
        }),
      );
    }),
  );

  // AI 右键菜单
  disposables.push(
    ed.addAction({
      id: "ai-explain",
      label: "AI: 解释这段代码",
      contextMenuGroupId: "ai",
      contextMenuOrder: 1,
      run: (editor) => {
        const selection = editor.getSelection();
        if (!selection) return;
        const selectedText = editor.getModel()?.getValueInRange(selection);
        if (selectedText) {
          try {
            getHostBridge().addUserMessage(
              `Explain this code from ${fileName}:\n\`\`\`\n${selectedText}\n\`\`\``,
            );
          } catch {
            // ignore
          }
        }
      },
    }),
  );

  disposables.push(
    ed.addAction({
      id: "ai-refactor",
      label: "AI: 重构这段代码",
      contextMenuGroupId: "ai",
      contextMenuOrder: 2,
      run: (editor) => {
        const selection = editor.getSelection();
        if (!selection) return;
        const selectedText = editor.getModel()?.getValueInRange(selection);
        if (selectedText) {
          try {
            getHostBridge().addUserMessage(
              `Refactor this code from ${fileName}:\n\`\`\`\n${selectedText}\n\`\`\``,
            );
          } catch {
            // ignore
          }
        }
      },
    }),
  );

  // Ctrl+L 添加到聊天
  disposables.push(
    ed.addAction({
      id: "add-to-chat",
      label: "添加选中内容到聊天",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
      contextMenuGroupId: "ai",
      contextMenuOrder: 0,
      run: (editor) => {
        const selection = editor.getSelection();
        if (!selection || selection.isEmpty()) return;
        const selectedText = editor.getModel()?.getValueInRange(selection);
        if (!selectedText) return;
        window.dispatchEvent(
          new CustomEvent("ftre:insert-code-ref", {
            detail: {
              filePath,
              fileName,
              startLine: selection.startLineNumber,
              endLine: selection.endLineNumber,
              content: selectedText,
            },
          }),
        );
      },
    }),
  );

  return disposables;
}

// ══════════════════════════════════════════════════
//  ManagedEditor 组件
// ══════════════════════════════════════════════════

export const ManagedEditor = memo(
  function ManagedEditor({ file, minimapEnabled }: ManagedEditorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const lastDirtyRef = useRef<boolean | null>(null);
    const [docState, setDocState] = useState<DocState>("idle");
    const [isLoading, setIsLoading] = useState(false);

    // 获取或创建 Document（useMemo 避免渲染阶段副作用）
    const doc = useMemo(() => {
      const dm = getDocumentManager();
      return dm.get(file.path) ?? dm.open(file.path, file.language);
    }, [file.path, file.language]);

    // 监听 Document 状态变化
    useEffect(() => {
      const unsubscribe = doc.onStateChange((state) => {
        setDocState(state);
      });
      // 同步初始状态
      setDocState(doc.state);
      return unsubscribe;
    }, [doc]);

    // Effect 1: 初始化/懒加载文件内容
    useEffect(() => {
      if (docState !== "idle") return;
      if (file.path.startsWith("diff:") || file.path.startsWith("untitled:")) {
        return;
      }

      // 如果 file.loaded 为 true，说明 store 已有内容，直接使用
      if (file.loaded && file.content) {
        doc.load(file.content);
        return;
      }

      // 否则通过 DocumentManager.loadAsync 从磁盘读取
      setIsLoading(true);
      let cancelled = false;

      (async () => {
        try {
          const bridge = getHostBridge();
          const loadedDoc = await getDocumentManager().loadAsync(
            file.path,
            file.language,
            () => bridge.readFile(file.path),
          );

          if (cancelled) return;

          if (loadedDoc) {
            // 通知 store 更新（保持兼容）
            bridge.hydrateFileContent(
              file.path,
              loadedDoc.getContent(),
              file.language,
            );
          } else {
            bridge.notifyError(`无法读取文件：${file.path}`);
            bridge.closeFile(file.path);
          }
        } catch {
          if (cancelled) return;
          try {
            const bridge = getHostBridge();
            bridge.notifyError(`无法读取文件：${file.path}`);
            bridge.closeFile(file.path);
          } catch {
            // ignore
          }
        } finally {
          if (!cancelled) {
            setIsLoading(false);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [doc, docState, file.path, file.language, file.loaded, file.content]);

    // Effect 2: 挂载/卸载编辑器
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      if (!getSlotPool().isInitialized()) return;
      if (docState !== "loaded" && docState !== "hibernated") return;

      // 如果 hibernated，先激活
      if (docState === "hibernated") {
        doc.activate();
      }

      const ed = getSlotPool().acquire({
        doc,
        container,
        onDidCreate: (editor, monaco) => {
          return setupEditorActions(editor, monaco, file.path, file.name);
        },
        onDidChangeContent: () => {
          // 检测 dirty 状态变化
          const dirty = doc.isDirty();
          if (dirty !== lastDirtyRef.current) {
            lastDirtyRef.current = dirty;
            try {
              getHostBridge().setModified(file.path, dirty);
            } catch {
              // ignore
            }
          }
        },
      });

      if (ed) {
        editorRef.current = ed;

        // 立即同步 dirty 状态
        const currentDirty = doc.isDirty();
        if (lastDirtyRef.current !== currentDirty) {
          lastDirtyRef.current = currentDirty;
          try {
            getHostBridge().setModified(file.path, currentDirty);
          } catch {
            // ignore
          }
        }

        // 派发初始光标位置
        const pos = ed.getPosition();
        if (pos) {
          window.dispatchEvent(
            new CustomEvent("ftre:cursor-change", {
              detail: { line: pos.lineNumber, col: pos.column },
            }),
          );
        }
      }

      return () => {
        getSlotPool().release(file.path, doc);
        editorRef.current = null;
      };
    }, [doc, docState, file.path, file.name]);

    // Effect 3: minimap 更新
    useEffect(() => {
      if (!getSlotPool().isInitialized()) return;

      let enabled: boolean;
      if (minimapEnabled !== undefined) {
        enabled = minimapEnabled;
      } else {
        try {
          enabled = getHostBridge().getMinimapEnabled();
        } catch {
          enabled = true;
        }
      }

      getSlotPool().updateOptions({ minimap: { enabled } });
    }, [minimapEnabled]);

    // Effect 4: 窗口事件监听
    useEffect(() => {
      const handleApplyCode = (e: Event) => {
        const { code, targetFile } = (e as CustomEvent).detail;
        if (targetFile && targetFile !== file.path) return;
        const ed = editorRef.current;
        const monaco = getSlotPool().getMonaco();
        if (ed && monaco && code) {
          const position = ed.getPosition();
          if (position) {
            ed.executeEdits("apply-code", [
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

      const handleUndo = () => editorRef.current?.trigger("menu", "undo", null);
      const handleRedo = () => editorRef.current?.trigger("menu", "redo", null);

      const handleChangeLanguage = (e: Event) => {
        try {
          if (getHostBridge().getActiveFile() !== file.path) return;
        } catch {
          return;
        }
        const { language } = (e as CustomEvent<{ language: string }>).detail;
        if (!language) return;

        const ed = editorRef.current;
        const monaco = getSlotPool().getMonaco();
        if (ed && monaco) {
          const model = ed.getModel();
          if (model) {
            monaco.editor.setModelLanguage(model, language);
          }
        }

        try {
          getHostBridge().setFileLanguage(file.path, language);
        } catch {
          // ignore
        }
      };

      const handleRevealLine = (e: Event) => {
        const { filePath, line, col } = (
          e as CustomEvent<{ filePath: string; line: number; col: number }>
        ).detail;
        if (filePath !== file.path) return;
        const ed = editorRef.current;
        if (ed) {
          ed.revealLineInCenter(line);
          ed.setPosition({ lineNumber: line, column: col ?? 1 });
          ed.focus();
        }
      };

      const handleSave = () => {
        try {
          if (getHostBridge().getActiveFile() !== file.path) return;
        } catch {
          return;
        }
        const d = getDocumentManager().get(file.path);
        if (!d) return;
        saveFile(
          file.path,
          file.name,
          () => d.getContentForSave(),
          () => {
            d.markSaved();
            lastDirtyRef.current = false;
            try {
              getHostBridge().setModified(file.path, false);
            } catch {
              // ignore
            }
          },
        );
      };

      const handleFind = () => {
        try {
          if (getHostBridge().getActiveFile() !== file.path) return;
        } catch {
          return;
        }
        editorRef.current?.trigger("menu", "actions.find", null);
      };

      const handleReplace = () => {
        try {
          if (getHostBridge().getActiveFile() !== file.path) return;
        } catch {
          return;
        }
        editorRef.current?.trigger(
          "menu",
          "editor.action.startFindReplaceAction",
          null,
        );
      };

      window.addEventListener("ftre:apply-code", handleApplyCode);
      window.addEventListener("ftre:undo", handleUndo);
      window.addEventListener("ftre:redo", handleRedo);
      window.addEventListener("ftre:change-language", handleChangeLanguage);
      window.addEventListener("ftre:reveal-line", handleRevealLine);
      window.addEventListener("ftre:save-active", handleSave);
      window.addEventListener("ftre:find-in-editor", handleFind);
      window.addEventListener("ftre:replace-in-editor", handleReplace);

      return () => {
        window.removeEventListener("ftre:apply-code", handleApplyCode);
        window.removeEventListener("ftre:undo", handleUndo);
        window.removeEventListener("ftre:redo", handleRedo);
        window.removeEventListener(
          "ftre:change-language",
          handleChangeLanguage,
        );
        window.removeEventListener("ftre:reveal-line", handleRevealLine);
        window.removeEventListener("ftre:save-active", handleSave);
        window.removeEventListener("ftre:find-in-editor", handleFind);
        window.removeEventListener("ftre:replace-in-editor", handleReplace);
      };
    }, [file.path, file.name]);

    // 渲染
    const isReady = getSlotPool().isInitialized() && docState === "loaded";
    const showLoading = isLoading || (!isReady && file.loaded);

    return (
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", position: "relative" }}
      >
        {showLoading && (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-t-ghost, #666)",
              fontSize: "13px",
              fontFamily: "monospace",
            }}
          >
            Loading...
          </div>
        )}
      </div>
    );
  },

  // 自定义比较函数
  (prevProps, nextProps) => {
    return (
      prevProps.file.path === nextProps.file.path &&
      prevProps.file.loaded === nextProps.file.loaded &&
      prevProps.file.content === nextProps.file.content &&
      prevProps.minimapEnabled === nextProps.minimapEnabled
    );
  },
);
