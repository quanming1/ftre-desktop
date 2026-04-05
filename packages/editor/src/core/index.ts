export { editorCore } from "./editor-core";
export {
  editorManager,
  createEditorManager,
  type EditorManager,
  type EditorManagerConfig,
  type AttachOptions,
} from "./editor-manager";

// 新架构
export { Document } from "./document";
export {
  getDocumentManager,
  createDocumentManager,
  type DocumentManager,
  type DocumentSnapshot,
} from "./document-manager";
export {
  getSlotPool,
  createSlotPool,
  type SlotPool,
  type SlotPoolConfig,
  type AcquireOptions,
} from "./slot-pool";
export type { DocState, FileMetadata, ViewState } from "./types";
