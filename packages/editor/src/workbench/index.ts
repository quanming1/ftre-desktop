/**
 * workbench 模块导出
 *
 * 参考 VSCode 的 vs/workbench/browser/parts/editor 模块
 * 提供编辑器工作台相关的核心抽象
 */

// ══════════════════════════════════════════════════
//  EditorInput — 编辑器输入抽象
// ══════════════════════════════════════════════════

export {
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
} from "./editorInput";

// ══════════════════════════════════════════════════
//  EditorMemento — ViewState 持久化
// ══════════════════════════════════════════════════

export {
  EditorMemento,
  getEditorMemento,
  disposeAllEditorMementos,
  saveAllEditorMementos,
  type GroupIdentifier,
  type IEditorMemento,
} from "./editorMemento";

// ══════════════════════════════════════════════════
//  EditorPane — 编辑器面板基类
// ══════════════════════════════════════════════════

export {
  EditorPane,
  EditorCloseReason,
  createEditorPaneDescriptor,
  type IEditorGroup,
  type IEditorCloseEvent,
  type IEditorOpenContext,
  type IEditorOptions,
  type IDimension,
  type IEditorPaneDescriptor,
} from "./editorPane";

// ══════════════════════════════════════════════════
//  EditorPanes — 编辑器面板管理器（复用池）
// ══════════════════════════════════════════════════

export {
  EditorPanes,
  type IOpenEditorResult,
  type IEditorPaneFactory,
} from "./editorPanes";

// ══════════════════════════════════════════════════
//  TextModelResolverService — 文本模型解析服务
// ══════════════════════════════════════════════════

export {
  TextModelResolverService,
  getTextModelResolverService,
  disposeTextModelResolverService,
  type ITextModelResolverService,
  type ITextModelContentOptions,
  type IResolvedTextModelReference,
} from "./textModelResolverService";

// ══════════════════════════════════════════════════
//  TextCodeEditorPane — 代码编辑器面板
// ══════════════════════════════════════════════════

export {
  TextCodeEditorPane,
  textCodeEditorPaneDescriptor,
  createTextCodeEditorPane,
  type ITextCodeEditorOptions,
  type ITextCodeEditorCallbacks,
  type ITextEditorOptions,
  type ITextContentProvider,
} from "./textCodeEditorPane";

// ══════════════════════════════════════════════════
//  EditorGroup — 编辑器组
// ══════════════════════════════════════════════════

export {
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
} from "./editorGroup";

// ══════════════════════════════════════════════════
//  EditorPart — 编辑器部分（多组管理）
// ══════════════════════════════════════════════════

export {
  EditorPart,
  createEditorPart,
  SplitDirection,
  type IEditorPartLayoutState,
  type IEditorGroupLayoutState,
  type IEditorLayoutState,
  type IAddGroupOptions,
} from "./editorPart";

// ══════════════════════════════════════════════════
//  ViewStateCompat — ViewState 迁移兼容层
// ══════════════════════════════════════════════════

export {
  ViewStateCompat,
  getViewStateCompat,
  disposeViewStateCompat,
  saveAllViewStates,
  saveViewState,
  loadViewState,
  clearViewState,
} from "./viewStateCompat";
