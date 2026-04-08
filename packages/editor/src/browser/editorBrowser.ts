/**
 * editorBrowser.ts — 浏览器编辑器接口定义
 *
 * 参考 VSCode 的 vs/editor/browser/editorBrowser.ts
 * 定义浏览器环境下的编辑器接口
 */

import type {
  editor,
  IDisposable,
  IPosition,
  IRange,
  ISelection,
} from "monaco-editor";
import type {
  IEditor,
  ITextModel,
  ICodeEditorViewState,
  IModelContentChangedEvent,
  IModelChangedEvent,
  ICursorPositionChangedEvent,
  ICursorSelectionChangedEvent,
  IScrollEvent,
  IIdentifiedSingleEditOperation,
  Event,
  ScrollType,
  IEditorContribution,
} from "../common/editorCommon";

// ══════════════════════════════════════════════════
//  鼠标目标类型
// ══════════════════════════════════════════════════

/**
 * 鼠标目标类型枚举
 * 对应 VSCode 的 MouseTargetType
 */
export const enum MouseTargetType {
  /**
   * 未知目标
   */
  UNKNOWN = 0,
  /**
   * textarea 区域
   */
  TEXTAREA = 1,
  /**
   * 字形边距
   */
  GUTTER_GLYPH_MARGIN = 2,
  /**
   * 行号
   */
  GUTTER_LINE_NUMBERS = 3,
  /**
   * 行装饰
   */
  GUTTER_LINE_DECORATIONS = 4,
  /**
   * 视图区域
   */
  GUTTER_VIEW_ZONE = 5,
  /**
   * 内容文本
   */
  CONTENT_TEXT = 6,
  /**
   * 空白内容
   */
  CONTENT_EMPTY = 7,
  /**
   * 内容视图区域
   */
  CONTENT_VIEW_ZONE = 8,
  /**
   * 内容小部件
   */
  CONTENT_WIDGET = 9,
  /**
   * 概览标尺
   */
  OVERVIEW_RULER = 10,
  /**
   * 滚动条
   */
  SCROLLBAR = 11,
  /**
   * 覆盖小部件
   */
  OVERLAY_WIDGET = 12,
  /**
   * 视口外
   */
  OUTSIDE_EDITOR = 13,
}

/**
 * 鼠标目标接口
 */
export interface IMouseTarget {
  /**
   * 目标元素
   */
  readonly element: HTMLElement | null;
  /**
   * 目标类型
   */
  readonly type: MouseTargetType;
  /**
   * 目标位置
   */
  readonly position: IPosition | null;
  /**
   * 鼠标列
   */
  readonly mouseColumn: number;
  /**
   * 目标范围
   */
  readonly range: IRange | null;
}

// ══════════════════════════════════════════════════
//  小部件接口
// ══════════════════════════════════════════════════

/**
 * 内容小部件位置首选项
 */
export const enum ContentWidgetPositionPreference {
  /**
   * 精确位置
   */
  EXACT = 0,
  /**
   * 在行上方
   */
  ABOVE = 1,
  /**
   * 在行下方
   */
  BELOW = 2,
}

/**
 * 内容小部件位置
 */
export interface IContentWidgetPosition {
  /**
   * 期望的位置
   */
  position: IPosition | null;
  /**
   * 辅助位置
   */
  secondaryPosition?: IPosition | null;
  /**
   * 位置首选项（按优先级排序）
   */
  preference: ContentWidgetPositionPreference[];
  /**
   * 位置亲和性
   */
  positionAffinity?: editor.PositionAffinity;
}

/**
 * 内容小部件接口
 */
export interface IContentWidget {
  /**
   * 是否允许编辑器溢出
   */
  allowEditorOverflow?: boolean;
  /**
   * 是否抑制鼠标按下
   */
  suppressMouseDown?: boolean;
  /**
   * 获取小部件 ID
   */
  getId(): string;
  /**
   * 获取 DOM 节点
   */
  getDomNode(): HTMLElement;
  /**
   * 获取位置
   */
  getPosition(): IContentWidgetPosition | null;
  /**
   * 位置变化前回调
   */
  beforeRender?(): editor.IDimension | null;
  /**
   * 渲染后回调
   */
  afterRender?(position: ContentWidgetPositionPreference | null): void;
}

/**
 * 覆盖小部件位置首选项
 */
export const enum OverlayWidgetPositionPreference {
  /**
   * 左上角
   */
  TOP_LEFT_CORNER = 0,
  /**
   * 右上角
   */
  TOP_RIGHT_CORNER = 1,
  /**
   * 左下角
   */
  BOTTOM_LEFT_CORNER = 2,
  /**
   * 右下角
   */
  BOTTOM_RIGHT_CORNER = 3,
  /**
   * 顶部居中
   */
  TOP_CENTER = 4,
}

