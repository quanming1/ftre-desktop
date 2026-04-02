/**
 * ManagedEditor — 基于 EditorManager 插槽池架构的编辑器组件
 *
 * 替代 MonacoEditor.tsx（每次切 tab 都销毁/重建 Monaco 实例），
 * 改用 EditorManager 的 attach/detach 机制复用 Monaco 实例：
 *
 * - 切换 tab 时只做 DOM 挂载/卸载（<1ms），不重建编辑器
 * - EditorManager 内部维护 LRU 实例池，自动回收不活跃 slot
 * - viewState（光标/滚动位置）由 EditorManager 自动保存/恢复
 * - ResizeObserver 由 EditorManager.init() 统一管理
 *
 * 使用 React.memo 包装，仅在以下条件变化时重渲染：
 * - file.path 变化（切换文件）
 * - file.loaded 变化（懒加载完成）
 * - file.content 变化（内容更新）
 * - minimapEnabled 变化（用户设置）
 */

import { useRef, useEffect, memo } from "react";
import type { editor } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { editorManager, editorCore } from "../core";
import { saveFile, getHostBridge } from "../runtime";
import { registerFtreTheme } from "./theme-registry";
import type { OpenFile } from "../store/types";

// ── 类型定义 ──

interface ManagedEditorProps {
  file: OpenFile;
  /** 外部传入的 minimap 配置，若不传则从 HostBridge 获取 */
  minimapEnabled?: boolean;
}

// ══════════════════════════════════════════════════
//  setupEditorActions — 仅在新建 slot 时调用一次
// ══════════════════════════════════════════════════

/**
 * 注册编辑器主题、快捷键、光标事件、AI 右键菜单等。
 *
 * 在 EditorManager 新建 slot 时通过 onDidCreate 回调调用。
 * 返回 IDisposable[] 供 EditorManager 在 slot dispose 时统一清理。
 *
 * ⚠️ 此函数定义在组件外部（纯函数），不依赖 React 闭包。
 */
