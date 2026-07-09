import { DiffEditor, loader } from "@monaco-editor/react";
import * as monacoEditor from "monaco-editor";
import {
  useCallback,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useMemo,
  memo,
} from "react";
import type { editor } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { registerFtreTheme } from "./theme-registry";
import { getActiveThemeId } from "./themes";
import type { DiffEntry } from "../store/types";

// ════════════════════════════════════════════════════════════════════════
// 踩坑记录（此注释不可删除，后续维护必读）
// ════════════════════════════════════════════════════════════════════════
//
// 【坑 1】CDN 双实例：loader 不配置本地 monaco-editor 时，@monaco-editor/react
//         会从 CDN 加载一个独立 Monaco 实例，导致 defineTheme 注册在 CDN 实例
//         上，而编辑器用的是本地实例，主题/diff 颜色全部不生效。
//         → 修复：loader.config({ monaco: monacoEditor }) 强制使用本地实例。
//
// 【坑 2】行号双列：inline 模式配置（关 original editor 行号）如果只放在
//         useEffect 里，effect 在 mount 后才跑，Monaco 已经渲染了双侧行号。
//         → 修复：必须在 handleMount 里立即设置，effect 只负责后续 renderSideBySide 变化。
//
// 【坑 3】切 tab 触发定位：useRevealPolling/useDiffDecorations 每次渲染返回
//         新对象 { start, stop }，如果直接把对象放进 useEffect 依赖数组，
//         每次渲染都会重跑 effect。revealNonce effect 尤其严重——revealNonce
//         非 0 时每次渲染都调 reveal.start()，导致切 tab 也触发定位。
//         → 修复：解构出 start/stop 作为 stable useCallback，只放 primitive
//           stable 引用到 deps，不放假对象。
//
// 【坑 4】onDidUpdateDiff 提前 dispose：首次 diff 计算完就 dispose 监听器，
//         tab 复用时 @monaco-editor/react 更新 model 触发 diff 重算，但监听
//         已不在，装饰（minimap 标记）不会重新应用 → 第二次点击 minimap 消失。
//         → 修复：onDidUpdateDiff 保持存活不 dispose，每次 diff 重算都应用装饰。
//
// 【坑 5】minimap 颜色 token 无效：decoration 的 minimap.color 用
//         { id: "minimap.background" } 是无效 token，Monaco 不认识，
//         minimap 上的 diff 标记不可见。
//         → 修复：用 { id: "diffEditor.insertedLineBackground" } 等合法主题色。
//
// 【坑 6】deltaDecorations 已废弃：Monaco 0.40+ 标记 deprecated。
//         → 修复：改用 editor.createDecorationsCollection() + collection.set()。
//
// 【坑 7】options 对象每次渲染新建：inline 对象字面量传给 DiffEditor 的
//         options prop 会导致 @monaco-editor/react 的 React.memo 失效，
//         每次 re-render 都穿透到内部更新。
//         → 修复：useMemo 缓存 options，依赖 [renderSideBySide, wordWrap]。
//
// 【坑 8】display:none 导致容器尺寸归零：tab 用 display:none 隐藏时 Monaco
//         容器宽高为 0，automaticLayout 把 editor 压成 0x0，切回来需要手动
//         layout() 重新计算，还要全局事件通知、检查 offsetParent 可见性等。
//         → 修复：InspectorPanel 改用 visibility:hidden + pointer-events:none，
//           容器始终有尺寸，Monaco automaticLayout 全程正常，无需任何补丁。
//           砍掉了 active prop、全局 layout 事件监听、active effect。
//
// 【坑 9】handleMount 依赖数组不稳定：如果 deps 包含每次渲染变化的引用
//         （如 hook 返回的对象），handleMount 会不稳定，虽然 @monaco-editor/react
//         的 onMount 只调一次，但可能导致内部行为异常。
//         → 修复：deps 只放 stable useCallback + 不变的 props。
//
// 【坑 10】reveal 轮询不清理：setInterval 如果不在 unmount 时清理，会持续
//          操作已销毁的 editor，造成内存泄漏 + 报错。
//          → 修复：2 个清理时机——reveal 成功/超时、unmount。
//          （active=false 清理已不需要，见坑 8 改用 visibility:hidden）
//
// 【坑 11】onDidUpdateDiff 不保证首次触发时机：@monaco-editor/react 在
//          setModel 后 diff worker 异步计算，onDidUpdateDiff 可能在 mount
//          回调返回后才触发（此时 editorRef 已就绪），也可能在内容很短时
//          同步触发。纯靠 onDidUpdateDiff 做 reveal 有时序风险。
//          → 修复：主路径用 onDidUpdateDiff（等价 VS Code 的 waitForDiff().then()），
//            兜底用 setInterval 轮询。两者通过 revealPendingRef 协调：
//            onDidUpdateDiff 触发时如果 pending 就 reveal + 清 pending + 停轮询。
// ════════════════════════════════════════════════════════════════════════