/**
 * 覆盖小部件位置
 */
export interface IOverlayWidgetPosition {
  /**
   * 位置首选项
   */
  preference: OverlayWidgetPositionPreference | null;
}

/**
 * 覆盖小部件接口
 */
export interface IOverlayWidget {
  /**
   * 是否允许编辑器溢出
   */
  allowEditorOverflow?: boolean;
  /**
   * 获取小部件 ID
   */
  getId(): string;
  /**
   * 获取 DOM 节点
   */
  getDomNode(): HTMLElement;
  /**
   * 获取位置
   */
  getPosition(): IOverlayWidgetPosition | null;
  /**
   * 获取最小宽度
   */
  getMinContentWidthInPx?(): number;
}

/**
 * 字形边距小部件接口
 */
export interface IGlyphMarginWidget {
  /**
   * 获取小部件 ID
   */
  getId(): string;
  /**
   * 获取 DOM 节点
   */
  getDomNode(): HTMLElement;
  /**
   * 获取位置
   */
  getPosition(): {
    lane: editor.GlyphMarginLane;
    zIndex: number;
    range: IRange;
  };
}

// ══════════════════════════════════════════════════
//  视图区域接口
// ══════════════════════════════════════════════════

/**
 * 视图区域接口
 * 用于在编辑器中插入额外的行空间
 */
export interface IViewZone {
  /**
   * 区域之后的行号
   */
  afterLineNumber: number;
  /**
   * 区域之后的列号
   */
  afterColumn?: number;
  /**
   * 是否抑制鼠标按下
   */
  suppressMouseDown?: boolean;
  /**
   * 区域高度（像素）
   */
  heightInPx?: number;
  /**
   * 区域高度（行数）
   */
  heightInLines?: number;
  /**
   * 最小宽度（像素）
   */
  minWidthInPx?: number;
  /**
   * DOM 节点
   */
  domNode: HTMLElement;
  /**
   * 边距 DOM 节点
   */
  marginDomNode?: HTMLElement | null;
  /**
   * 区域变化回调
   */
  onDomNodeTop?: (top: number) => void;
  /**
   * 计算高度回调
   */
  onComputedHeight?: (height: number) => void;
}

/**
 * 视图区域变化访问器
 */
export interface IViewZoneChangeAccessor {
  /**
   * 添加视图区域
   */
  addZone(zone: IViewZone): string;
  /**
   * 移除视图区域
   */
  removeZone(id: string): void;
  /**
   * 布局视图区域
   */
  layoutZone(id: string): void;
}

// ══════════════════════════════════════════════════
//  代码编辑器接口
// ══════════════════════════════════════════════════

/**
 * 代码编辑器接口
 * 对应 VSCode 的 ICodeEditor
 */
export interface ICodeEditor extends IEditor {
  /**
   * 是否为简单小部件
   * @internal
   */
  readonly isSimpleWidget: boolean;

  // ── 事件 ──

  /**
   * 模型内容变化事件
   */
  readonly onDidChangeModelContent: Event<IModelContentChangedEvent>;

  /**
   * 模型变化事件
   */
  readonly onDidChangeModel: Event<IModelChangedEvent>;

  /**
   * 光标位置变化事件
   */
  readonly onDidChangeCursorPosition: Event<ICursorPositionChangedEvent>;

  /**
   * 光标选区变化事件
   */
  readonly onDidChangeCursorSelection: Event<ICursorSelectionChangedEvent>;

  /**
   * 编辑器配置变化事件
   */
  readonly onDidChangeConfiguration: Event<editor.ConfigurationChangedEvent>;

  /**
   * 滚动变化事件
   */
  readonly onDidScrollChange: Event<IScrollEvent>;

  /**
   * 焦点变化事件
   */
  readonly onDidFocusEditorText: Event<void>;
  readonly onDidBlurEditorText: Event<void>;
  readonly onDidFocusEditorWidget: Event<void>;
  readonly onDidBlurEditorWidget: Event<void>;

  /**
   * 鼠标事件
   */
  readonly onMouseUp: Event<IEditorMouseEvent>;
  readonly onMouseDown: Event<IEditorMouseEvent>;
  readonly onMouseMove: Event<IEditorMouseEvent>;
  readonly onMouseLeave: Event<IPartialEditorMouseEvent>;

  /**
   * 键盘事件
   */
  readonly onKeyUp: Event<IKeyboardEvent>;
  readonly onKeyDown: Event<IKeyboardEvent>;

