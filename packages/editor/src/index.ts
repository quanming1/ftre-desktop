/**
 * @ftre/editor 包主导出
 *
 * 参考 VSCode 编辑器架构设计
 * 提供代码编辑器的核心功能
 */

// ══════════════════════════════════════════════════
//  Common 模块 (对标 vs/editor/common)
//  与平台无关的编辑器核心接口和类型
// ══════════════════════════════════════════════════

export {
  // 枚举
  EditorType,
  ScrollType,
  CursorChangeReason,

  // 编辑操作
  type ISingleEditOperation,
  type IIdentifiedSingleEditOperation,
  type IEditOperationBuilder,
  type ICursorStateComputerData,
  type ICommand,

  // 文本模型
  type ITextModel,
  type IModelContentChangedEvent,
  type IModelContentChange,
  type IModelDecorationsChangedEvent,
  type IModelLanguageChangedEvent,
  type IModelOptionsChangedEvent,

  // 视图状态
  type ICursorState,
  type IViewState as ICommonViewState,
  type ICodeEditorViewState,
  type IDiffEditorViewState,

  // 编辑器接口
  type IEditor,
  type IEditorContribution,

  // 装饰
  type IDecorationRenderOptions,
  type IModelDecorationOptions,
  type IModelDeltaDecoration,

  // 事件
  type IModelChangedEvent,
  type ICursorPositionChangedEvent,
  type ICursorSelectionChangedEvent,
  type IScrollEvent,

  // 工具类型
  type Event,
  type URI,
} from "./common";

// ══════════════════════════════════════════════════
//  Browser 模块 (对标 vs/editor/browser)
//  浏览器环境下的编辑器接口和类型
// ══════════════════════════════════════════════════

export {
  // 鼠标目标
  MouseTargetType,
  type IMouseTarget,

  // 内容小部件
  ContentWidgetPositionPreference,
  type IContentWidgetPosition,
  type IContentWidget,

  // 覆盖小部件
  OverlayWidgetPositionPreference,
  type IOverlayWidgetPosition,
  type IOverlayWidget,

  // 字形边距小部件
  type IGlyphMarginWidget,

  // 视图区域
  type IViewZone,
  type IViewZoneChangeAccessor,

  // 代码编辑器
  type ICodeEditor,
  type IActiveCodeEditor,

  // 差异编辑器
  type IDiffEditor,

  // 事件
  type IEditorMouseEvent,
  type IPartialEditorMouseEvent,
  type IKeyboardEvent,
  type IPasteEvent,
  type IContentSizeChangedEvent,

  // 光标状态计算器
  type ICursorStateComputer,

  // 工具函数
  isCodeEditor,
  isDiffEditor,
  getActiveCodeEditor,
} from "./browser";

// ══════════════════════════════════════════════════
//  Workbench 模块 (对标 vs/workbench/browser/parts/editor)
//  编辑器工作台相关的核心抽象
// ══════════════════════════════════════════════════

