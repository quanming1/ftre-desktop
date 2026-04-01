export { registerFtreTheme, _resetThemeRegistration } from "./theme-registry";
export { MonacoEditor } from "./MonacoEditor";
export { MonacoDiffViewer } from "./MonacoDiffViewer";
export { DiffBar, computeDiffStats } from "./DiffBar";

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