// 确保 @monaco-editor/react 使用本地 monaco-editor 实例，而非 CDN 加载的独立实例
// 否则 defineTheme 注册在 CDN 实例上，与本地实例主题不同步（见坑 1）
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
  revealNonce?: number;
  wordWrap?: boolean;
}

// ════════════════════════════════════════════════════════════════════════
// Reveal 行为规格（此注释不可删除）
// ════════════════════════════════════════════════════════════════════════
//
// 「定位到第一个 diff 行」只在以下两种场景触发：
//
//   1. 新 diff tab 首次挂载（handleMount）
//      —— 用户从 Changes 点击变更文件、或从 Edit/Write 工具调用点击打开
//      —— 主路径：onDidUpdateDiff 触发后直接 reveal（等价 VS Code 的
//        waitForDiff().then(() => _goTo(diffs[0]))）
//      —— 兜底路径：setInterval 轮询 getLineChanges()（防 onDidUpdateDiff 时序问题）
//
//   2. tab 复用时内容更新（revealNonce 递增）
//      —— 同一 toolCallId 的 diff tab 被复用，before/after 变了
//      —— 主路径 + 兜底同上
//
// 以下场景【绝不触发】reveal：
//
//   ✗ 切换 tab
//     —— 用户只是想看看之前打开的 diff，不需要重新滚动
//     —— 改用 visibility:hidden 后 Monaco 尺寸不变，连 layout() 都不需要
//
// 协调机制：revealPendingRef
//   - requestReveal() 设 revealPendingRef = true + 启动轮询
//   - onDidUpdateDiff 回调检查 revealPendingRef，为 true 时 reveal + 清 pending + 停轮询
//   - 轮询检查 getLineChanges()，有结果时 reveal + 清 pending + 停轮询
//   - 两条路径谁先拿到结果谁 reveal，后到的因 pending 已清空而跳过
//
// 清理时机（防止内存泄漏，见坑 10）：
//   ① reveal 成功（任一路径）→ clearInterval + revealPendingRef = false
//   ② 超过 REVEAL_POLL_MAX 次 → clearInterval
//   ③ 组件 unmount → clearInterval
// ════════════════════════════════════════════════════════════════════════

const REVEAL_POLL_MS = 10;
const REVEAL_POLL_MAX = 500; // 5 秒后放弃

