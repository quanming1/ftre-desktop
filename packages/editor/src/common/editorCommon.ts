/**
 * editorCommon.ts — 编辑器通用接口定义
 *
 * 参考 VSCode 的 vs/editor/common/editorCommon.ts
 * 定义与平台无关的编辑器核心接口
 */

import type { editor, IDisposable, IPosition, IRange, ISelection } from "monaco-editor";

// ══════════════════════════════════════════════════
//  基础类型
// ══════════════════════════════════════════════════

/**
 * 编辑器类型
 */
export const enum EditorType {
  ICodeEditor = "vs.editor.ICodeEditor",
  IDiffEditor = "vs.editor.IDiffEditor",
}

/**
 * 滚动类型
 */
export const enum ScrollType {
  Smooth = 0,
  Immediate = 1,
}

/**
 * 光标变化原因
 */
export const enum CursorChangeReason {
  NotSet = 0,
  ContentFlush = 1,
  RecoverFromMarkers = 2,
  Explicit = 3,
  Paste = 4,
  Undo = 5,
  Redo = 6,
}

// ══════════════════════════════════════════════════
//  编辑操作接口
// ══════════════════════════════════════════════════

/**
 * 单个编辑操作
 */
export interface ISingleEditOperation {
  /**
   * 要替换的范围（删除）。可能为空以表示简单插入。
   */
  range: IRange;
  /**
   * 要替换的文本。可能为 null 以表示简单删除。
   */
  text: string | null;
  /**
   * 强制移动标记
   */
  forceMoveMarkers?: boolean;
}

/**
 * 带标识的单个编辑操作
 */
export interface IIdentifiedSingleEditOperation extends ISingleEditOperation {
  /**
   * 编辑操作标识符
   */
  identifier?: { major: number; minor: number } | null;
}

/**
 * 编辑操作构建器
 */
export interface IEditOperationBuilder {
  /**
   * 添加一个新的编辑操作（替换操作）
   */
  addEditOperation(
    range: IRange,
    text: string | null,
    forceMoveMarkers?: boolean,
  ): void;

  /**
   * 添加一个被追踪的编辑操作
   */
  addTrackedEditOperation(
    range: IRange,
    text: string | null,
    forceMoveMarkers?: boolean,
  ): void;
}

/**
 * 光标状态计算辅助数据
 */
export interface ICursorStateComputerData {
  /**
   * 获取逆编辑操作
   */
  getInverseEditOperations(): IIdentifiedSingleEditOperation[];

  /**
   * 获取被追踪选区的结果范围
   */
  getTrackedSelection(id: string): ISelection | null;
}

/**
 * 修改模型文本/光标状态的命令
 */
export interface ICommand {
  /**
   * 获取编辑操作
   */
  getEditOperations(
    model: ITextModel,
    builder: IEditOperationBuilder,
  ): void;

  /**
   * 计算光标状态
   */
  computeCursorState(
    model: ITextModel,
    helper: ICursorStateComputerData,
  ): ISelection;
}

// ══════════════════════════════════════════════════
//  文本模型接口
// ══════════════════════════════════════════════════

/**
 * 文本模型内容变化事件
 */
export interface IModelContentChangedEvent {
  /**
   * 变化列表
   */
  readonly changes: IModelContentChange[];
  /**
   * 结束行偏移元组（EOL）
   */
  readonly eol: string;
  /**
   * 结果版本 ID
   */
  readonly versionId: number;
  /**
   * 是否为撤销操作
   */
  readonly isUndoing: boolean;
  /**
   * 是否为重做操作
   */
  readonly isRedoing: boolean;
  /**
   * 是否刷新
   */
  readonly isFlush: boolean;
  /**
   * 是否为 EOL 变化
   */
  readonly isEolChange: boolean;
}

/**
 * 单个模型内容变化
 */
export interface IModelContentChange {
  /**
   * 被替换的范围
   */
  readonly range: IRange;
  /**
   * 被替换范围的偏移量
   */
  readonly rangeOffset: number;
  /**
   * 被替换范围的长度
   */
  readonly rangeLength: number;
  /**
   * 插入的新文本
   */
  readonly text: string;
}

/**
 * 模型装饰变化事件
 */
export interface IModelDecorationsChangedEvent {
  readonly affectsMinimap: boolean;
  readonly affectsOverviewRuler: boolean;
  readonly affectsGlyphMargin: boolean;
  readonly affectsLineNumber: boolean;
}

/**
 * 模型语言变化事件
 */
export interface IModelLanguageChangedEvent {
  readonly oldLanguage: string;
  readonly newLanguage: string;
}

/**
 * 模型选项变化事件
 */
export interface IModelOptionsChangedEvent {
  readonly tabSize: boolean;
  readonly indentSize: boolean;
  readonly insertSpaces: boolean;
  readonly trimAutoWhitespace: boolean;
}

/**
 * 文本模型接口
 * 对应 VSCode 的 ITextModel
 */
export interface ITextModel {
  /**
   * 模型关联的 URI
   */
  readonly uri: { toString(): string };

