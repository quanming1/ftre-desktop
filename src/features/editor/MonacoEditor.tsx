import { useRef, useCallback, useEffect } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { useEditor, type OpenFile } from "@/stores/editor";
import { useChat } from "@/stores/chat";
import { useLayout } from "@/stores/layout";
import { registerFtreTheme } from "./themeRegistry";
import { editorCore } from "./core/editor-core";
import { saveFile } from "./core/editor-commands";

interface MonacoEditorProps {
  file: OpenFile;
}

export function MonacoEditor({ file }: MonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const lastDirtyRef = useRef(false);
  const minimapEnabled = useLayout((s) => s.minimapEnabled);

  // 初始化 editorCore 内容（如果还没有的话）
  if (!editorCore.getContent(file.path) && file.content) {
    editorCore.setContent(file.path, file.content);
    editorCore.setDiskContent(file.path, file.content);
  }

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // 用 ResizeObserver 替代 automaticLayout（避免 100ms 轮询占用 GPU）
      const container = editor.getDomNode()?.parentElement;
      if (container) {
        let rafId: number | null = null;
        const ro = new ResizeObserver(() => {
          if (rafId) return;
          rafId = requestAnimationFrame(() => {
            rafId = null;
            editor.layout();
          });
        });
        ro.observe(container);
        editor.onDidDispose(() => ro.disconnect());
      }

      // 注册到 editorCore
      editorCore.registerInstance(file.path, editor);

      // 非受控模式：通过 onDidChangeModelContent 监听变化
      lastDirtyRef.current = false;
      editor.onDidChangeModelContent(() => {
        const content = editor.getValue();
        editorCore.setContent(file.path, content);
        const dirty = editorCore.isDirty(file.path);
        if (dirty !== lastDirtyRef.current) {
          lastDirtyRef.current = dirty;
          useEditor.getState().setModified(file.path, dirty);
        }
      });

      // Register theme via shared themeRegistry (Req 5.3)
      registerFtreTheme(monaco);
      monaco.editor.setTheme("ftre-dark");

      // Ctrl+S — 统一保存逻辑
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveFile(
          file.path,
          file.name,
          () => editor.getValue(),
          () => { lastDirtyRef.current = false; },
        );
      });

      const savedViewState = editorCore.getViewState(file.path);
      if (savedViewState) {
        editor.restoreViewState(savedViewState);
      }

      editor.focus();

      // Dispatch cursor position to StatusBar
      editor.onDidChangeCursorPosition((e) => {
        window.dispatchEvent(
          new CustomEvent("ftre:cursor-change", {
            detail: { line: e.position.lineNumber, col: e.position.column },
          }),
        );
      });

      // AI context menu
      editor.addAction({
        id: "ai-explain",
        label: "AI: 解释这段代码",
        contextMenuGroupId: "ai",
        contextMenuOrder: 1,
        run: (ed) => {
          const selection = ed.getSelection();
          if (!selection) return;
          const selectedText = ed.getModel()?.getValueInRange(selection);
          if (selectedText) {
            useChat.getState().addUserMessage(`Explain this code from ${file.name}:\n\`\`\`\n${selectedText}\n\`\`\``);
          }
        },
      });

      editor.addAction({
        id: "ai-refactor",
        label: "AI: 重构这段代码",
        contextMenuGroupId: "ai",
        contextMenuOrder: 2,
        run: (ed) => {
          const selection = ed.getSelection();
          if (!selection) return;
          const selectedText = ed.getModel()?.getValueInRange(selection);
          if (selectedText) {
            useChat.getState().addUserMessage(`Refactor this code from ${file.name}:\n\`\`\`\n${selectedText}\n\`\`\``);
          }
        },
      });

      // Ctrl+L → 将选中代码插入 Chat 输入框
      editor.addAction({
        id: "add-to-chat",
        label: "添加选中内容到聊天",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
        contextMenuGroupId: "ai",
        contextMenuOrder: 0,
        run: (ed) => {
          const selection = ed.getSelection();
          if (!selection || selection.isEmpty()) return;
          const selectedText = ed.getModel()?.getValueInRange(selection);
          if (!selectedText) return;
          window.dispatchEvent(
            new CustomEvent("ftre:insert-code-ref", {
              detail: {
                filePath: file.path,
                fileName: file.name,
                startLine: selection.startLineNumber,
                endLine: selection.endLineNumber,
                content: selectedText,
              },
            }),
          );
        },
      });
    },
    [file.path, file.name],
  );

  // Save view state + content on unmount, unregister instance
  useEffect(() => {
    return () => {
      const ed = editorRef.current;
      if (ed) {
        // 切换文件时同步内容到 editorCore（平时不调 getValue）
        editorCore.setContent(file.path, ed.getValue());
        const state = ed.saveViewState();
        if (state) editorCore.saveViewState(file.path, state);
      }
      editorCore.unregisterInstance(file.path);
    };
  }, [file.path]);

  // Listen for ftre:apply-code events to insert code at cursor position
  useEffect(() => {
    const handler = (e: Event) => {
      const { code, targetFile } = (e as CustomEvent).detail;
      if (targetFile && targetFile !== file.path) return;
      const ed = editorRef.current;
      const monaco = monacoRef.current;
      if (ed && monaco && code) {
        const position = ed.getPosition();
        if (position) {
          ed.executeEdits("apply-code", [
            {
              range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
              text: code,
            },
          ]);
        }
      }
    };
    window.addEventListener("ftre:apply-code", handler);
    return () => window.removeEventListener("ftre:apply-code", handler);
  }, [file.path]);

  // Listen for ftre:undo / ftre:redo events from TitleBar Edit menu
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const handleUndo = () => ed.trigger("menu", "undo", null);
    const handleRedo = () => ed.trigger("menu", "redo", null);
    window.addEventListener("ftre:undo", handleUndo);
    window.addEventListener("ftre:redo", handleRedo);
    return () => {
      window.removeEventListener("ftre:undo", handleUndo);
      window.removeEventListener("ftre:redo", handleRedo);
    };
  }, []);

  // Spec: change_language_mode — listen for language change from StatusBar
  useEffect(() => {
    const handler = (e: Event) => {
      if (useEditor.getState().activeFile !== file.path) return;
      const { language } = (e as CustomEvent<{ language: string }>).detail;
      if (!language) return;
      const ed = editorRef.current;
      const monaco = monacoRef.current;
      if (ed && monaco) {
        const model = ed.getModel();
        if (model) {
          monaco.editor.setModelLanguage(model, language);
        }
      }
      useEditor.getState().setFileLanguage(file.path, language);
    };
    window.addEventListener("ftre:change-language", handler);
    return () => window.removeEventListener("ftre:change-language", handler);
  }, [file.path]);

  // Listen for ftre:reveal-line — jump to a specific line (from ProblemsPanel)
  useEffect(() => {
    const handler = (e: Event) => {
      const { filePath, line, col } = (e as CustomEvent<{ filePath: string; line: number; col: number }>).detail;
      if (filePath !== file.path) return;
      const ed = editorRef.current;
      if (ed) {
        ed.revealLineInCenter(line);
        ed.setPosition({ lineNumber: line, column: col ?? 1 });
        ed.focus();
      }
    };
    window.addEventListener("ftre:reveal-line", handler);
    return () => window.removeEventListener("ftre:reveal-line", handler);
  }, [file.path]);

  // Listen for ftre:save-active, ftre:find-in-editor, ftre:replace-in-editor from TitleBar menus
  useEffect(() => {
    const handleSave = () => {
      // Only save if this editor's file is the currently active file
      if (useEditor.getState().activeFile !== file.path) return;
      const ed = editorRef.current;
      if (!ed) return;
      saveFile(
        file.path,
        file.name,
        () => ed.getValue(),
        () => { lastDirtyRef.current = false; },
      );
    };
    const handleFind = () => {
      if (useEditor.getState().activeFile !== file.path) return;
      editorRef.current?.trigger("menu", "actions.find", null);
    };
    const handleReplace = () => {
      if (useEditor.getState().activeFile !== file.path) return;
      editorRef.current?.trigger("menu", "editor.action.startFindReplaceAction", null);
    };

    window.addEventListener("ftre:save-active", handleSave);
    window.addEventListener("ftre:find-in-editor", handleFind);
    window.addEventListener("ftre:replace-in-editor", handleReplace);
    return () => {
      window.removeEventListener("ftre:save-active", handleSave);
      window.removeEventListener("ftre:find-in-editor", handleFind);
      window.removeEventListener("ftre:replace-in-editor", handleReplace);
    };
  }, [file.path]);

  return (
    <Editor
      key={file.path}
      height="100%"
      language={file.language}
      defaultValue={editorCore.getContent(file.path) || file.content}
      onMount={handleMount}
      theme="ftre-dark"
      options={{
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
        lineHeight: 22,
        minimap: { enabled: minimapEnabled },
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        padding: { top: 10, bottom: 10 },
        smoothScrolling: false,
        cursorBlinking: "blink",
        cursorSmoothCaretAnimation: "off",
        bracketPairColorization: { enabled: true },
        automaticLayout: false,
        renderValidationDecorations: "off",
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        scrollbar: {
          verticalScrollbarSize: 5,
          horizontalScrollbarSize: 5,
        },
      }}
    />
  );
}
