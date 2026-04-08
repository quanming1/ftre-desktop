/**
 * Editor 模块导出
 */

// 组件
export { EditorArea } from "./EditorArea";
export { TabBar } from "./TabBar";
export { Breadcrumb } from "./Breadcrumb";

// Monaco 配置
export {
  prewarmMonaco,
  isMonacoPrewarmed,
  getWorkerCacheSize,
} from "./monaco-setup";
export { initEditorHostBridge } from "./editor-host-bridge";
