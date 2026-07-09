import { DiffEditor, loader } from "@monaco-editor/react";
import * as monacoEditor from "monaco-editor";
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

// 确保 @monaco-editor/react 使用本地 monaco-editor 实例，而非 CDN 加载的独立实例
// 否则 defineTheme 注册在 CDN 实例上，与本地实例主题不同步
loader.config({ monaco: monacoEditor });

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

  // beforeMount：在 editor 创建后、setTheme 之前调用
  // 确保 defineTheme 先于 setTheme 执行，否则 Monaco 回退到默认 vs 主题导致 diff 颜色不一致
  const handleBeforeMount = useCallback(
    (monaco: typeof Monaco) => {
      if (theme && theme !== "vs" && theme !== "vs-dark") {
        registerFtreTheme(monaco, theme);
      }
    },
    [theme],
  );

  const handleMount = useCallback(
    (diffEditor: editor.IStandaloneDiffEditor, monaco: typeof Monaco) => {
      editorRef.current = diffEditor;
      monacoRef.current = monaco;

      monaco.editor.setTheme(theme ?? getActiveThemeId());

      // 非并排模式：original editor 隐藏行号；modified editor 关闭 diff revert icon 避免和行号挤
      if (!renderSideBySide) {
        diffEditor.getOriginalEditor().updateOptions({ lineNumbers: "off", lineNumbersMinChars: 0, glyphMargin: false, folding: false, minimap: { enabled: false } });
        diffEditor.getModifiedEditor().updateOptions({ glyphMargin: false, minimap: { enabled: true } });
      }

      // 启用文本选择：Monaco 默认加 no-user-select class 禁止选择，readOnly 不自动开启
      const modEditor = diffEditor.getModifiedEditor();
      const origEditor = diffEditor.getOriginalEditor();
      for (const ed of [modEditor, origEditor]) {
        const dom = ed.getDomNode();
        if (dom) {
          dom.classList.remove("no-user-select");
          dom.classList.add("enable-user-select");
        }
      }

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
      let diffComputed = false;
      const disposable = diffEditor.onDidUpdateDiff(() => {
        diffComputed = true;
        const changes = diffEditor.getLineChanges();
        if (changes && changes.length > 0) {
          const firstLine = changes[0].modifiedStartLineNumber;
          // 延迟到下一帧，等 wordWrap 布局完成后再定位，否则换行后行数增多导致偏上
          requestAnimationFrame(() => {
            diffEditor.getModifiedEditor().revealLineInCenter(firstLine);
          });

          // 给 modified editor 添加行级装饰，minimap 会渲染这些装饰的背景色
          // 简化：只用绿色（added）+ 红色（deleted），不区分 modified 琥珀色
          const modEditor = diffEditor.getModifiedEditor();
          const decorations: editor.IModelDeltaDecoration[] = [];
          for (const change of changes) {
            // const type = change.originalEndLineNumber === 0 ? "added" : "modified";
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
                  className: "diff-minimap-added",
                  overviewRuler: {
                    position: monaco.editor.OverviewRulerLane.Full,
                    color: "rgba(22, 163, 74, 0.6)",
                  },
                },
              });
            }
          }
          modEditor.deltaDecorations([], decorations);
        }
        if (diffComputed) {
          disposable.dispose();
        }
      });

      // 兜底：如果 onDidUpdateDiff 在 800ms 内未触发（Monaco 内部状态残留导致 diff worker 不启动），
      // 强制重新设置 model 触发 diff 计算
      setTimeout(() => {
        if (!editorRef.current || diffComputed) return;
        const editor = editorRef.current;
        const orig = editor.getOriginalEditor().getModel();
        const mod = editor.getModifiedEditor().getModel();
        if (orig && mod) {
          editor.setModel({ original: orig, modified: mod });
        }
        editor.layout();
      }, 800);
    },
    [monacoLang, renderSideBySide, theme],
  );

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
          requestAnimationFrame(() => {
            diffEditor.getModifiedEditor().revealLineInCenter(firstLine);
          });
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
        const firstLine = changes[0].modifiedStartLineNumber;
        requestAnimationFrame(() => {
          diffEditor.getModifiedEditor().revealLineInCenter(firstLine);
        });
      }
      return;
    }
    const disposable = diffEditor.onDidUpdateDiff(() => {
      const ch = diffEditor.getLineChanges();
      if (ch && ch.length > 0) {
        const firstLine = ch[0].modifiedStartLineNumber;
        requestAnimationFrame(() => {
          diffEditor.getModifiedEditor().revealLineInCenter(firstLine);
        });
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
      beforeMount={handleBeforeMount}
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
