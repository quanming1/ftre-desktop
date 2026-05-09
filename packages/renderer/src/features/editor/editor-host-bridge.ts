/**
 * Editor Host Bridge 实现
 *
 * 将 @ftre/editor 的 HostBridge 接口连接到 renderer 的 store 和 IPC。
 */

import { registerHostBridge, type HostBridge } from "@ftre/editor/runtime";
import { useEditor } from "@/stores/editor";
import { useChat } from "@/stores/chat";
import { useLayout } from "@/stores/layout";
import { useNotification } from "@/stores/notification";

const hostBridgeImpl: HostBridge = {
  // 文件系统
  readFile: (path) => window.desktop.fs.readFile(path),
  writeFile: (path, content) => window.desktop.fs.writeFile(path, content),
  showSaveDialog: (opts) => window.desktop.fs.showSaveDialog(opts),

  // 持久化存储
  storeGet: (key) => window.desktop.store.get(key),
  storeSet: (key, value) => window.desktop.store.set(key, value),

  // 编辑器状态
  openFile: (meta) => useEditor.getState().openFile(meta),
  closeFile: (path) => useEditor.getState().closeFile(path),
  markSaved: (path) => useEditor.getState().markSaved(path),

  // Monaco 组件所需的额外方法
  hydrateFileContent: (path, content, language) =>
    useEditor.getState().hydrateFileContent(path, content, language),
  setModified: (path, modified) =>
    useEditor.getState().setModified(path, modified),
  setFileLanguage: (path, language) =>
    useEditor.getState().setFileLanguage(path, language),
  addUserMessage: (message) => useChat.getState().sendMessage(message),
  getActiveFile: () => useEditor.getState().activeFile,
  getMinimapEnabled: () => useLayout.getState().minimapEnabled,

  // 通知
  notifyError: (message) =>
    useNotification.getState().addNotification({ level: "error", message }),
};

/** 初始化编辑器 host bridge（应用启动时调用一次） */
export function initEditorHostBridge(): void {
  registerHostBridge(hostBridgeImpl);
}
