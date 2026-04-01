/**
 * Host Bridge — 编辑器包与宿主应用的通信接口
 *
 * 编辑器包不直接依赖宿主的 store 或 IPC，而是通过这个桥接层。
 * 宿主在初始化时注册实现。
 */

export interface HostBridge {
  // 文件系统
  readFile(
    path: string,
  ): Promise<{ content: string; language: string; error?: string }>;
  writeFile(
    path: string,
    content: string,
  ): Promise<{ success: boolean; error?: string }>;
  showSaveDialog(opts?: {
    defaultName?: string;
  }): Promise<{ path: string | null }>;

  // 持久化存储
  storeGet(key: string): Promise<{ value: unknown }>;
  storeSet(key: string, value: unknown): Promise<{ success: boolean }>;

  // 编辑器状态（由宿主 store 实现）
  openFile(meta: {
    path: string;
    name: string;
    language: string;
    content: string;
  }): void;
  closeFile(path: string): void;
  markSaved(path: string): void;

  // Monaco 组件所需的额外方法
  /** 懒加载文件内容（恢复的占位 tab / 搜索结果占位 tab 首次激活时） */
  hydrateFileContent(path: string, content: string, language: string): void;
  /** 更新文件修改状态 */
  setModified(path: string, modified: boolean): void;
  /** 更新文件语言 */
  setFileLanguage(path: string, language: string): void;
  /** 向 Chat 发送用户消息（AI 解释/重构） */
  addUserMessage(message: string): void;
  /** 获取当前活动文件路径 */
  getActiveFile(): string | null;
  /** 获取 minimap 配置 */
  getMinimapEnabled(): boolean;

  // 通知
  notifyError(message: string): void;
}

let bridge: HostBridge | null = null;

export function registerHostBridge(impl: HostBridge): void {
  bridge = impl;
}

export function getHostBridge(): HostBridge {
  if (!bridge) {
    throw new Error(
      "[editor] Host bridge not registered. Call registerHostBridge() first.",
    );
  }
  return bridge;
}