function setupEditorActions(
  ed: editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  filePath: string,
  fileName: string,
): Monaco.IDisposable[] {
  const disposables: Monaco.IDisposable[] = [];

  // ── 主题注册 ──
  registerFtreTheme(monaco);
  monaco.editor.setTheme("ftre-dark");

  // ── Ctrl+S — 统一保存逻辑 ──
  // addCommand 返回 string | null，不是 IDisposable，改用 addAction
  disposables.push(
    ed.addAction({
      id: "ftre-save",
      label: "保存文件",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        saveFile(
          filePath,
          fileName,
          () => ed.getValue(),
          () => {
            // 保存成功后通知 HostBridge 清除修改标记
            try {
              getHostBridge().setModified(filePath, false);
            } catch {
              // HostBridge 未注册时静默忽略
            }
          },
        );
      },
    }),
  );

  // ── 光标位置变化 → StatusBar ──
  disposables.push(
    ed.onDidChangeCursorPosition((e) => {
      window.dispatchEvent(
        new CustomEvent("ftre:cursor-change", {
          detail: { line: e.position.lineNumber, col: e.position.column },
        }),
      );
    }),
  );

  // ── AI 右键菜单：解释代码 ──
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
            // HostBridge 未注册时静默忽略
          }
        }
      },
    }),
  );

  // ── AI 右键菜单：重构代码 ──
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
            // HostBridge 未注册时静默忽略
          }
        }
      },
    }),
  );

  // ── Ctrl+L → 将选中代码插入 Chat 输入框 ──
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
    /** 容器 div ref — EditorManager 会把 slot 的 DOM wrapper 挂到这里 */
    const containerRef = useRef<HTMLDivElement>(null);
    /** 当前 editor 实例引用（attach 返回） */
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    /** 上一次 dirty 状态（用于避免重复通知 HostBridge） */
    const lastDirtyRef = useRef(false);

    // ── 初始化 editorCore 内容（如果还没有的话） ──
    if (!editorCore.hasContent(file.path) && file.loaded) {
      editorCore.setContent(file.path, file.content);
      editorCore.setDiskContent(file.path, file.content);
    }

    // ── Effect 1: 核心 attach/detach 逻辑 ──
    // 当 file.path、file.language 或 file.loaded 变化时重新 attach
    useEffect(() => {
      const container = containerRef.current;
      if (!container || !file.loaded) return;
      if (!editorManager.isInitialized()) return;

      // 优先使用 editorCore 缓存的内容（可能包含未保存的修改），
      // 回退到 file.content（来自 store 的原始内容）
      const content = editorCore.hasContent(file.path)
        ? editorCore.getContent(file.path)
        : file.content;

      const ed = editorManager.attach({
        path: file.path,
        language: file.language,
        content,
        container,

        // onDidCreate 仅在新建 slot 时调用（复用已有 slot 时不会触发）
        onDidCreate: (editor, monaco) => {
          return setupEditorActions(editor, monaco, file.path, file.name);
        },

        // onDidChangeContent 每次 attach 都会更新闭包引用
        onDidChangeContent: (newContent) => {
          // 同步到 editorCore（非响应式存储）
          editorCore.setContent(file.path, newContent);

          // 检测 dirty 状态变化，通知 HostBridge 更新标题栏修改标记
          const dirty = editorCore.isDirty(file.path);
          if (dirty !== lastDirtyRef.current) {
            lastDirtyRef.current = dirty;
            try {
              getHostBridge().setModified(file.path, dirty);
            } catch {
              // HostBridge 未注册时静默忽略
            }
          }
        },
      });

      if (ed) {
        editorRef.current = ed;

        // 注册到 editorCore 实例表（向后兼容：外部代码可能通过 editorCore.getInstance 获取）
        editorCore.registerInstance(file.path, ed);

        // 派发初始光标位置到 StatusBar
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
        // 卸载前保存内容到 editorCore（防止切换 tab 时丢失未保存的修改）
        if (editorRef.current) {
          const val = editorRef.current.getValue();
          const cached = editorCore.getContent(file.path);

          // 安全保护：如果当前实例是空白，但缓存里已有非空内容，
          // 则保留缓存，避免空内容污染已打开文件
          if (!(val === "" && cached !== "")) {
            editorCore.setContent(file.path, val);
          }
        }

        editorManager.detach(file.path);
        editorCore.unregisterInstance(file.path);
        editorRef.current = null;
      };
    }, [file.path, file.language, file.loaded]);

    // ── Effect 2: 懒加载 — 首次激活时从磁盘读取内容 ──
    // 恢复的占位 tab / 搜索结果占位 tab 首次激活时再读取磁盘内容
    useEffect(() => {
      if (
        file.loaded ||
        editorCore.hasContent(file.path) ||
        file.path.startsWith("diff:") ||
        file.path.startsWith("untitled:")
      ) {
        return;
      }

      let cancelled = false;

      (async () => {
        try {
          const bridge = getHostBridge();
          const result = await bridge.readFile(file.path);
          if (cancelled) return;

          if (!result.error) {
            bridge.hydrateFileContent(
              file.path,
              result.content,
              result.language || file.language,
            );
            return;
          }

          bridge.notifyError(`无法读取文件：${file.path}`);
          bridge.closeFile(file.path);
        } catch {
          if (cancelled) return;
          try {
            const bridge = getHostBridge();
            bridge.notifyError(`无法读取文件：${file.path}`);
            bridge.closeFile(file.path);
          } catch {
            // HostBridge 未注册时静默忽略
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [file.path, file.language, file.loaded]);

    // ── Effect 3: 内容同步 — hydrate 后保底同步到 editor ──
    // 当 file.loaded 或 file.content 变化时，检查 editor 是否显示过时/空白内容
    useEffect(() => {
      if (!file.loaded) return;
      if (!editorManager.isInitialized()) return;

      const ed = editorRef.current;
      if (!ed) return;
      if (!editorCore.hasContent(file.path)) return;

      const cachedContent = editorCore.getContent(file.path);
      const currentValue = ed.getValue();
      if (currentValue === cachedContent) return;

      const isCurrentDirty = editorCore.isDirty(file.path);

      // 如果当前 editor 是空白，而缓存里已经有内容 → 强制恢复缓存
      if (currentValue === "" && cachedContent !== "") {
        editorManager.setContent(file.path, cachedContent);
        return;
      }

      // 如果当前不是脏状态，说明没有用户本地修改，也可以安全同步缓存
      if (!isCurrentDirty) {
        editorManager.setContent(file.path, cachedContent);
      }
    }, [file.path, file.loaded, file.content]);

    // ── Effect 4: minimap 更新 ──
    useEffect(() => {
      if (!editorManager.isInitialized()) return;

      // 如果没有通过 props 传入 minimapEnabled，则从 HostBridge 获取
      let enabled: boolean;
      if (minimapEnabled !== undefined) {
        enabled = minimapEnabled;
      } else {
        try {
          enabled = getHostBridge().getMinimapEnabled();
        } catch {
          enabled = true; // 默认启用
        }
      }

      editorManager.updateOptions({ minimap: { enabled } });
    }, [minimapEnabled]);

    // ── Effect 5: window 事件监听器（统一注册/清理） ──
    useEffect(() => {
      // ftre:apply-code — 在光标位置插入代码
      const handleApplyCode = (e: Event) => {
        const { code, targetFile } = (e as CustomEvent).detail;
        if (targetFile && targetFile !== file.path) return;
        const ed = editorRef.current;
        const monaco = editorManager.getMonaco();
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

      // ftre:undo / ftre:redo — TitleBar 编辑菜单
      const handleUndo = () => editorRef.current?.trigger("menu", "undo", null);
      const handleRedo = () => editorRef.current?.trigger("menu", "redo", null);

      // ftre:change-language — StatusBar 语言切换
      const handleChangeLanguage = (e: Event) => {
        try {
          if (getHostBridge().getActiveFile() !== file.path) return;
        } catch {
          return;
        }
        const { language } = (e as CustomEvent<{ language: string }>).detail;
        if (!language) return;

        // 通过 EditorManager 更新语言（同时处理 slot 和预加载 model）
        editorManager.setLanguage(file.path, language);

        try {
          getHostBridge().setFileLanguage(file.path, language);
        } catch {
          // HostBridge 未注册时静默忽略
        }
      };

      // ftre:reveal-line — 跳转到指定行（来自 ProblemsPanel）
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

      // ftre:save-active — TitleBar 保存菜单
      const handleSave = () => {
        try {
          if (getHostBridge().getActiveFile() !== file.path) return;
        } catch {
          return;
        }
        const ed = editorRef.current;
        if (!ed) return;
        saveFile(
          file.path,
          file.name,
          () => ed.getValue(),
          () => {
            lastDirtyRef.current = false;
          },
        );
      };

      // ftre:find-in-editor — TitleBar 查找菜单
      const handleFind = () => {
        try {
          if (getHostBridge().getActiveFile() !== file.path) return;
        } catch {
          return;
        }
        editorRef.current?.trigger("menu", "actions.find", null);
      };

      // ftre:replace-in-editor — TitleBar 替换菜单
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

      // 批量注册事件监听
      window.addEventListener("ftre:apply-code", handleApplyCode);
      window.addEventListener("ftre:undo", handleUndo);
      window.addEventListener("ftre:redo", handleRedo);
      window.addEventListener("ftre:change-language", handleChangeLanguage);
      window.addEventListener("ftre:reveal-line", handleRevealLine);
      window.addEventListener("ftre:save-active", handleSave);
      window.addEventListener("ftre:find-in-editor", handleFind);
      window.addEventListener("ftre:replace-in-editor", handleReplace);

      // 批量清理
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

    // ── 渲染：只输出一个容器 div，EditorManager 把 slot wrapper 挂到里面 ──
    return (
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", position: "relative" }}
      />
    );
  },

  // 自定义比较函数：仅在关键属性变化时重渲染
  (prevProps, nextProps) => {
    return (
      prevProps.file.path === nextProps.file.path &&
      prevProps.file.loaded === nextProps.file.loaded &&
      prevProps.file.content === nextProps.file.content &&
      prevProps.minimapEnabled === nextProps.minimapEnabled
    );
  },
);