// ─── useReveal：主路径 onDidUpdateDiff + 兜底轮询，协调 reveal 到第一个变更行 ─
// 返回 stable callbacks。调用方必须解构后再放进 deps（见坑 3）
//
// 参考 VS Code diffEditorWidget.ts:667-680 revealFirstDiff():
//   waitForDiff().then(() => { this._goTo(diffs[0]); })
//   _goTo: setPosition(startLineNumber, 1) + revealRangeInCenter
function useReveal(
  editorRef: React.RefObject<editor.IStandaloneDiffEditor | null>,
) {
  const revealIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // pending 标志：onDidUpdateDiff 和轮询通过它协调，谁先拿到结果谁 reveal（见坑 11）
  const revealPendingRef = useRef(false);

  const doReveal = useCallback(() => {
    const diffEditor = editorRef.current;
    if (!diffEditor) return;
    const changes = diffEditor.getLineChanges();
    if (changes && changes.length > 0) {
      // VS Code 的 _goTo: setPosition + revealLineInCenter
      const firstLine = changes[0].modifiedStartLineNumber;
      diffEditor.getModifiedEditor().setPosition({ lineNumber: firstLine, column: 1 });
      diffEditor.getModifiedEditor().revealLineInCenter(firstLine);
    }
  }, [editorRef]);

  const stop = useCallback(() => {
    if (revealIntervalRef.current !== null) {
      clearInterval(revealIntervalRef.current);
      revealIntervalRef.current = null;
    }
  }, []);

  // onDidUpdateDiff 回调：主路径（等价 VS Code 的 waitForDiff().then()）
  // 由 useDiffDecorations.attachListener 在 onDidUpdateDiff 事件里调用
  const onDiffComputed = useCallback(() => {
    if (!revealPendingRef.current) return;
    doReveal();
    revealPendingRef.current = false;
    stop();
  }, [doReveal, stop]);

  // 请求 reveal：设 pending + 启动兜底轮询
  const request = useCallback(() => {
    revealPendingRef.current = true;
    stop();
    let attempts = 0;
    revealIntervalRef.current = setInterval(() => {
      const diffEditor = editorRef.current;
      if (!diffEditor) {
        attempts++;
        if (attempts >= REVEAL_POLL_MAX) stop();
        return;
      }
      const changes = diffEditor.getLineChanges();
      if (changes && changes.length > 0) {
        doReveal();
        revealPendingRef.current = false;
        stop();
        return;
      }
      attempts++;
      if (attempts >= REVEAL_POLL_MAX) stop();
    }, REVEAL_POLL_MS);
  }, [editorRef, doReveal, stop]);

  // unmount 时兜底清理（见坑 10 ③）
  useEffect(() => () => stop(), [stop]);

  return { request, onDiffComputed, stop };
}