  /**
   * 模型唯一标识符
   */
  readonly id: string;

  /**
   * 获取模型当前版本 ID
   */
  getVersionId(): number;

  /**
   * 获取替代版本 ID（用于判断是否有变化）
   */
  getAlternativeVersionId(): number;

  // ── 文本内容访问 ──

  /**
   * 获取完整文本内容
   */
  getValue(eol?: editor.EndOfLinePreference, preserveBOM?: boolean): string;

  /**
   * 获取文本长度
   */
  getValueLength(eol?: editor.EndOfLinePreference, preserveBOM?: boolean): number;

  /**
   * 获取指定范围的文本
   */
  getValueInRange(range: IRange, eol?: editor.EndOfLinePreference): string;

  /**
   * 获取行数
   */
  getLineCount(): number;

  /**
   * 获取指定行的内容
   */
  getLineContent(lineNumber: number): string;

  /**
   * 获取指定行的长度
   */
  getLineLength(lineNumber: number): number;

  /**
   * 获取所有行的内容
   */
  getLinesContent(): string[];

  /**
   * 获取 EOL 字符
   */
  getEOL(): string;

  /**
   * 获取行结束列号
   */
  getLineMaxColumn(lineNumber: number): number;

  /**
   * 获取行首非空白字符列号
   */
  getLineFirstNonWhitespaceColumn(lineNumber: number): number;

  /**
   * 获取行尾非空白字符列号
   */
  getLineLastNonWhitespaceColumn(lineNumber: number): number;

  // ── 位置和范围验证 ──

  /**
   * 验证位置
   */
  validatePosition(position: IPosition): IPosition;

  /**
   * 验证范围
   */
  validateRange(range: IRange): IRange;

  /**
   * 获取位置偏移量
   */
  getOffsetAt(position: IPosition): number;

  /**
   * 获取偏移量对应的位置
   */
  getPositionAt(offset: number): IPosition;

  /**
   * 获取完整模型范围
   */
  getFullModelRange(): IRange;

  // ── 语言 ──

  /**
   * 获取语言 ID
   */
  getLanguageId(): string;

  // ── 编辑操作 ──

  /**
   * 推入编辑操作（支持撤销）
   */
  pushEditOperations(
    beforeCursorState: ISelection[] | null,
    editOperations: IIdentifiedSingleEditOperation[],
    cursorStateComputer: (
      inverseEditOperations: IIdentifiedSingleEditOperation[],
    ) => ISelection[] | null,
  ): ISelection[] | null;

  /**
   * 应用编辑操作
   */
  applyEdits(
    operations: IIdentifiedSingleEditOperation[],
    computeUndoEdits?: boolean,
  ): void | IIdentifiedSingleEditOperation[];

  // ── 撤销/重做 ──

  /**
   * 推入撤销栈元素
   */
  pushStackElement(): void;

  /**
   * 撤销
   */
  undo(): void;

  /**
   * 重做
   */
  redo(): void;

  /**
   * 是否可以撤销
   */
  canUndo(): boolean;

  /**
   * 是否可以重做
   */
  canRedo(): boolean;

  // ── 生命周期 ──

  /**
   * 是否已释放
   */
  isDisposed(): boolean;

  /**
   * 释放模型
   */
  dispose(): void;
}

// ══════════════════════════════════════════════════
//  编辑器视图状态
// ══════════════════════════════════════════════════

/**
 * 光标状态
 */
export interface ICursorState {
  inSelectionMode: boolean;
  selectionStart: IPosition;
  position: IPosition;
}

/**
 * 视图状态
 */
export interface IViewState {
  /** @internal */ scrollTop?: number;
  /** @internal */ scrollTopWithoutViewZones?: number;
  scrollLeft: number;
  firstPosition: IPosition;
  firstPositionDeltaTop: number;
}

/**
 * 代码编辑器视图状态
 */
export interface ICodeEditorViewState {
  cursorState: ICursorState[];
  viewState: IViewState;
  contributionsState: { [id: string]: unknown };
}

/**
 * 差异编辑器视图状态
 */
export interface IDiffEditorViewState {
  original: ICodeEditorViewState | null;
  modified: ICodeEditorViewState | null;
  modelState?: unknown;
}

// ══════════════════════════════════════════════════
//  编辑器基础接口
// ══════════════════════════════════════════════════

/**
 * 编辑器基础接口
 * 对应 VSCode 的 IEditor
 */
export interface IEditor {
  /**
   * 编辑器销毁事件
   */
  onDidDispose(listener: () => void): IDisposable;

  /**
   * 销毁编辑器
   */
  dispose(): void;

  /**
   * 获取编辑器唯一 ID
   */
  getId(): string;

  /**
   * 获取编辑器类型
   */
  getEditorType(): string;

  /**
   * 更新编辑器选项
   */
  updateOptions(newOptions: editor.IEditorOptions): void;

  /**
   * 获取焦点
   */
  focus(): void;

  /**
   * 是否有焦点
   */
  hasTextFocus(): boolean;

  /**
   * 获取当前选区
   */
  getSelection(): ISelection | null;

