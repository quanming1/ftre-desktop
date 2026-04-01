export type { OpenFile, DiffEntry, EditorGroup, EditorSnapshot } from "./types";
export { buildDiffId, buildDiffTabPath } from "./types";

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
