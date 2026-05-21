export { registerFtreTheme, _resetThemeRegistration } from "./theme-registry";
export { MonacoDiffViewer, type MonacoDiffViewerHandle } from "./MonacoDiffViewer";
export { DiffBar, computeDiffStats } from "./DiffBar";

// 新架构编辑器组件
export {
  CodeEditorWidget,
  type CodeEditorFile,
  type CodeEditorWidgetProps,
} from "./CodeEditorWidget";

// Settings 编辑器组件
export {
  SettingsEditorWidget,
  type SettingsEditorWidgetProps,
} from "./SettingsEditorWidget";

// EditorPane 工厂
export {
  CodeEditorPaneFactory,
  createCodeEditorPaneFactory,
  type IContentStore,
  type ICodeEditorPaneFactoryOptions,
} from "./CodeEditorPaneFactory";

// EditorPart 视图（支持分屏）
export {
  EditorPartView,
  type EditorFile,
  type EditorPartViewProps,
  type EditorPartViewHandle,
} from "./EditorPartView";

// Themes
export {
  getTheme,
  getActiveThemeId,
  setActiveThemeId,
  registerTheme,
  getAvailableThemes,
  getThemeIdForMode,
  type FtreThemeDefinition,
  type FtreThemeTokenRule,
} from "./themes";

// File icons
export {
  getFileIcon,
  EXTENSION_MAP,
  SPECIAL_FILE_MAP,
  type FileIconResult,
} from "./file-icons";

// Tab management
export {
  TabBar,
  type TabBarProps,
  type TabFile,
  type TabGroup,
  type TabContextMenuItem,
} from "./TabBar";

// Breadcrumb navigation
export {
  Breadcrumb,
  type BreadcrumbProps,
  type BreadcrumbGroup,
  type FileEntry,
} from "./Breadcrumb";
