/**
 * TextCodeEditorPane - 代码编辑器面板
 *
 * 参考 VSCode: vs/workbench/browser/parts/editor/textCodeEditor.ts
 *
 * 核心职责:
 * 1. 管理 Monaco Editor 实例（复用，不销毁）
 * 2. 实现 setInput/clearInput 逻辑
 * 3. ViewState 保存和恢复（同步，无动画）
 * 4. 支持 FileEditorInput 和 UntitledEditorInput
 */

import type * as monaco from "monaco-editor";
import type { ICodeEditorViewState } from "../common/editorCommon";
import type { ICodeEditor } from "../browser/editorBrowser";
import {
  EditorPane,
  type IEditorGroup,
  type IEditorOpenContext,
  type IEditorOptions,
  type IDimension,
  type IEditorCloseEvent,
  createEditorPaneDescriptor,
  type IEditorPaneDescriptor,
} from "./editorPane";
import {
  EditorInput,
  FileEditorInput,
  UntitledEditorInput,
} from "./editorInput";
import { getEditorMemento, type IEditorMemento } from "./editorMemento";
import {
  getTextModelResolverService,
  type IResolvedTextModelReference,
  type ITextModelContentOptions,
} from "./textModelResolverService";

// ═══════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 编辑器创建选项
 */
export interface ITextCodeEditorOptions {
  /** 字体大小 */
  fontSize?: number;
  /** 字体族 */
  fontFamily?: string;
  /** 行高 */
  lineHeight?: number;
  /** 是否显示 minimap */
  minimap?: { enabled: boolean };
  /** 是否滚动超过最后一行 */
  scrollBeyondLastLine?: boolean;
  /** 行高亮模式 */
  renderLineHighlight?: "none" | "gutter" | "line" | "all";
  /** 内边距 */
  padding?: { top: number; bottom: number };
  /** 主题 */
  theme?: string;
  /** 是否平滑滚动 */
  smoothScrolling?: boolean;
  /** 只读模式 */
  readOnly?: boolean;
}

/**
 * 编辑器事件回调
 */
export interface ITextCodeEditorCallbacks {
  /** 内容变化回调 */
  onDidChangeContent?: (resource: string) => void;
  /** dirty 状态变化回调 */
  onDidChangeDirty?: (resource: string, dirty: boolean) => void;
  /** 光标位置变化回调 */
  onDidChangeCursorPosition?: (line: number, column: number) => void;
  /** 焦点变化回调 */
  onDidFocusEditorText?: () => void;
  /** 失焦回调 */
  onDidBlurEditorText?: () => void;
  /** 保存请求回调 */
  onSaveRequest?: (resource: string, content: string) => Promise<boolean>;
  /** 添加到聊天回调 */
  onAddToChat?: (message: string) => void;
}

/**
 * 扩展的编辑器选项（包含 selection）
 */
export interface ITextEditorOptions extends IEditorOptions {
  /** 光标/选区位置 */
  selection?: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber?: number;
    endColumn?: number;
  };
  /** 选区显示方式 */
  selectionRevealType?:
    | "center"
    | "centerIfOutsideViewport"
    | "nearTop"
    | "nearTopIfOutsideViewport";
}

/**
 * 内容提供者接口
 *
 * 用于从外部获取文件内容（因为 EditorInput 本身不存储内容）
 */
export interface ITextContentProvider {
  /**
   * 获取资源内容
   * @param resource 资源路径
   * @returns 内容和语言
   */
  getContent(
    resource: string,
  ): Promise<{ content: string; language: string } | undefined>;
}

// ═══════════════════════════════════════════════════════════════════════════
// TextCodeEditorPane 实现
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 代码编辑器面板
 *
 * 继承自 EditorPane，实现代码编辑器的具体逻辑
 */
export class TextCodeEditorPane extends EditorPane<ICodeEditorViewState> {
  /** 面板类型 ID */
  static readonly ID = "workbench.editor.textCodeEditorPane";

  /** Monaco 编辑器实例 */
  private _editorControl: monaco.editor.IStandaloneCodeEditor | null = null;

  /** Monaco 实例引用 */
  private _monaco: typeof monaco | null = null;

  /** 当前模型引用 */
  private _modelReference: IResolvedTextModelReference | null = null;

  /** ViewState Memento */
  private _viewStateMemento: IEditorMemento<ICodeEditorViewState>;

  /** 编辑器创建选项 */
  private readonly _editorOptions: ITextCodeEditorOptions;

  /** 事件回调 */
  private _callbacks: ITextCodeEditorCallbacks = {};

