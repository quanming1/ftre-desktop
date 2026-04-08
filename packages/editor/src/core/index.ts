/**
 * Core 模块导出
 *
 * 简化版 VSCode 风格编辑器核心
 */

// TextModel 服务
export {
  getTextModelService,
  disposeTextModelService,
  _resetTextModelService,
  type ITextModelOptions,
  type IViewState,
  type ITextModelData,
} from "./text-model";

// CodeEditor 组件
export {
  CodeEditor,
  createCodeEditor,
  type ICodeEditorOptions,
  type ICodeEditorCallbacks,
} from "./code-editor";
