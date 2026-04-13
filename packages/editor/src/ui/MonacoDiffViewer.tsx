import { DiffEditor } from "@monaco-editor/react";
import {
  useCallback,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import type { editor } from "monaco-editor";
import type * as Monaco from "monaco-editor";
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

export interface MonacoDiffViewerHandle {
  getCurrentLine: () => number;
}

interface MonacoDiffViewerProps {
  diff: DiffEntry;
  language: string;
  renderSideBySide: boolean;
}

export const MonacoDiffViewer = forwardRef<
  MonacoDiffViewerHandle,
  MonacoDiffViewerProps
>(function MonacoDiffViewer({ diff, language, renderSideBySide }, ref) {
  const monacoLang = toMonacoLanguage(language);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
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

  // @monaco-editor/react DiffEditor 不响应 original/modified props 变化
  // 需要手动更新 model 内容
  useEffect(() => {
    const diffEditor = editorRef.current;
    const monaco = monacoRef.current;
    if (!diffEditor || !monaco) return;

    const origModel = diffEditor.getOriginalEditor().getModel();
    const modModel = diffEditor.getModifiedEditor().getModel();

    if (origModel && origModel.getValue() !== diff.originalContent) {
      origModel.setValue(diff.originalContent);
    }
    if (modModel && modModel.getValue() !== diff.newContent) {
      modModel.setValue(diff.newContent);
    }
  }, [diff.originalContent, diff.newContent]);

  // 组件卸载时安全释放模型，避免已知 DiffEditor dispose 报错
  useEffect(() => {
    return () => {
      if (cleanedUpRef.current) {
        return;
      }
      cleanedUpRef.current = true;

      const diffEditor = editorRef.current;
      const monaco = monacoRef.current;

      if (diffEditor && monaco) {
        try {
          const modifiedEditor = diffEditor.getModifiedEditor();
          const modModel = modifiedEditor.getModel();
          if (!modModel) {
            return;
          }

          const origModel = diffEditor.getOriginalEditor().getModel();

          if (origModel && modModel) {
            const emptyOriginal = monaco.editor.createModel("", "plaintext");
            const emptyModified = monaco.editor.createModel("", "plaintext");

            diffEditor.setModel({
              original: emptyOriginal,
              modified: emptyModified,
            });

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

  // 暴露获取当前行号的方法
  useImperativeHandle(
    ref,
    () => ({
      getCurrentLine: () => {
        const diffEditor = editorRef.current;
        if (!diffEditor) return 1;
        const position = diffEditor.getModifiedEditor().getPosition();
        return position?.lineNumber ?? 1;
      },
    }),
    [],
  );

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
        ignoreTrimWhitespace: false,
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
        lineHeight: 22,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderSideBySide,
        renderOverviewRuler: false,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        glyphMargin: false,
        lineNumbersMinChars: renderSideBySide ? 3 : 5,
        folding: false,
        automaticLayout: true,
        scrollbar: {
          verticalScrollbarSize: 5,
          horizontalScrollbarSize: 5,
        },
      }}
    />
  );
});
