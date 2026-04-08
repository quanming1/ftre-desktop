export type {
  OpenFile,
  DiffEntry,
  EditorGroup,
  EditorSnapshot,
  EditorInputType,
} from "./types";
export { buildDiffId, buildDiffTabPath, SETTINGS_PATH } from "./types";

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
} from "./editor-store";