  /**
   * 获取所有选区
   */
  getSelections(): ISelection[] | null;

  /**
   * 获取可见范围
   */
  getVisibleRanges(): IRange[];

  /**
   * 设置选区
   */
  setSelection(selection: ISelection): void;
  setSelection(selection: IRange): void;

  /**
   * 设置多个选区
   */
  setSelections(selections: readonly ISelection[]): void;

  /**
   * 显示指定行（居中）
   */
  revealLine(lineNumber: number, scrollType?: ScrollType): void;

  /**
   * 显示指定行（在中心）
   */
  revealLineInCenter(lineNumber: number, scrollType?: ScrollType): void;

  /**
   * 显示指定行（在中心，如果在视口外）
   */
  revealLineInCenterIfOutsideViewport(
    lineNumber: number,
    scrollType?: ScrollType,
  ): void;

  /**
   * 显示指定位置
   */
  revealPosition(position: IPosition, scrollType?: ScrollType): void;

  /**
   * 显示指定位置（在中心）
   */
  revealPositionInCenter(position: IPosition, scrollType?: ScrollType): void;

  /**
   * 显示指定位置（在中心，如果在视口外）
   */
  revealPositionInCenterIfOutsideViewport(
    position: IPosition,
    scrollType?: ScrollType,
  ): void;

  /**
   * 显示指定范围
   */
  revealRange(range: IRange, scrollType?: ScrollType): void;

  /**
   * 显示指定范围（在中心）
   */
  revealRangeInCenter(range: IRange, scrollType?: ScrollType): void;

  /**
   * 显示指定范围（在中心，如果在视口外）
   */
  revealRangeInCenterIfOutsideViewport(
    range: IRange,
    scrollType?: ScrollType,
  ): void;

  /**
   * 触发命令
   */
  trigger(source: string | null | undefined, handlerId: string, payload: unknown): void;
}

// ══════════════════════════════════════════════════
//  编辑器贡献接口
// ══════════════════════════════════════════════════

/**
 * 编辑器贡献接口
 * 用于扩展编辑器功能
 */
export interface IEditorContribution {
  /**
   * 贡献 ID
   */
  readonly id?: string;

  /**
   * 销毁贡献
   */
  dispose(): void;

  /**
   * 保存视图状态
   */
  saveViewState?(): unknown;

  /**
   * 恢复视图状态
   */
  restoreViewState?(state: unknown): void;
}

// ══════════════════════════════════════════════════
//  装饰选项
// ══════════════════════════════════════════════════

/**
 * 装饰渲染选项
 */
export interface IDecorationRenderOptions {
  isWholeLine?: boolean;
  rangeBehavior?: editor.TrackedRangeStickiness;
  overviewRulerLane?: editor.OverviewRulerLane;
  overviewRulerColor?: string;
  className?: string;
  glyphMarginClassName?: string;
  glyphMarginHoverMessage?: string;
  lineNumberClassName?: string;
  lineNumberHoverMessage?: string;
  before?: {
    contentText?: string;
    color?: string;
    backgroundColor?: string;
  };
  after?: {
    contentText?: string;
    color?: string;
    backgroundColor?: string;
  };
}

/**
 * 模型装饰选项
 */
export interface IModelDecorationOptions extends IDecorationRenderOptions {
  stickiness?: editor.TrackedRangeStickiness;
  zIndex?: number;
  description: string;
}

/**
 * 模型增量装饰
 */
export interface IModelDeltaDecoration {
  range: IRange;
  options: IModelDecorationOptions;
}

// ══════════════════════════════════════════════════
//  事件类型
// ══════════════════════════════════════════════════

/**
 * 模型变化事件
 */
export interface IModelChangedEvent {
  readonly oldModelUrl: string | null;
  readonly newModelUrl: string | null;
}

/**
 * 光标位置变化事件
 */
export interface ICursorPositionChangedEvent {
  readonly position: IPosition;
  readonly secondaryPositions: IPosition[];
  readonly reason: CursorChangeReason;
  readonly source: string;
}

/**
 * 光标选区变化事件
 */
export interface ICursorSelectionChangedEvent {
  readonly selection: ISelection;
  readonly secondarySelections: ISelection[];
  readonly modelVersionId: number;
  readonly oldSelections: ISelection[] | null;
  readonly oldModelVersionId: number;
  readonly source: string;
  readonly reason: CursorChangeReason;
}

/**
 * 滚动变化事件
 */
export interface IScrollEvent {
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly scrollTopChanged: boolean;
  readonly scrollLeftChanged: boolean;
  readonly scrollWidthChanged: boolean;
  readonly scrollHeightChanged: boolean;
}

// ══════════════════════════════════════════════════
//  工具类型
// ══════════════════════════════════════════════════

/**
 * 事件发射器类型
 */
export type Event<T> = (
  listener: (e: T) => void,
  thisArg?: unknown,
  disposables?: IDisposable[],
) => IDisposable;

/**
 * URI 接口
 */
export interface URI {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
  readonly fsPath: string;
  toString(skipEncoding?: boolean): string;
  toJSON(): unknown;
}
