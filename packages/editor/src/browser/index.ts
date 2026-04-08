/**
 * browser 模块导出
 *
 * 参考 VSCode 的 vs/editor/browser 模块
 * 提供浏览器环境下的编辑器接口和类型
 */

// ══════════════════════════════════════════════════
//  editorBrowser — 浏览器编辑器接口
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
} from "./editorBrowser";