  /** 内容提供者 */
  private _contentProvider: ITextContentProvider | null = null;

  /** 事件订阅清理函数 */
  private readonly _eventDisposables: monaco.IDisposable[] = [];

  /** 上一次的 dirty 状态（用于检测变化） */
  private _lastDirtyState: boolean = false;

  /** 当前资源路径 */
  private _currentResource: string | null = null;

  /**
   * 构造函数
   *
   * @param group 所属编辑器组
   * @param monacoInstance Monaco 实例
   * @param options 编辑器选项
   */
  constructor(
    group: IEditorGroup,
    monacoInstance: typeof monaco,
    options?: ITextCodeEditorOptions,
  ) {
    super(TextCodeEditorPane.ID, group);

    this._monaco = monacoInstance;
    this._editorOptions = options || {};

    // 初始化 ViewState Memento
    this._viewStateMemento = getEditorMemento<ICodeEditorViewState>(
      TextCodeEditorPane.ID,
      "viewState",
      100, // 最大缓存 100 个
      true, // 跨编辑器组共享
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 公共 API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 获取编辑器控件
   */
  getControl(): ICodeEditor | null {
    return this._editorControl as ICodeEditor | null;
  }

  /**
   * 设置事件回调
   */
  setCallbacks(callbacks: ITextCodeEditorCallbacks): void {
    this._callbacks = callbacks;
  }

  /**
   * 设置内容提供者
   */
  setContentProvider(provider: ITextContentProvider): void {
    this._contentProvider = provider;
  }

  /**
   * 更新编辑器选项
   */
  updateEditorOptions(options: Partial<ITextCodeEditorOptions>): void {
    if (this._editorControl) {
      this._editorControl.updateOptions(
        options as monaco.editor.IEditorOptions,
      );
    }
  }

  /**
   * 获取当前资源路径
   */
  getCurrentResource(): string | null {
    return this._currentResource;
  }

  /**
   * 检查是否有未保存的更改
   */
  isDirty(): boolean {
    if (!this._currentResource) {
      return false;
    }
    return getTextModelResolverService().isDirty(this._currentResource);
  }

  /**
   * 标记为已保存
   */
  markSaved(): void {
    if (this._currentResource) {
      getTextModelResolverService().markSaved(this._currentResource);
      this._updateDirtyState();
    }
  }

  /**
   * 获取用于保存的内容
   */
  getContentForSave(): string | undefined {
    if (!this._currentResource) {
      return undefined;
    }
    return getTextModelResolverService().getContentForSave(
      this._currentResource,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EditorPane 生命周期实现
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 创建编辑器（只调用一次）
   */
  protected createEditor(parent: HTMLElement): void {
    if (!this._monaco) {
      throw new Error("Monaco instance not provided");
    }

    // 创建编辑器容器
    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.overflow = "hidden";
    parent.appendChild(container);

    // 合并默认选项和用户选项
    const defaultOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
      value: "",
      language: "plaintext",
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
      lineHeight: 22,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderLineHighlight: "line",
      padding: { top: 10, bottom: 10 },
      smoothScrolling: false, // 关键：禁用平滑滚动
      cursorBlinking: "blink",
      cursorSmoothCaretAnimation: "off", // 关键：禁用光标动画
      bracketPairColorization: { enabled: true },
      automaticLayout: false, // 使用手动 layout
      renderValidationDecorations: "off",
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      scrollbar: {
        verticalScrollbarSize: 5,
        horizontalScrollbarSize: 5,
      },
    };

    const options = {
      ...defaultOptions,
      ...this._editorOptions,
    };

    // 创建 Monaco Editor 实例
    this._editorControl = this._monaco.editor.create(container, options);

    // 设置事件监听
    this._setupEventListeners();
  }

  /**
   * 设置编辑器输入
   *
   * 这是切换文件的核心方法
   */
  async setInput(
    input: EditorInput,
    options: ITextEditorOptions | undefined,
    context: IEditorOpenContext,
  ): Promise<void> {
    // 设置输入和选项
    this._input = input;
    this._options = options;

    if (!this._editorControl || !this._monaco) {
      return;
    }

    // 获取资源路径
    const resource = input.resource;
    if (!resource) {
      throw new Error("EditorInput must have a resource");
    }

    // 如果是相同资源，只需要应用选项
    if (this._currentResource === resource && this._modelReference) {
      this._applyEditorOptions(options);
      return;
    }

    // 1. 解析/创建 TextModel
    const modelRef = await this._resolveModel(input);
    if (!modelRef) {
      throw new Error(`Failed to resolve model for: ${resource}`);
    }

    // 释放旧的模型引用
    this._modelReference?.dispose();
    this._modelReference = modelRef;
    this._currentResource = resource;

    // 2. 设置 Model（复用编辑器实例）
    this._editorControl.setModel(modelRef.model as monaco.editor.ITextModel);

    // 3. 恢复 ViewState（同步，ScrollType.Immediate）
    const shouldRestore = this._shouldRestoreViewState(input, context);
    if (shouldRestore) {
      const viewState = this._loadViewState(resource);
      if (viewState) {
        this._editorControl.restoreViewState(viewState);
      }
    }

    // 4. 应用编辑器选项（selection 等）
    this._applyEditorOptions(options);

    // 5. 重置 dirty 状态跟踪
    this._lastDirtyState = this.isDirty();
  }

  /**
   * 清除编辑器输入
   *
   * 在切换到另一个文件之前调用
   */
  clearInput(): void {
    // 保存当前 ViewState
    if (this._currentResource && this._editorControl) {
      this._saveViewState();
    }

    // 释放模型引用
    this._modelReference?.dispose();
    this._modelReference = null;
    this._currentResource = null;

    // 清除编辑器模型（但不销毁编辑器）
    if (this._editorControl) {
      this._editorControl.setModel(null);
    }

    // 调用父类
    super.clearInput();
  }

  /**
   * 设置编辑器可见性
   *
   * 基类会处理 onWillCloseEditor 监听器的注册/注销
   */
  protected setEditorVisible(visible: boolean): void {
    super.setEditorVisible(visible);

    if (!visible && this._currentResource) {
      // 隐藏时保存 ViewState
      this._saveViewState();
    }
  }

  /**
   * 编辑器即将关闭回调
   *
   * 参考 VSCode: AbstractEditorWithViewState.onWillCloseEditor
   * 在关闭时更新 ViewState（保存或清理）
   */
  protected override onWillCloseEditor(event: IEditorCloseEvent): void {
    if (!this._currentResource) {
      return;
    }

    // 根据编辑器类型决定是否保留 ViewState
    // 参考 VSCode: tracksDisposedEditorViewState()
    // - 文件编辑器：保留 ViewState（重新打开可恢复光标位置）
    // - 其他编辑器：清理 ViewState
    if (this._shouldKeepViewState(event.editor)) {
      // 保存 ViewState 以便重新打开时恢复
      this._saveViewState();
    } else {
      // 清理 ViewState
      this._viewStateMemento.clearEditorState(
        this._currentResource,
        this.group.id,
      );
    }
  }

  /**
   * 检查是否应该保留 ViewState
   *
   * 参考 VSCode: tracksDisposedEditorViewState()
   * 默认返回 false（不跟踪已 dispose 的编辑器状态）
   * 文件编辑器重写为 true（保留状态）
   */
  protected _shouldKeepViewState(editor: EditorInput): boolean {
    // 文件编辑器保留 ViewState，因为文件可以重新打开
    return editor instanceof FileEditorInput;
  }

  /**
   * 获取当前 ViewState
   */
  getViewState(): ICodeEditorViewState | undefined {
    if (!this._editorControl) {
      return undefined;
    }
    return this._editorControl.saveViewState() || undefined;
  }

  /**
   * 获取焦点
   */
  focus(): void {
    if (this._editorControl) {
      this._editorControl.focus();
    }
  }

  /**
   * 检查是否有焦点
   */
  hasFocus(): boolean {
    if (!this._editorControl) {
      return false;
    }
    return this._editorControl.hasTextFocus();
  }

  /**
   * 布局
   */
  layout(dimension: IDimension): void {
    if (this._editorControl) {
      this._editorControl.layout(dimension);
    }
  }

  /**
   * 销毁
   */
  dispose(): void {
    // 保存 ViewState
    if (this._currentResource) {
      this._saveViewState();
    }

    // 清理事件订阅
    for (const disposable of this._eventDisposables) {
      disposable.dispose();
    }
    this._eventDisposables.length = 0;

    // 释放模型引用
    this._modelReference?.dispose();
    this._modelReference = null;

    // 销毁编辑器
    if (this._editorControl) {
      this._editorControl.dispose();
      this._editorControl = null;
    }

    // 调用父类
    super.dispose();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 解析 EditorInput 获取 TextModel
   */
  private async _resolveModel(
    input: EditorInput,
  ): Promise<IResolvedTextModelReference | null> {
    const service = getTextModelResolverService();

    // 初始化服务（如果尚未初始化）
    if (!service.isInitialized() && this._monaco) {
      service.init(this._monaco);
    }

    const resource = input.resource;
    if (!resource) {
      return null;
    }

    // 检查模型是否已存在
    if (service.hasModel(resource)) {
      return service.createModelReference(resource);
    }

    // 需要创建新模型 - 获取内容
    let options: ITextModelContentOptions;

    if (input instanceof FileEditorInput) {
      // FileEditorInput: 通过内容提供者获取内容
      if (this._contentProvider) {
        const result = await this._contentProvider.getContent(resource);
        options = {
          content: result?.content || "",
          language: result?.language || input.language || "plaintext",
        };
      } else {
        // 没有内容提供者，使用空内容
        options = {
          content: "",
          language: input.language || "plaintext",
        };
      }
    } else if (input instanceof UntitledEditorInput) {
      // UntitledEditorInput: 使用 content 属性
      options = {
        content: input.content || "",
        language: input.language || "plaintext",
      };
    } else {
      // 未知类型，使用空内容
      options = {
        content: "",
        language: "plaintext",
      };
    }

    return service.createModelReference(resource, options);
  }

  /**
   * 判断是否应该恢复 ViewState
   *
   * 参考 VSCode: shouldRestoreTextEditorViewState
   */
  private _shouldRestoreViewState(
    _input: EditorInput,
    context: IEditorOpenContext,
  ): boolean {
    // 如果是恢复的编辑器（如重新打开窗口），恢复 ViewState
    if (context.restored) {
      return true;
    }

    // 如果不是新打开的编辑器（如切换标签），恢复 ViewState
    if (!context.newInGroup) {
      return true;
    }

    // 其他情况不恢复（让 options.selection 生效）
    return false;
  }

  /**
   * 保存 ViewState 到 Memento
   */
  private _saveViewState(): void {
    if (!this._editorControl || !this._currentResource) {
      return;
    }

    const viewState = this._editorControl.saveViewState();
    if (viewState) {
      this._viewStateMemento.saveEditorState(
        this.group.id,
        this._currentResource,
        viewState,
      );
    }
  }

  /**
   * 从 Memento 加载 ViewState
   */
  private _loadViewState(resource: string): ICodeEditorViewState | undefined {
    return this._viewStateMemento.loadEditorState(this.group.id, resource);
  }

  /**
   * 应用编辑器选项（selection 等）
   */
  private _applyEditorOptions(options?: ITextEditorOptions): void {
    if (!this._editorControl || !options) {
      return;
    }

    // 应用 selection
    if (options.selection) {
      const sel = options.selection;
      const selection: monaco.IRange = {
        startLineNumber: sel.startLineNumber,
        startColumn: sel.startColumn,
        endLineNumber: sel.endLineNumber ?? sel.startLineNumber,
        endColumn: sel.endColumn ?? sel.startColumn,
      };

      this._editorControl.setSelection(selection);

      // 根据 selectionRevealType 滚动到选区
      // 使用 Monaco 的 ScrollType.Immediate (值为 1)
      const revealType =
        options.selectionRevealType || "centerIfOutsideViewport";
      const scrollType = 1; // monaco.editor.ScrollType.Immediate

      switch (revealType) {
        case "center":
          this._editorControl.revealRangeInCenter(selection, scrollType);
          break;
        case "centerIfOutsideViewport":
          this._editorControl.revealRangeInCenterIfOutsideViewport(
            selection,
            scrollType,
          );
          break;
        case "nearTop":
          this._editorControl.revealRangeNearTop(selection, scrollType);
          break;
        case "nearTopIfOutsideViewport":
          this._editorControl.revealRangeNearTopIfOutsideViewport(
            selection,
            scrollType,
          );
          break;
      }
    }

    // 应用 viewState（如果提供）
    if (options.viewState) {
      this._editorControl.restoreViewState(
        options.viewState as ICodeEditorViewState,
      );
    }
  }

  /**
   * 设置事件监听
   */
  private _setupEventListeners(): void {
    if (!this._editorControl) {
      return;
    }

    const editor = this._editorControl;

    // 内容变化
    this._eventDisposables.push(
      editor.onDidChangeModelContent(() => {
        if (this._currentResource) {
          this._callbacks.onDidChangeContent?.(this._currentResource);
          this._updateDirtyState();
        }
      }),
    );

    // 光标位置变化
    this._eventDisposables.push(
      editor.onDidChangeCursorPosition((e) => {
        this._callbacks.onDidChangeCursorPosition?.(
          e.position.lineNumber,
          e.position.column,
        );
      }),
    );

    // 焦点变化
    this._eventDisposables.push(
      editor.onDidFocusEditorText(() => {
        this._callbacks.onDidFocusEditorText?.();
      }),
    );

    this._eventDisposables.push(
      editor.onDidBlurEditorText(() => {
        this._callbacks.onDidBlurEditorText?.();
      }),
    );

    // 添加保存命令 (Ctrl+S / Cmd+S)
    this._eventDisposables.push(
      editor.addAction({
        id: "ftre.save",
        label: "Save",
        keybindings: [
          this._monaco!.KeyMod.CtrlCmd | this._monaco!.KeyCode.KeyS,
        ],
        run: async () => {
          await this._handleSave();
        },
      }),
    );

    // 添加到聊天命令 (Ctrl+L / Cmd+L)
    this._eventDisposables.push(
      editor.addAction({
        id: "ftre.addToChat",
        label: "Add to Chat",
        keybindings: [
          this._monaco!.KeyMod.CtrlCmd | this._monaco!.KeyCode.KeyL,
        ],
        contextMenuGroupId: "9_cutcopypaste",
        contextMenuOrder: 5,
        run: () => {
          this._handleAddToChat();
        },
      }),
    );

    // 解释代码命令（右键菜单）
    this._eventDisposables.push(
      editor.addAction({
        id: "ftre.explainCode",
        label: "Explain Code",
        contextMenuGroupId: "9_cutcopypaste",
        contextMenuOrder: 6,
        run: () => {
          this._handleAddToChat("Explain this code:\n");
        },
      }),
    );

    // 重构代码命令（右键菜单）
    this._eventDisposables.push(
      editor.addAction({
        id: "ftre.refactorCode",
        label: "Refactor Code",
        contextMenuGroupId: "9_cutcopypaste",
        contextMenuOrder: 7,
        run: () => {
          this._handleAddToChat("Refactor this code:\n");
        },
      }),
    );
  }

  /**
   * 更新 dirty 状态
   */
  private _updateDirtyState(): void {
    const isDirty = this.isDirty();
    if (isDirty !== this._lastDirtyState) {
      this._lastDirtyState = isDirty;
      if (this._currentResource) {
        this._callbacks.onDidChangeDirty?.(this._currentResource, isDirty);
      }
    }
  }

  /**
   * 处理添加到聊天
   */
  private _handleAddToChat(prefix: string = ""): void {
    if (!this._editorControl || !this._callbacks.onAddToChat) {
      return;
    }

    const selection = this._editorControl.getSelection();
    if (!selection) {
      return;
    }

    const model = this._editorControl.getModel();
    if (!model) {
      return;
    }

    const selectedText = model.getValueInRange(selection);
    if (!selectedText) {
      return;
    }

    const fileName = this._currentResource
      ? this._currentResource.split(/[\\/]/).pop() || ""
      : "";

    const message = `${prefix}\`\`\`${fileName}\n${selectedText}\n\`\`\``;
    this._callbacks.onAddToChat(message);
  }

  /**
   * 处理保存
   */
  private async _handleSave(): Promise<void> {
    if (!this._currentResource || !this._callbacks.onSaveRequest) {
      return;
    }

    const content = this.getContentForSave();
    if (content === undefined) {
      return;
    }

    const success = await this._callbacks.onSaveRequest(
      this._currentResource,
      content,
    );

    if (success) {
      this.markSaved();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EditorPane 描述符
// ═══════════════════════════════════════════════════════════════════════════

/**
 * TextCodeEditorPane 描述符
 *
 * 用于 EditorPanes 注册和查找
 */
export const textCodeEditorPaneDescriptor: IEditorPaneDescriptor =
  createEditorPaneDescriptor(TextCodeEditorPane.ID, "Text Code Editor", [
    FileEditorInput.TYPE_ID,
    UntitledEditorInput.TYPE_ID,
  ]);

// ═══════════════════════════════════════════════════════════════════════════
// 工厂函数
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 创建 TextCodeEditorPane 实例
 */
export function createTextCodeEditorPane(
  group: IEditorGroup,
  monacoInstance: typeof monaco,
  options?: ITextCodeEditorOptions,
  contentProvider?: ITextContentProvider,
): TextCodeEditorPane {
  const pane = new TextCodeEditorPane(group, monacoInstance, options);
  if (contentProvider) {
    pane.setContentProvider(contentProvider);
  }
  return pane;
}