export {
  // EditorInput
  EditorInput,
  FileEditorInput,
  UntitledEditorInput,
  DiffEditorInput,
  EditorInputFactory,
  EditorInputCapabilities,
  CloseReason,
  isResourceEditorInput,
  isUntitledEditorInput,
  type ISerializedEditorInput,
  type IResourceEditorInput,
  type IUntitledEditorInput,
  type IEditorInputSerializer,

  // EditorMemento
  EditorMemento,
  getEditorMemento,
  disposeAllEditorMementos,
  saveAllEditorMementos,
  type GroupIdentifier,
  type IEditorMemento,

  // EditorPane
  EditorPane,
  EditorCloseReason,
  createEditorPaneDescriptor,
  type IEditorGroup,
  type IEditorCloseEvent,
  type IEditorOpenContext,
  type IEditorOptions,
  type IDimension,
  type IEditorPaneDescriptor,

  // EditorPanes
  EditorPanes,
  type IOpenEditorResult,
  type IEditorPaneFactory,

  // TextModelResolverService
  TextModelResolverService,
  getTextModelResolverService,
  disposeTextModelResolverService,
  type ITextModelResolverService,
  type ITextModelContentOptions,
  type IResolvedTextModelReference,

  // TextCodeEditorPane
  TextCodeEditorPane,
  textCodeEditorPaneDescriptor,
  createTextCodeEditorPane,
  type ITextCodeEditorOptions,
  type ITextCodeEditorCallbacks,
  type ITextEditorOptions,
  type ITextContentProvider,

  // EditorGroup
  EditorGroup,
  EditorGroupModel,
  createEditorGroup,
  generateGroupId,
  _resetGroupIdCounter,
  GroupDirection,
  GroupLocation,
  GroupChangeKind,
  type IEditorGroupChangeEvent,
  type IMoveEditorOptions,
  type ICopyEditorOptions,

  // EditorPart
  EditorPart,
  createEditorPart,
  SplitDirection,
  type IEditorPartLayoutState,
  type IEditorGroupLayoutState,
  type IEditorLayoutState,
  type IAddGroupOptions,

  // ViewStateCompat
  ViewStateCompat,
  getViewStateCompat,
  disposeViewStateCompat,
  saveAllViewStates,
  saveViewState as saveViewStateCompat,
  loadViewState as loadViewStateCompat,
  clearViewState as clearViewStateCompat,
} from "./workbench";

// ══════════════════════════════════════════════════
//  Core 模块
// ══════════════════════════════════════════════════

export {
  getTextModelService,
  disposeTextModelService,
  _resetTextModelService,
  type ITextModelOptions,
  type IViewState,
  type ITextModelData,
} from "./core/text-model";

export {
  CodeEditor,
  createCodeEditor,
  type ICodeEditorOptions,
  type ICodeEditorCallbacks,
} from "./core/code-editor";

// ══════════════════════════════════════════════════
//  UI 组件
// ══════════════════════════════════════════════════

export {
  CodeEditorWidget,
  type CodeEditorFile,
  type CodeEditorWidgetProps,
} from "./ui/CodeEditorWidget";

// EditorPane 工厂
export {
  CodeEditorPaneFactory,
  createCodeEditorPaneFactory,
  type IContentStore,
  type ICodeEditorPaneFactoryOptions,
} from "./ui/CodeEditorPaneFactory";

// EditorPart 视图（支持分屏）
export {
  EditorPartView,
  type EditorFile,
  type EditorPartViewProps,
  type EditorPartViewHandle,
} from "./ui/EditorPartView";

export {
  registerFtreTheme,
  _resetThemeRegistration,
} from "./ui/theme-registry";
export { MonacoDiffViewer } from "./ui/MonacoDiffViewer";
export { DiffBar, computeDiffStats } from "./ui/DiffBar";

// Themes
export {
  getTheme,
  getActiveThemeId,
  setActiveThemeId,
  registerTheme,
  getAvailableThemes,
  type FtreThemeDefinition,
  type FtreThemeTokenRule,
} from "./ui/themes";

// File icons
export {
  getFileIcon,
  EXTENSION_MAP,
  SPECIAL_FILE_MAP,
  type FileIconResult,
} from "./ui/file-icons";

// ══════════════════════════════════════════════════
//  Runtime 模块
// ══════════════════════════════════════════════════

export {
  saveFile,
  wasRecentlySaved,
  registerHostBridge,
  getHostBridge,
  type HostBridge,
} from "./runtime";

// ══════════════════════════════════════════════════
//  Store 模块
// ══════════════════════════════════════════════════

export type {
  OpenFile,
  DiffEntry,
  EditorGroup as StoreEditorGroup,
  EditorSnapshot,
  EditorInputType,
} from "./store/types";

export { buildDiffId, buildDiffTabPath, SETTINGS_PATH } from "./store/types";

export {
  createEditorActions,
  createInitialEditorState,
  registerEditorStoreHost,
  _resetGroupCounter,
  type EditorState,
  type EditorActions,
  type EditorStore,
  type EditorStoreHost,
  type SetState,
  type GetState,
} from "./store/editor-store";

// ══════════════════════════════════════════════════
//  Utils
// ══════════════════════════════════════════════════

export { workspaceHash } from "./utils";