  /**
   * 粘贴事件
   */
  readonly onDidPaste: Event<IPasteEvent>;

  /**
   * 布局变化事件
   */
  readonly onDidLayoutChange: Event<editor.EditorLayoutInfo>;

  /**
   * 内容大小变化事件
   */
  readonly onDidContentSizeChange: Event<IContentSizeChangedEvent>;

  // ── 模型管理 ──

  /**
   * 获取当前模型
   */
  getModel(): ITextModel | null;

  /**
   * 设置模型
   */
  setModel(model: ITextModel | null): void;

  // ── 视图状态 ──

  /**
   * 保存视图状态
   */
  saveViewState(): ICodeEditorViewState | null;

  /**
   * 恢复视图状态
   */
  restoreViewState(state: ICodeEditorViewState | null): void;

  // ── 光标和选择 ──

  /**
   * 获取光标位置
   */
  getPosition(): IPosition | null;

  /**
   * 设置光标位置
   */
  setPosition(position: IPosition, source?: string): void;

  // ── 滚动 ──

  /**
   * 获取滚动顶部位置
   */
  getScrollTop(): number;

  /**
   * 设置滚动顶部位置
   */
  setScrollTop(newScrollTop: number, scrollType?: ScrollType): void;

  /**
   * 获取滚动左侧位置
   */
  getScrollLeft(): number;

  /**
   * 设置滚动左侧位置
   */
  setScrollLeft(newScrollLeft: number, scrollType?: ScrollType): void;

  /**
   * 获取滚动宽度
   */
  getScrollWidth(): number;

  /**
   * 获取滚动高度
   */
  getScrollHeight(): number;

  /**
   * 设置滚动位置
   */
  setScrollPosition(
    position: { scrollLeft?: number; scrollTop?: number },
    scrollType?: ScrollType,
  ): void;

  // ── 编辑操作 ──

  /**
   * 执行编辑操作
   */
  executeEdits(
    source: string | null | undefined,
    edits: IIdentifiedSingleEditOperation[],
    endCursorState?: ICursorStateComputer | ISelection[],
  ): boolean;

  /**
   * 执行命令
   */
  executeCommand(source: string | null | undefined, command: editor.ICommand): void;

  /**
   * 执行多个命令
   */
  executeCommands(
    source: string | null | undefined,
    commands: (editor.ICommand | null)[],
  ): void;

  // ── 小部件管理 ──

  /**
   * 添加内容小部件
   */
  addContentWidget(widget: IContentWidget): void;

  /**
   * 布局内容小部件
   */
  layoutContentWidget(widget: IContentWidget): void;

  /**
   * 移除内容小部件
   */
  removeContentWidget(widget: IContentWidget): void;

  /**
   * 添加覆盖小部件
   */
  addOverlayWidget(widget: IOverlayWidget): void;

  /**
   * 布局覆盖小部件
   */
  layoutOverlayWidget(widget: IOverlayWidget): void;

  /**
   * 移除覆盖小部件
   */
  removeOverlayWidget(widget: IOverlayWidget): void;

  /**
   * 添加字形边距小部件
   */
  addGlyphMarginWidget(widget: IGlyphMarginWidget): void;

  /**
   * 布局字形边距小部件
   */
  layoutGlyphMarginWidget(widget: IGlyphMarginWidget): void;

  /**
   * 移除字形边距小部件
   */
  removeGlyphMarginWidget(widget: IGlyphMarginWidget): void;

  // ── 视图区域管理 ──

  /**
   * 修改视图区域
   */
  changeViewZones(callback: (accessor: IViewZoneChangeAccessor) => void): void;

  // ── DOM 相关 ──

  /**
   * 获取容器 DOM 节点
   */
  getContainerDomNode(): HTMLElement;

  /**
   * 获取 DOM 节点
   */
  getDomNode(): HTMLElement | null;

  /**
   * 获取目标位置
   */
  getTargetAtClientPoint(
    clientX: number,
    clientY: number,
  ): IMouseTarget | null;

  // ── 布局 ──

  /**
   * 获取布局信息
   */
  getLayoutInfo(): editor.EditorLayoutInfo;

  /**
   * 获取可见列范围
   */
  getVisibleColumnFromPosition(position: IPosition): number;

  /**
   * 获取顶部坐标（行号）
   */
  getTopForLineNumber(lineNumber: number): number;

  /**
   * 获取顶部坐标（位置）
   */
  getTopForPosition(lineNumber: number, column: number): number;

  /**
   * 手动触发布局
   */
  layout(dimension?: editor.IDimension): void;

