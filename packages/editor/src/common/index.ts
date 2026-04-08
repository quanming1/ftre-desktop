/**
 * common 模块导出
 *
 * 参考 VSCode 的 vs/editor/common 模块
 * 提供与平台无关的编辑器核心接口和类型
 */

// ══════════════════════════════════════════════════
//  editorCommon — 编辑器通用接口
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
  type IViewState,
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
} from "./editorCommon";
