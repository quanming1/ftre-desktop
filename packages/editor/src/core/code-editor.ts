/**
 * CodeEditor — 代码编辑器组件
 *
 * 参考 VSCode 的 CodeEditorWidget 设计，简化版实现：
 * - 封装 Monaco Editor 实例
 * - 支持 setModel 切换内容（不销毁 Editor）
 * - 管理 ViewState（光标、滚动位置）
 * - 支持可见性管理（onVisible/onHide）
 */

import type { editor } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { getTextModelService, type IViewState } from "./text-model";

// ══════════════════════════════════════════════════
//  类型定义
// ══════════════════════════════════════════════════

export interface ICodeEditorOptions {
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  minimap?: { enabled: boolean };
  scrollBeyondLastLine?: boolean;
  renderLineHighlight?: "none" | "gutter" | "line" | "all";
  padding?: { top: number; bottom: number };
}

export interface ICodeEditorCallbacks {
  /** 内容变化回调 */
  onDidChangeContent?: (uri: string) => void;
  /** dirty 状态变化回调 */
  onDidChangeDirty?: (uri: string, dirty: boolean) => void;
  /** 光标位置变化回调 */
  onDidChangeCursorPosition?: (line: number, column: number) => void;
  /** 聚焦回调 */
  onDidFocus?: () => void;
  /** 失焦回调 */
  onDidBlur?: () => void;
}

// ══════════════════════════════════════════════════
//  默认配置
// ══════════════════════════════════════════════════

const DEFAULT_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
  lineHeight: 22,
  minimap: { enabled: true },
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
};

// ══════════════════════════════════════════════════
//  CodeEditor 类
// ══════════════════════════════════════════════════

export class CodeEditor {
  private _monaco: typeof Monaco;
  private _editor: editor.IStandaloneCodeEditor;
  private _container: HTMLElement;
  private _currentUri: string | null = null;
  private _visible = true;
  private _disposed = false;

  /** 事件监听器的 disposable */
  private _disposables: Monaco.IDisposable[] = [];

  /** 外部回调 */
  private _callbacks: ICodeEditorCallbacks = {};

  /** 上一次的 dirty 状态，用于检测变化 */
  private _lastDirtyState: boolean = false;

  constructor(
    container: HTMLElement,
    monaco: typeof Monaco,
    options?: ICodeEditorOptions,
  ) {
    this._monaco = monaco;
    this._container = container;

    // 创建 Monaco Editor（不绑定 model）
    this._editor = monaco.editor.create(container, {
      ...DEFAULT_OPTIONS,
      ...options,
      model: null,
    });

    // 设置事件监听
    this._setupEventListeners();
  }

  // ══════════════════════════════════════════════════
  //  属性
  // ══════════════════════════════════════════════════

  get editor(): editor.IStandaloneCodeEditor {
    return this._editor;
  }