  // ── 配置 ──

  /**
   * 获取编辑器选项
   */
  getOption<T extends editor.EditorOption>(id: T): editor.FindComputedEditorOptionValueById<T>;

  /**
   * 获取所有选项
   */
  getOptions(): editor.IComputedEditorOptions;

  /**
   * 获取原始选项
   */
  getRawOptions(): editor.IEditorOptions;

  // ── 贡献管理 ──

  /**
   * 获取贡献
   */
  getContribution<T extends IEditorContribution>(id: string): T | null;

  // ── 装饰管理 ──

  /**
   * 创建装饰集合
   */
  createDecorationsCollection(
    decorations?: editor.IModelDeltaDecoration[],
  ): editor.IEditorDecorationsCollection;

  // ── 动作管理 ──

  /**
   * 添加动作
   */
  addAction(descriptor: editor.IActionDescriptor): IDisposable;

  /**
   * 获取动作
   */
  getAction(id: string): editor.IEditorAction | null;

  /**
   * 获取支持的动作
   */
  getSupportedActions(): editor.IEditorAction[];
}

/**
 * 活动代码编辑器（有模型）
 */
export interface IActiveCodeEditor extends ICodeEditor {
  /**
   * 获取当前模型（非空）
   */
  getModel(): ITextModel;

  /**
   * 获取光标位置（非空）
   */
  getPosition(): IPosition;

  /**
   * 获取选区（非空）
   */
  getSelection(): ISelection;

  /**
   * 获取所有选区（非空）
   */
  getSelections(): ISelection[];
}

// ══════════════════════════════════════════════════
//  差异编辑器接口
// ══════════════════════════════════════════════════

/**
 * 差异编辑器接口
 */
export interface IDiffEditor extends IEditor {
  /**
   * 获取原始编辑器
   */
  getOriginalEditor(): ICodeEditor;

  /**
   * 获取修改后编辑器
   */
  getModifiedEditor(): ICodeEditor;

  /**
   * 获取容器 DOM 节点
   */
  getContainerDomNode(): HTMLElement;

  /**
   * 获取行变化
   */
  getLineChanges(): editor.ILineChange[] | null;

  /**
   * 更新选项
   */
  updateOptions(newOptions: editor.IDiffEditorOptions): void;
}

// ══════════════════════════════════════════════════
//  事件类型
// ══════════════════════════════════════════════════

/**
 * 编辑器鼠标事件
 */
export interface IEditorMouseEvent {
  readonly event: MouseEvent;
  readonly target: IMouseTarget;
}

/**
 * 部分编辑器鼠标事件
 */
export interface IPartialEditorMouseEvent {
  readonly event: MouseEvent;
  readonly target: IMouseTarget | null;
}

/**
 * 键盘事件
 */
export interface IKeyboardEvent {
  readonly browserEvent: KeyboardEvent;
  readonly target: HTMLElement;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly keyCode: number;
  readonly code: string;
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * 粘贴事件
 */
export interface IPasteEvent {
  readonly range: IRange;
  readonly languageId: string | null;
}

/**
 * 内容大小变化事件
 */
export interface IContentSizeChangedEvent {
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly contentWidthChanged: boolean;
  readonly contentHeightChanged: boolean;
}

/**
 * 光标状态计算器
 */
export type ICursorStateComputer = (
  inverseEditOperations: IIdentifiedSingleEditOperation[],
) => ISelection[] | null;

// ══════════════════════════════════════════════════
//  工具函数
// ══════════════════════════════════════════════════

/**
 * 判断是否为代码编辑器
 */
export function isCodeEditor(thing: unknown): thing is ICodeEditor {
  if (thing && typeof thing === "object") {
    const editor = thing as ICodeEditor;
    return (
      typeof editor.getEditorType === "function" &&
      editor.getEditorType() === "vs.editor.ICodeEditor"
    );
  }
  return false;
}

/**
 * 判断是否为差异编辑器
 */
export function isDiffEditor(thing: unknown): thing is IDiffEditor {
  if (thing && typeof thing === "object") {
    const editor = thing as IDiffEditor;
    return (
      typeof editor.getEditorType === "function" &&
      editor.getEditorType() === "vs.editor.IDiffEditor"
    );
  }
  return false;
}

/**
 * 获取活动代码编辑器
 */
export function getActiveCodeEditor(
  thing: ICodeEditor | IDiffEditor,
): ICodeEditor | null {
  if (isDiffEditor(thing)) {
    return thing.getModifiedEditor();
  }
  if (isCodeEditor(thing)) {
    return thing;
  }
  return null;
}
