import { DiffEditor } from "@monaco-editor/react";
import { useCallback, useRef, useEffect } from "react";
import type { editor } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { getDocumentManager } from "../core";
import { registerFtreTheme } from "./theme-registry";
import { getActiveThemeId } from "./themes";
import type { DiffEntry } from "../store/types";

const MONACO_LANG_MAP: Record<string, string> = {
  typescriptreact: "typescript",
  javascriptreact: "javascript",
};

function toMonacoLanguage(lang: string): string {
  return MONACO_LANG_MAP[lang] ?? lang;
}

interface MonacoDiffViewerProps {
  diff: DiffEntry;
  language: string;
  renderSideBySide: boolean;
}

export function MonacoDiffViewer({
  diff,
  language,
  renderSideBySide,
}: MonacoDiffViewerProps) {
  const monacoLang = toMonacoLanguage(language);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  // Track if we've already cleaned up to avoid double cleanup
  const cleanedUpRef = useRef(false);

  const handleMount = useCallback(
    (diffEditor: editor.IStandaloneDiffEditor, monaco: typeof Monaco) => {
      editorRef.current = diffEditor;
      monacoRef.current = monaco;
      cleanedUpRef.current = false;

      registerFtreTheme(monaco);
      monaco.editor.setTheme(getActiveThemeId());

      // DiffEditor 的 language prop 有时不生效，手动设置 model 语言
      const origModel = diffEditor.getOriginalEditor().getModel();
      const modModel = diffEditor.getModifiedEditor().getModel();
      if (origModel) monaco.editor.setModelLanguage(origModel, monacoLang);
      if (modModel) monaco.editor.setModelLanguage(modModel, monacoLang);

      // 自动跳转到第一个 diff 位置 —— diff 计算是异步的，需要监听 onDidUpdateDiff
      let scrolledToFirst = false;
      const disposable = diffEditor.onDidUpdateDiff(() => {
        if (scrolledToFirst) return;
        scrolledToFirst = true;
        const changes = diffEditor.getLineChanges();
        if (changes && changes.length > 0) {
          const firstLine = changes[0].modifiedStartLineNumber;
          diffEditor.getModifiedEditor().revealLineInCenter(firstLine);
        }
        disposable.dispose();
      });
    },
    [monacoLang],
  );

  // 用 ref 追踪最新的 diff.filePath，确保 cleanup 中拿到正确值
  const filePathRef = useRef(diff.filePath);
  filePathRef.current = diff.filePath;

  // 组件卸载时保存 viewState，供后续打开原始文件时恢复滚动位置
  useEffect(() => {
    return () => {
      // Prevent double cleanup
      if (cleanedUpRef.current) {
        return;
      }
      cleanedUpRef.current = true;

      const diffEditor = editorRef.current;
      const monaco = monacoRef.current;

      if (diffEditor && monaco) {
        try {
          // Check if the editor is still valid (not disposed)
          const modifiedEditor = diffEditor.getModifiedEditor();

          // Try to get model - if it throws, editor is already disposed
          const modModel = modifiedEditor.getModel();
          if (!modModel) {
            return;
          }

          // 保存 viewState
          const modifiedViewState = modifiedEditor.saveViewState();
          if (modifiedViewState) {
            const docManager = getDocumentManager();
            const doc = docManager.get(filePathRef.current);
            if (doc) {
              doc.saveViewState(modifiedViewState);
            }
          }

          // 在 DiffEditor dispose 之前，用空模型替换当前模型
          // 这可以避免 "TextModel got disposed before DiffEditorWidget model got reset" 错误
          const origModel = diffEditor.getOriginalEditor().getModel();

          // Only proceed if both models exist
          if (origModel && modModel) {
            const emptyOriginal = monaco.editor.createModel("", "plaintext");
            const emptyModified = monaco.editor.createModel("", "plaintext");

            diffEditor.setModel({
              original: emptyOriginal,
              modified: emptyModified,
            });

            // Dispose the old models manually to prevent the error
            origModel.dispose();
            modModel.dispose();
          }
        } catch {
          // Editor was already disposed or in invalid state, ignore
        }
      }

      editorRef.current = null;
      monacoRef.current = null;
    };
  }, []);

  return (
    <DiffEditor
      height="100%"
      language={toMonacoLanguage(language)}
      original={diff.originalContent}
      modified={diff.newContent}
      theme="ftre-dark"
      onMount={handleMount}
      options={{
        readOnly: true,
        originalEditable: false,
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
        lineHeight: 22,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderSideBySide,
        automaticLayout: true,
        scrollbar: {
          verticalScrollbarSize: 5,
          horizontalScrollbarSize: 5,
        },
      }}
    />
  );
}