  get currentUri(): string | null {
    return this._currentUri;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  // ══════════════════════════════════════════════════
  //  核心操作
  // ══════════════════════════════════════════════════

  /**
   * 设置回调
   */
  setCallbacks(callbacks: ICodeEditorCallbacks): void {
    this._callbacks = callbacks;
  }

  /**
   * 切换到指定 uri 的 model
   * 参考 VSCode CodeEditorWidget.setModel
   */
  setModel(uri: string | null): void {
    if (this._disposed) return;

    // 相同 uri，跳过
    if (this._currentUri === uri) {
      return;
    }

    // 保存当前 model 的 viewState
    if (this._currentUri) {
      this._saveViewState(this._currentUri);
    }

    // 清除旧监听器
    this._clearContentListeners();

    // 设置新 model
    if (uri) {
      const modelService = getTextModelService();
      const modelData = modelService.get(uri);

      if (modelData && !modelData.model.isDisposed()) {
        this._editor.setModel(modelData.model);
        this._currentUri = uri;
        this._lastDirtyState = modelService.isDirty(uri);

        // 恢复 viewState
        this._restoreViewState(uri);

        // 设置内容变化监听
        this._setupContentListener();
      } else {
        // model 不存在，清空
        this._editor.setModel(null);
        this._currentUri = null;
      }
    } else {
      this._editor.setModel(null);
      this._currentUri = null;
    }
  }

  /**
   * 聚焦
   */
  focus(): void {
    if (!this._disposed && this._visible) {
      this._editor.focus();
    }
  }

  /**
   * 是否有焦点
   */
  hasFocus(): boolean {
    return this._editor.hasTextFocus();
  }

  /**
   * 布局
   */
  layout(dimension?: { width: number; height: number }): void {
    if (!this._disposed) {
      this._editor.layout(dimension);
    }
  }

  /**
   * 更新选项
   */
  updateOptions(
    options: editor.IEditorOptions & editor.IGlobalEditorOptions,
  ): void {
    if (!this._disposed) {
      this._editor.updateOptions(options);
    }
  }

  /**
   * 设置可见性
   * 参考 VSCode 的 onVisible/onHide
   */
  setVisible(visible: boolean): void {
    if (this._visible === visible) return;
    this._visible = visible;

    if (visible) {
      // 触发重新布局
      this._editor.layout();
    }
  }

  /**
   * 获取光标位置
   */
  getPosition(): { lineNumber: number; column: number } | null {
    return this._editor.getPosition();
  }

  /**
   * 设置光标位置
   */
  setPosition(position: { lineNumber: number; column: number }): void {
    this._editor.setPosition(position);
  }

  /**
   * 滚动到行
   */
  revealLine(lineNumber: number): void {
    this._editor.revealLineInCenter(lineNumber);
  }

  /**
   * 滚动到位置
   */
  revealPosition(position: { lineNumber: number; column: number }): void {
    this._editor.revealPositionInCenter(position);
  }

  /**
   * 添加 Action
   */
  addAction(action: editor.IActionDescriptor): Monaco.IDisposable {
    return this._editor.addAction(action);
  }

  /**
   * 触发命令
   */
  trigger(source: string, handlerId: string, payload: unknown): void {
    this._editor.trigger(source, handlerId, payload);
  }

  /**
   * 获取选中文本
   */
  getSelectedText(): string | null {
    const selection = this._editor.getSelection();
    if (!selection || selection.isEmpty()) return null;
    return this._editor.getModel()?.getValueInRange(selection) ?? null;
  }

  /**
   * 获取选区
   */
  getSelection(): Monaco.Selection | null {
    return this._editor.getSelection();
  }

  /**
   * 执行编辑操作
   */
  executeEdits(
    source: string,
    edits: editor.IIdentifiedSingleEditOperation[],
  ): void {
    this._editor.executeEdits(source, edits);
  }

  /**
   * 销毁
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // 保存最后的 viewState
    if (this._currentUri) {
      this._saveViewState(this._currentUri);
    }

    // 清理事件监听
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];

    // 销毁 editor（不销毁 model）
    this._editor.dispose();
    this._currentUri = null;
  }

  // ══════════════════════════════════════════════════
  //  内部方法
  // ══════════════════════════════════════════════════

  private _setupEventListeners(): void {
    // 光标位置变化
    this._disposables.push(
      this._editor.onDidChangeCursorPosition((e) => {
        this._callbacks.onDidChangeCursorPosition?.(
          e.position.lineNumber,
          e.position.column,
        );
      }),
    );

    // 聚焦
    this._disposables.push(
      this._editor.onDidFocusEditorText(() => {
        this._callbacks.onDidFocus?.();
      }),
    );

    // 失焦
    this._disposables.push(
      this._editor.onDidBlurEditorText(() => {
        this._callbacks.onDidBlur?.();
      }),
    );
  }

  /** 内容变化监听器的 disposable */
  private _contentDisposable: Monaco.IDisposable | null = null;

  private _setupContentListener(): void {
    this._clearContentListeners();

    this._contentDisposable = this._editor.onDidChangeModelContent(() => {
      if (!this._currentUri) return;

      // 通知内容变化
      this._callbacks.onDidChangeContent?.(this._currentUri);

      // 检查 dirty 状态变化
      const modelService = getTextModelService();
      const dirty = modelService.isDirty(this._currentUri);
      if (dirty !== this._lastDirtyState) {
        this._lastDirtyState = dirty;
        this._callbacks.onDidChangeDirty?.(this._currentUri, dirty);
      }
    });
  }

  private _clearContentListeners(): void {
    if (this._contentDisposable) {
      this._contentDisposable.dispose();
      this._contentDisposable = null;
    }
  }

  private _saveViewState(uri: string): void {
    const viewState = this._editor.saveViewState();
    if (viewState) {
      const modelService = getTextModelService();
      modelService.saveViewState(uri, {
        cursorState: viewState.cursorState,
        viewState: viewState.viewState
          ? {
              scrollTop: viewState.viewState.scrollTop ?? 0,
              scrollLeft: viewState.viewState.scrollLeft,
              firstPosition: viewState.viewState.firstPosition,
              firstPositionDeltaTop: viewState.viewState.firstPositionDeltaTop,
            }
          : null,
      });
    }
  }

  private _restoreViewState(uri: string): void {
    const modelService = getTextModelService();
    const viewState = modelService.getViewState(uri);
    if (viewState && viewState.viewState) {
      this._editor.restoreViewState({
        cursorState: viewState.cursorState ?? [],
        viewState: {
          scrollTop: viewState.viewState.scrollTop,
          scrollTopWithoutViewZones: viewState.viewState.scrollTop,
          scrollLeft: viewState.viewState.scrollLeft,
          firstPosition: viewState.viewState.firstPosition ?? {
            lineNumber: 1,
            column: 1,
          },
          firstPositionDeltaTop: viewState.viewState.firstPositionDeltaTop,
        },
        contributionsState: {},
      });
    }
  }
}

// ══════════════════════════════════════════════════
//  工厂函数
// ══════════════════════════════════════════════════

export function createCodeEditor(
  container: HTMLElement,
  monaco: typeof Monaco,
  options?: ICodeEditorOptions,
): CodeEditor {
  return new CodeEditor(container, monaco, options);
}
