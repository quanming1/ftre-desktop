import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { useCallback, useRef, useEffect } from "react";
import type { editor } from "monaco-editor";
import type { DiffEntry } from "@/stores/editor";
import { registerFtreTheme } from "./themeRegistry";
import { editorCore } from "./core/editor-core";

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

export function MonacoDiffViewer({ diff, language, renderSideBySide }: MonacoDiffViewerProps) {
  const monacoLang = toMonacoLanguage(language);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  // 缓存 model 引用，widget dispose 后仍能安全 dispose models
  const modelsRef = useRef<{ original: editor.ITextModel | null; modified: editor.ITextModel | null }>({
    original: null,
    modified: null,
  });

  const handleMount: DiffOnMount = useCallback((diffEditor, monaco) => {
    editorRef.current = diffEditor;
    modelsRef.current = {
      original: diffEditor.getOriginalEditor().getModel(),
      modified: diffEditor.getModifiedEditor().getModel(),
    };

    registerFtreTheme(monaco);
    monaco.editor.setTheme("ftre-dark");

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
  }, [monacoLang]);

  // 用 ref 追踪最新的 diff.filePath，确保 cleanup 中拿到正确值
  const filePathRef = useRef(diff.filePath);
  filePathRef.current = diff.filePath;

  // 手动 dispose models：React cleanup 顺序保证子组件（DiffEditor）先清理 widget，
  // 父组件（本组件）后清理 models，避免 "TextModel got disposed before DiffEditorWidget
  // model got reset" 错误
  useEffect(() => {
    return () => {
      // 将 modified editor 的 viewState 保存到真实文件路径，
      // 这样从 diff tab 跳转到原始文件时 MonacoEditor 能恢复相同的滚动位置
      const diffEditor = editorRef.current;
      if (diffEditor) {
        const modifiedViewState = diffEditor.getModifiedEditor().saveViewState();
        if (modifiedViewState) {
          editorCore.saveViewState(filePathRef.current, modifiedViewState);
        }
      }

      modelsRef.current.original?.dispose();
      modelsRef.current.modified?.dispose();
      modelsRef.current = { original: null, modified: null };
      editorRef.current = null;
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
      keepCurrentOriginalModel
      keepCurrentModifiedModel
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
