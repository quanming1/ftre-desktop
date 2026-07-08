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
  revealFirstDiff: () => void;
  ensureMinimap: () => void;
}

interface MonacoDiffViewerProps {
  diff: DiffEntry;
  language: string;
  renderSideBySide: boolean;
  theme?: string;
  /** 值变化时重新滚动到第一个 diff 位置 */
  revealNonce?: number;
  /** 自动换行 */
  wordWrap?: boolean;
}

export const MonacoDiffViewer = forwardRef<
  MonacoDiffViewerHandle,
  MonacoDiffViewerProps
>(function MonacoDiffViewer({ diff, language, renderSideBySide, theme, revealNonce, wordWrap }, ref) {
  const monacoLang = toMonacoLanguage(language);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const cleanedUpRef = useRef(false);

  const handleMount = useCallback(
    (diffEditor: editor.IStandaloneDiffEditor, monaco: typeof Monaco) => {
      editorRef.current = diffEditor;
      monacoRef.current = monaco;
      cleanedUpRef.current = false;

      // 注册指定主题（getTheme 默认返回 darcula，必须显式传入 themeId）
      if (theme && theme !== "vs" && theme !== "vs-dark") {
        registerFtreTheme(monaco, theme);
      }
      monaco.editor.setTheme(theme ?? getActiveThemeId());

      // 非并排模式：original editor 隐藏行号；modified editor 关闭 diff revert icon 避免和行号挤
      if (!renderSideBySide) {
        diffEditor.getOriginalEditor().updateOptions({ lineNumbers: "off", lineNumbersMinChars: 0, glyphMargin: false, folding: false, minimap: { enabled: false } });
        diffEditor.getModifiedEditor().updateOptions({ glyphMargin: false, renderMarginRevertIcon: false, minimap: { enabled: true } });
      }

      // 注册 wordWrap 右键菜单 action（两个 editor 都加）
      const modEditor = diffEditor.getModifiedEditor();
      const origEditor = diffEditor.getOriginalEditor();

      for (const ed of [modEditor, origEditor]) {
        ed.addAction({
          id: "ftre-toggle-wordwrap",
          label: "开启/关闭自动换行",
          contextMenuGroupId: "ftre",
          contextMenuOrder: 0,
          run: (editor) => {
            const current = editor.getOption(monaco.editor.EditorOption.wordWrap);
            const next = current === "on" ? "off" : "on";
            modEditor.updateOptions({ wordWrap: next });
            origEditor.updateOptions({ wordWrap: next });
          },
        });
      }
      const origModel = diffEditor.getOriginalEditor().getModel();
      const modModel = diffEditor.getModifiedEditor().getModel();
      if (origModel) monaco.editor.setModelLanguage(origModel, monacoLang);
      if (modModel) monaco.editor.setModelLanguage(modModel, monacoLang);

      // 自动跳转到第一个 diff 位置 + 给 modified editor 添加 minimap 可见的 diff 装饰
      let scrolledToFirst = false;
      const disposable = diffEditor.onDidUpdateDiff(() => {
        const changes = diffEditor.getLineChanges();
        if (changes && changes.length > 0) {
          if (!scrolledToFirst) {
            scrolledToFirst = true;
            const firstLine = changes[0].modifiedStartLineNumber;
            diffEditor.getModifiedEditor().revealLineInCenter(firstLine);
          }
          // 给 modified editor 添加行级装饰，minimap 会渲染这些装饰的背景色
          const modEditor = diffEditor.getModifiedEditor();
          const decorations: monaco.editor.IModelDeltaDecoration[] = [];
          for (const change of changes) {
            const type = change.originalEndLineNumber === 0 ? "added" : "modified";
            const color = type === "added" ? "rgba(22, 163, 74, 0.25)" : "rgba(217, 119, 6, 0.25)";
            const startLine = change.modifiedStartLineNumber;
            const endLine = change.modifiedEndLineNumber || startLine;
            for (let line = startLine; line <= endLine; line++) {
              decorations.push({
                range: new monaco.Range(line, 1, line, 1),
                options: {
                  isWholeLine: true,
                  minimap: {
                    position: monaco.editor.MinimapPosition.Inline,
                    color: { id: "minimap.background" },
                  },
                  className: type === "added" ? "diff-minimap-added" : "diff-minimap-modified",
                  overviewRuler: {
                    position: monaco.editor.OverviewRulerLane.Full,
                    color: type === "added" ? "rgba(22, 163, 74, 0.6)" : "rgba(217, 119, 6, 0.6)",
                  },
                },
              });
            }
            // void color to avoid unused warning
            void color;
          }
          modEditor.deltaDecorations([], decorations);
        }
        if (scrolledToFirst) {
          disposable.dispose();
        }
      });
    },
    [monacoLang, renderSideBySide],
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

  // tab 从 hidden 切到 visible 时重新 layout
  useEffect(() => {
    const handleLayout = () => {
      const diffEditor = editorRef.current;
      if (diffEditor) {
        diffEditor.layout();
      }
    };
    window.addEventListener("ftre:editor-layout", handleLayout);
    return () => window.removeEventListener("ftre:editor-layout", handleLayout);
  }, []);

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

  // 暴露获取当前行号 + 跳转第一个 diff 的方法
  useImperativeHandle(
    ref,
    () => ({
      getCurrentLine: () => {
        const diffEditor = editorRef.current;
        if (!diffEditor) return 1;
        const position = diffEditor.getModifiedEditor().getPosition();
        return position?.lineNumber ?? 1;
      },
      revealFirstDiff: () => {
        const diffEditor = editorRef.current;
        if (!diffEditor) return;
        const changes = diffEditor.getLineChanges();
        if (changes && changes.length > 0) {
          const firstLine = changes[0].modifiedStartLineNumber;
          diffEditor.getModifiedEditor().revealLineInCenter(firstLine);
        }
      },
      ensureMinimap: () => {
        const diffEditor = editorRef.current;
        if (!diffEditor) return;
        diffEditor.getModifiedEditor().updateOptions({ minimap: { enabled: true } });
        diffEditor.getOriginalEditor().updateOptions({ minimap: { enabled: false } });
      },
    }),
    [],
  );

  // revealNonce 变化时重新滚动到第一个 diff 位置
  useEffect(() => {
    if (revealNonce === undefined || revealNonce === 0) return;
    const diffEditor = editorRef.current;
    if (!diffEditor) return;
    // diff 已计算完成时直接滚动；未完成时监听一次 onDidUpdateDiff
    const changes = diffEditor.getLineChanges();
    if (changes) {
      if (changes.length > 0) {
        diffEditor.getModifiedEditor().revealLineInCenter(changes[0].modifiedStartLineNumber);
      }
      return;
    }
    const disposable = diffEditor.onDidUpdateDiff(() => {
      const ch = diffEditor.getLineChanges();
      if (ch && ch.length > 0) {
        diffEditor.getModifiedEditor().revealLineInCenter(ch[0].modifiedStartLineNumber);
      }
      disposable.dispose();
    });
    return () => disposable.dispose();
  }, [revealNonce]);

  return (
    <DiffEditor
      height="100%"
      language={toMonacoLanguage(language)}
      original={diff.originalContent}
      modified={diff.newContent}
      theme={theme ?? "ftre-dark"}
      onMount={handleMount}
      options={{
        readOnly: true,
        originalEditable: false,
        ignoreTrimWhitespace: false,
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
        lineHeight: 22,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        renderSideBySide,
        renderIndicators: false,
        renderOverviewRuler: true,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        glyphMargin: false,
        folding: false,
        automaticLayout: true,
        wordWrap: wordWrap ? "on" : "off",
        scrollbar: {
          verticalScrollbarSize: 12,
          horizontalScrollbarSize: 12,
        },
      }}
    />
  );
});
