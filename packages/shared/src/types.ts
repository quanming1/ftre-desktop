export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  ext: string | null;
}

export interface DesktopFS {
  readDir(dirPath: string): Promise<{ entries: FileEntry[]; error?: string }>;
  readFile(
    filePath: string,
  ): Promise<{ content: string; language: string; error?: string }>;
  writeFile(
    filePath: string,
    content: string,
  ): Promise<{ success: boolean; error?: string }>;
  selectFolder(): Promise<{ path: string | null }>;
  showSaveDialog(opts?: {
    defaultName?: string;
  }): Promise<{ path: string | null }>;
  search(
    rootPath: string,
    query: string,
    options: any,
  ): Promise<{ results: any[]; error?: string }>;
  createFile(filePath: string): Promise<{ success: boolean; error?: string }>;
  createFolder(dirPath: string): Promise<{ success: boolean; error?: string }>;
  rename(
    oldPath: string,
    newPath: string,
  ): Promise<{ success: boolean; error?: string }>;
  delete(
    targetPath: string,
    isDir: boolean,
  ): Promise<{ success: boolean; error?: string }>;
  revealInExplorer(targetPath: string): Promise<void>;
  watch(filePath: string): Promise<void>;
  unwatch(filePath: string): Promise<void>;
  onFileChanged(callback: (filePath: string) => void): () => void;
}

export interface GitInfo {
  branch: string | null;
  changedFiles: number;
  isGitRepo: boolean;
}

export interface GitFileStatus {
  path: string;
  /** 重命名时的旧路径 */
  oldPath?: string;
  absolutePath: string;
  status:
    | "modified"
    | "untracked"
    | "deleted"
    | "added"
    | "renamed"
    | "conflict";
  staged: boolean;
  /** 是否为目录（未跟踪目录） */
  isDir: boolean;
}

export interface DesktopGit {
  info(rootPath: string): Promise<GitInfo>;
  status(rootPath: string): Promise<{ files: GitFileStatus[]; error?: string }>;
  stage(
    rootPath: string,
    filePath: string,
  ): Promise<{ success: boolean; error?: string }>;
  stageMany(
    rootPath: string,
    filePaths: string[],
  ): Promise<{ success: boolean; error?: string }>;
  unstage(
    rootPath: string,
    filePath: string,
  ): Promise<{ success: boolean; error?: string }>;
  unstageMany(
    rootPath: string,
    filePaths: string[],
  ): Promise<{ success: boolean; error?: string }>;
  commit(
    rootPath: string,
    message: string,
  ): Promise<{ success: boolean; error?: string }>;
  show(
    rootPath: string,
    filePath: string,
  ): Promise<{ content: string; error?: string }>;
  diffFile(
    rootPath: string,
    filePath: string,
    status: string,
    staged: boolean,
    oldPath?: string,
  ): Promise<{ original: string; modified: string; error?: string }>;
}

export interface DesktopTerminal {
  create(opts?: {
    cols?: number;
    rows?: number;
    cwd?: string;
    shell?: string;
  }): Promise<{ id: number }>;
  write(id: number, data: string): Promise<void>;
  resize(id: number, cols: number, rows: number): Promise<void>;
  kill(id: number): Promise<void>;
  onData(callback: (id: number, data: string) => void): () => void;
  onExit(callback: (id: number, exitCode: number) => void): () => void;
}

export interface DesktopStore {
  get(key: string): Promise<{ value: unknown }>;
  set(key: string, value: unknown): Promise<{ success: boolean }>;
}

export interface DesktopWindow {
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  close(): Promise<void>;
  getPosition(): Promise<[number, number]>;
  setPosition(x: number, y: number): Promise<void>;
  isMaximized(): Promise<boolean>;
}

/** 内存使用信息 */
export interface MemoryUsage {
  timestamp: number;
  /** 应用启动时间戳（ms），进程级单例，首次调用后固定 */
  startTime: number;
  main: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
  };
  processes: Array<{
    type: string;
    pid: number;
    memory: {
      /** 工作集大小（KB） */
      workingSetSize: number;
      /** 峰值工作集大小（KB） */
      peakWorkingSetSize: number;
      /** 私有字节（KB） */
      privateBytes: number;
    };
    cpu: {
      percentCPUUsage: number;
    };
  }>;
}

/** 内存监控 API */
export interface DesktopMemory {
  getUsage(): Promise<MemoryUsage>;
}

export interface DesktopAPI {
  platform: string;
  isElectron: boolean;
  openExternal(url: string): Promise<void>;
  fs: DesktopFS;
  git: DesktopGit;
  store: DesktopStore;
  window: DesktopWindow;
  terminal: DesktopTerminal;
  memory: DesktopMemory;
}

declare global {
  interface Window {
    desktop: DesktopAPI;
  }
}