// ─── useDiffDecorations：diff 行装饰（minimap + overview ruler）──────────
// 返回 stable callbacks。
// ⚠️ 调用方必须解构出 init/attachListener/cleanup 再放进 deps（见坑 3）
// onDidUpdateDiff 保持存活不 dispose（见坑 4），每次 diff 重算都重新应用装饰
// onDiffComputed 回调注入：装饰 + reveal 在同一个 onDidUpdateDiff 回调里完成
function useDiffDecorations(
  onDiffComputed: () => void,
) {
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const listenerRef = useRef<Monaco.IDisposable | null>(null);

  const init = useCallback((diffEditor: editor.IStandaloneDiffEditor) => {
    // createDecorationsCollection 替代废弃的 deltaDecorations（见坑 6）
    decorationsRef.current = diffEditor.getModifiedEditor().createDecorationsCollection();
  }, []);

  const attachListener = useCallback((diffEditor: editor.IStandaloneDiffEditor, monaco: typeof Monaco) => {
    listenerRef.current?.dispose();
    // 不 dispose —— 保持存活，每次 diff 重算都应用装饰（见坑 4）
    listenerRef.current = diffEditor.onDidUpdateDiff(() => {
      const changes = diffEditor.getLineChanges();
      if (decorationsRef.current) {
        applyDiffDecorations(monaco, changes ?? [], decorationsRef.current);
      }
      // 主路径 reveal：diff 计算完成时检查 pending（见坑 11）
      onDiffComputed();
    });
  }, [onDiffComputed]);

  const cleanup = useCallback(() => {
    listenerRef.current?.dispose();
    listenerRef.current = null;
    decorationsRef.current?.clear();
    decorationsRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  return { init, attachListener, cleanup };
}

// ─── 主组件 ──────────────────────────────────────────────────────────────
// ⚠️ 用 memo 包装：切 tab 时 InspectorPanel re-render，如果不 memo，
// 即使 props 没变也会重跑 MonacoDiffViewer 内部所有 hooks，
// 导致 @monaco-editor/react 的 DiffEditor 收到新的 options/callbacks 引用，
// 触发 updateOptions → wordWrap 重新应用 → 可见闪烁（见坑 7）
// memo 的默认浅比较足以拦截：string/number/boolean props 不变就不 re-render
export const MonacoDiffViewer = memo(forwardRef<
  MonacoDiffViewerHandle,
  MonacoDiffViewerProps
>(function MonacoDiffViewer(
  { diff, language, renderSideBySide, theme, revealNonce, wordWrap },
  ref,
) {
  const monacoLang = toMonacoLanguage(language);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const actionDisposablesRef = useRef<Monaco.IDisposable[]>([]);

  // ⚠️ 解构出 stable callbacks，不直接把返回对象放进 deps（见坑 3）
  const { request: revealRequest, onDiffComputed, stop: revealStop } = useReveal(editorRef);
  const { init: decorInit, attachListener: decorAttach, cleanup: decorCleanup } = useDiffDecorations(onDiffComputed);

  // ─── beforeMount：仅注册主题 ───────────────────────────────────
  const handleBeforeMount = useCallback(
    (monaco: typeof Monaco) => {
      const themeId = theme ?? getActiveThemeId();
      if (themeId !== "vs" && themeId !== "vs-dark") {
        registerFtreTheme(monaco, themeId);
      }
    },
    [theme],
  );

  // ─── onMount：一次性初始化 ─────────────────────────────────────
  // deps 全为 stable callbacks + 不变的 props，实际只执行一次（见坑 9）
  const handleMount = useCallback(
    (diffEditor: editor.IStandaloneDiffEditor, monaco: typeof Monaco) => {
      editorRef.current = diffEditor;
      monacoRef.current = monaco;

      decorInit(diffEditor);
      decorAttach(diffEditor, monaco);

      // ⚠️ inline 模式配置必须在 mount 时立即设置（见坑 2）
      // 如果只放在 useEffect 里，effect 在 mount 后才跑，
      // Monaco 已经渲染了 original editor 的行号，用户看到双列行号
      if (!renderSideBySide) {
        diffEditor.getOriginalEditor().updateOptions({
          lineNumbers: "off",
          lineNumbersMinChars: 0,
          glyphMargin: false,
          folding: false,
          minimap: { enabled: false },
        });
        diffEditor.getModifiedEditor().updateOptions({
          glyphMargin: false,
          minimap: { enabled: true },
        });
      }

      // wordWrap 右键菜单
      const modEditor = diffEditor.getModifiedEditor();
      const origEditor = diffEditor.getOriginalEditor();
      const toggleWordWrap = () => {
        const current = modEditor.getOption(monaco.editor.EditorOption.wordWrap);
        const next = current === "on" ? "off" : "on";
        modEditor.updateOptions({ wordWrap: next });
        origEditor.updateOptions({ wordWrap: next });
      };
      const actionOpts = {
        id: "ftre-toggle-wordwrap",
        label: "开启/关闭自动换行",
        contextMenuGroupId: "ftre",
        contextMenuOrder: 0,
        run: toggleWordWrap,
      };
      actionDisposablesRef.current.push(modEditor.addAction(actionOpts));
      actionDisposablesRef.current.push(origEditor.addAction(actionOpts));

      // 场景 1：新 tab 首次挂载，请求 reveal（主路径 onDidUpdateDiff + 兜底轮询）
      revealRequest();
    },
    [decorInit, decorAttach, revealRequest, renderSideBySide],
  );

  // ─── inline 模式配置：响应 renderSideBySide 变化 ──────────────
  // mount 时的初始配置在 handleMount 里已做，这里只处理后续变化
  useEffect(() => {
    const diffEditor = editorRef.current;
    if (!diffEditor || renderSideBySide) return;
    diffEditor.getOriginalEditor().updateOptions({
      lineNumbers: "off",
      lineNumbersMinChars: 0,
      glyphMargin: false,
      folding: false,
      minimap: { enabled: false },
    });
    diffEditor.getModifiedEditor().updateOptions({
      glyphMargin: false,
      minimap: { enabled: true },
    });
  }, [renderSideBySide]);

  // ─── revealNonce：内容更新后重新请求 reveal（场景 2）──────────
  // ⚠️ deps 只放 revealNonce + revealRequest（stable），
  //    不放 reveal 对象——否则每次渲染重跑导致切 tab 也触发定位（见坑 3）
  useEffect(() => {
    if (revealNonce === undefined || revealNonce === 0) return;
    revealRequest();
  }, [revealNonce, revealRequest]);

  // ─── unmount cleanup（见坑 10 ③）──────────────────────────────
  useEffect(() => {
    return () => {
      revealStop();
      decorCleanup();
      for (const d of actionDisposablesRef.current) d.dispose();
      actionDisposablesRef.current = [];
    };
  }, [revealStop, decorCleanup]);

  // ─── 暴露方法 ──────────────────────────────────────────────────
  useImperativeHandle(
    ref,
    () => ({
      getCurrentLine: () => {
        const diffEditor = editorRef.current;
        if (!diffEditor) return 1;
        return diffEditor.getModifiedEditor().getPosition()?.lineNumber ?? 1;
      },
      revealFirstDiff: () => revealRequest(),
      ensureMinimap: () => {
        const diffEditor = editorRef.current;
        if (!diffEditor || renderSideBySide) return;
        diffEditor.getModifiedEditor().updateOptions({ minimap: { enabled: true } });
        diffEditor.getOriginalEditor().updateOptions({ minimap: { enabled: false } });
      },
    }),
    [revealRequest, renderSideBySide],
  );

  // ─── memoized options（见坑 7）─────────────────────────────────
  // inline 对象字面量会导致 @monaco-editor/react 的 React.memo 失效
  // 配置参考 VS Code 源码：
  //   - diffEditorDefaultOptions: src/vs/editor/common/config/diffEditor.ts
  //   - Chat codeBlockPart: src/vs/workbench/contrib/chat/browser/widget/chatContentParts/codeBlockPart.ts:720
  //   - getSimpleEditorOptions: src/vs/workbench/contrib/codeEditor/browser/simpleEditorOptions.ts
  const options = useMemo(
    () => ({
      readOnly: true,
      originalEditable: false,
      ignoreTrimWhitespace: false,
      // ── 从 VS Code diffEditorDefaultOptions 借鉴 ──
      diffAlgorithm: 'advanced' as const,      // 高级 diff 算法，更准更快
      renderMarginRevertIcon: false,            // 只读预览不需要 revert 按钮
      renderGutterMenu: false,                  // 只读预览不需要 gutter 菜单
      // ── 从 VS Code chat codeBlockPart + simpleEditorOptions 借鉴 ──
      stickyScroll: { enabled: false },         // 预览不需要 sticky scroll
      fixedOverflowWidgets: true,               // 防止 hover tooltip 被 overflow 裁剪
      renderLineHighlight: 'none' as const,     // 只读预览不需要行高亮
      selectionHighlight: false,                // 只读预览不需要选择高亮
      guides: { indentation: false },           // 预览不需要缩进引导线
      // ── 已有 ──
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
      wordWrap: (wordWrap ? "on" : "off") as "on" | "off",
      scrollbar: {
        verticalScrollbarSize: 12,
        horizontalScrollbarSize: 12,
      },
    }),
    [renderSideBySide, wordWrap],
  );

  const resolvedTheme = theme ?? getActiveThemeId();

  return (
    <DiffEditor
      height="100%"
      language={monacoLang}
      original={diff.originalContent}
      modified={diff.newContent}
      theme={resolvedTheme}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={options}
    />
  );
}));

// ─── 辅助函数 ──────────────────────────────────────────────────

/**
 * 给 modified editor 添加行级装饰：minimap + overview ruler。
 * 使用 createDecorationsCollection.set() 增量更新（见坑 6）。
 *
 * 只装饰 added/modified 行（modifiedStart <= modifiedEnd）。
 * 纯删除行（modifiedStart > modifiedEnd）在 inline 模式下是虚拟行，
 * 无真实行号，由 Monaco 内置 diff 渲染 + 主题色处理。
 *
 * ⚠️ minimap.color 必须用合法的 Monaco 主题色 token（见坑 5）：
 *    "diffEditor.insertedLineBackground" ✓
 *    "minimap.background" ✗ 无效 token
 *
 * ⚠️ overviewRuler.color 同理，用合法主题色 token：
 *    "diffEditorOverviewRuler.insertedForeground" ✓
 */
function applyDiffDecorations(
  monaco: typeof Monaco,
  changes: readonly editor.ILineChange[],
  collection: editor.IEditorDecorationsCollection,
): void {
  const decorations: editor.IModelDeltaDecoration[] = [];

  for (const change of changes) {
    const startLine = change.modifiedStartLineNumber;
    const endLine = change.modifiedEndLineNumber || startLine;
    if (startLine > endLine) continue;

    for (let line = startLine; line <= endLine; line++) {
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          minimap: {
            position: monaco.editor.MinimapPosition.Inline,
            color: { id: "diffEditor.insertedLineBackground" },
          },
          overviewRuler: {
            position: monaco.editor.OverviewRulerLane.Full,
            color: { id: "diffEditorOverviewRuler.insertedForeground" },
          },
        },
      });
    }
  }

  collection.set(decorations);
}
