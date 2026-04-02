export { editorCore } from "./core/editor-core";
export {
  editorManager,
  createEditorManager,
  type EditorManager,
  type EditorManagerConfig,
  type AttachOptions,
} from "./core/editor-manager";
export {
  saveFile,
  registerHostBridge,
  getHostBridge,
  type HostBridge,
} from "./runtime";
export {
  registerFtreTheme,
  _resetThemeRegistration,
  MonacoEditor,
  ManagedEditor,
  MonacoDiffViewer,
  DiffBar,
  computeDiffStats,
} from "./ui";
export { workspaceHash } from "./utils";
export type { OpenFile, DiffEntry, EditorGroup, EditorSnapshot } from "./store";
export { buildDiffId, buildDiffTabPath } from "./store";

// Editor store implementation
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
} from "./store";
