/**
 * DocumentManager — 管理所有 Document 实例的生命周期
 *
 * 职责：
 * 1. 管理 Document 实例的创建、获取和销毁
 * 2. 处理工作区切换（hibernate / activate）
 * 3. 提供全局的 dirty 文件列表查询
 */

import type * as Monaco from "monaco-editor";
import { Document } from "./document";
import type { DocState, FileMetadata, HashFn } from "./types";

export interface DocumentSnapshot {
  content: string;
  diskHash: string;
  metadata: FileMetadata;
  viewState: Monaco.editor.ICodeEditorViewState | null;
  language: string;
  state: DocState;
}

class DocumentManagerImpl {
  private _documents = new Map<string, Document>();
  private _monaco: typeof Monaco | null = null;
  private _hashFn: HashFn | undefined;

  /** 状态变化监听器 */
  private _listeners = new Set<(path: string, state: DocState) => void>();

  constructor(hashFn?: HashFn) {
    this._hashFn = hashFn;
  }

  // ══════════════════════════════════════════════════
  //  初始化
  // ══════════════════════════════════════════════════

  /**
   * 注入 Monaco 全局对象
   */
  init(monaco: typeof Monaco): void {
    this._monaco = monaco;
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this._monaco !== null;
  }

  // ══════════════════════════════════════════════════
  //  Document 生命周期
  // ══════════════════════════════════════════════════

  /**
   * 获取或创建 Document
   * 如果已存在，直接返回
   * 如果不存在，创建新的（状态为 IDLE）
   */
  open(path: string, language: string): Document {
    let doc = this._documents.get(path);

    if (doc) {
      // 如果是 hibernated 状态，激活它
      if (doc.state === "hibernated") {
        doc.activate();
      }
      return doc;
    }

    if (!this._monaco) {
      throw new Error(
        "[DocumentManager] Monaco not initialized. Call init(monaco) first.",
      );
    }

    doc = new Document(path, language, this._hashFn);
    doc.setMonaco(this._monaco);

    // 监听状态变化
    doc.onStateChange((state) => {
      this._notifyStateChange(path, state);
    });

    this._documents.set(path, doc);
    return doc;
  }

  /**
   * 异步加载文档内容
   *
   * @param path 文件路径
   * @param language 语言
   * @param readFn 读取函数（由调用方提供，避免 core 依赖 runtime）
   * @returns 加载后的 Document，或 null（如果读取失败）
   */
  async loadAsync(
    path: string,
    language: string,
    readFn: () => Promise<{
      content: string;
      language?: string;
      error?: string;
    }>,
  ): Promise<Document | null> {
    // 获取或创建 Document
    let doc = this._documents.get(path);

    if (doc) {
      // 已经加载过，直接返回
      if (doc.state === "loaded") {
        return doc;
      }
      // hibernated 状态，激活它
      if (doc.state === "hibernated") {
        doc.activate();
        return doc;
      }
    } else {
      // 创建新 Document
      doc = this.open(path, language);
    }

    // 只有 idle 状态才需要加载
    if (doc.state !== "idle") {
      return doc;
    }

    // 读取文件内容
    try {
      const result = await readFn();

      if (result.error) {
        // 读取失败，关闭 Document
        this.close(path);
        return null;
      }

      // 加载内容
      doc.load(result.content);
      return doc;
    } catch {
      // 读取异常，关闭 Document
      this.close(path);
      return null;
    }
  }

  /**
   * 获取已存在的 Document
   */
  get(path: string): Document | undefined {
    return this._documents.get(path);
  }

  /**
   * 检查 Document 是否存在
   */
  has(path: string): boolean {
    return this._documents.has(path);
  }

  /**
   * 检查 Document 是否已加载内容
   */
  hasContent(path: string): boolean {
    const doc = this._documents.get(path);
    return doc !== undefined && doc.state !== "idle";
  }

  /**
   * 预加载文件内容（鼠标悬停时调用）
   * 创建 Document 并加载内容，但不挂载编辑器
   *
   * @param path 文件路径
   * @param language 语言
   * @param content 文件内容
   */
  preload(path: string, language: string, content: string): void {
    // 已经加载过则跳过
    if (this.hasContent(path)) return;

    // 创建并加载
    const doc = this.open(path, language);
    if (doc.state === "idle") {
      doc.load(content);
    }
  }

  /**
   * 关闭并销毁 Document
   */
  close(path: string): void {
    const doc = this._documents.get(path);
    if (!doc) return;

    doc.dispose();
    this._documents.delete(path);
  }

  /**
   * 获取所有 Document 的路径
   */
  getPaths(): string[] {
    return [...this._documents.keys()];
  }

  /**
   * 获取所有 Document
   */
  getAll(): Document[] {
    return [...this._documents.values()];
  }

  // ══════════════════════════════════════════════════
  //  工作区管理
  // ══════════════════════════════════════════════════

  /**
   * 休眠指定路径前缀外的所有文档
   * 用于工作区切换时释放非活跃工作区的资源
   */
  hibernateOthers(activePrefix: string): void {
    const normalizedPrefix = activePrefix.replace(/\\/g, "/");

    for (const [path, doc] of this._documents) {
      const normalizedPath = path.replace(/\\/g, "/");
      if (!normalizedPath.startsWith(normalizedPrefix)) {
        doc.hibernate();
      }
    }
  }

  /**
   * 休眠所有文档
   */
  hibernateAll(): void {
    for (const doc of this._documents.values()) {
      doc.hibernate();
    }
  }

  /**
   * 获取所有有未保存修改的文档路径
   */
  getDirtyPaths(): string[] {
    const paths: string[] = [];
    for (const [path, doc] of this._documents) {
      if (doc.isDirty()) {
        paths.push(path);
      }
    }
    return paths;
  }

  /**
   * 检查是否有任何未保存的修改
   */
  hasUnsavedChanges(): boolean {
    for (const doc of this._documents.values()) {
      if (doc.isDirty()) {
        return true;
      }
    }
    return false;
  }

  // ══════════════════════════════════════════════════
  //  快照 / 恢复（用于持久化）
  // ══════════════════════════════════════════════════

  /**
   * 创建所有文档的快照
   * 用于工作区切换时保存状态
   */
  snapshot(): Map<string, DocumentSnapshot> {
    const snapshots = new Map<string, DocumentSnapshot>();

    for (const [path, doc] of this._documents) {
      // 只保存有内容的文档
      if (doc.state === "idle") continue;

      snapshots.set(path, {
        content: doc.getContent(),
        diskHash: this._getDocDiskHash(doc),
        metadata: doc.metadata,
        viewState: doc.getViewState(),
        language: doc.language,
        state: doc.state,
      });
    }

    return snapshots;
  }

  /**
   * 从快照恢复文档
   */
  restoreFromSnapshot(snapshots: Map<string, DocumentSnapshot>): void {
    for (const [path, snap] of snapshots) {
      // 跳过已存在的文档
      if (this._documents.has(path)) continue;

      const doc = new Document(path, snap.language, this._hashFn);
      if (this._monaco) {
        doc.setMonaco(this._monaco);
      }

      // 恢复内容
      doc.restore(snap.content, snap.diskHash, snap.metadata);

      // 恢复视图状态
      if (snap.viewState) {
        doc.saveViewState(snap.viewState);
      }

      // 如果原来是 hibernated，保持休眠
      if (snap.state === "hibernated") {
        doc.hibernate();
      }

      // 监听状态变化
      doc.onStateChange((state) => {
        this._notifyStateChange(path, state);
      });

      this._documents.set(path, doc);
    }
  }

  // ══════════════════════════════════════════════════
  //  文件系统事件
  // ══════════════════════════════════════════════════

  /**
   * 处理文件重命名
   */
  handleFileRenamed(oldPath: string, newPath: string): void {
    const doc = this._documents.get(oldPath);
    if (!doc) return;

    // 在 close 前保存旧 doc 的所有状态（close 会 dispose 对象）
    const language = doc.language;
    const content = doc.getContent();
    const metadata = doc.metadata;
    const diskHash = doc.diskHash;
    const viewState = doc.getViewState();

    // 关闭旧文档
    this.close(oldPath);

    // 创建新文档并恢复状态
    const newDoc = this.open(newPath, language);
    if (content) {
      // 使用 restore() 而非 load()，避免对已规范化的内容重新检测 metadata
      newDoc.restore(content, diskHash, metadata);
      if (viewState) {
        newDoc.saveViewState(viewState);
      }
      // 如果之前没有修改，diskHash 已经通过 restore() 正确设置
      // 如果之前有修改，diskHash 同样已正确保留，isDirty 会自然为 true
    }
  }

  /**
   * 处理文件夹重命名：批量迁移前缀
   */
  handleDirectoryRenamed(oldPrefix: string, newPrefix: string): void {
    const toMigrate: [string, string][] = [];

    for (const path of this._documents.keys()) {
      if (
        path.startsWith(oldPrefix + "/") ||
        path.startsWith(oldPrefix + "\\")
      ) {
        const newPath = newPrefix + path.slice(oldPrefix.length);
        toMigrate.push([path, newPath]);
      }
    }

    for (const [oldPath, newPath] of toMigrate) {
      this.handleFileRenamed(oldPath, newPath);
    }
  }

  /**
   * 处理文件删除
   */
  handleFileDeleted(path: string): void {
    this.close(path);
  }

  /**
   * 处理文件夹删除
   */
  handleDirectoryDeleted(dirPath: string): void {
    const prefix =
      dirPath.endsWith("/") || dirPath.endsWith("\\") ? dirPath : dirPath + "/";
    const altPrefix =
      dirPath.endsWith("/") || dirPath.endsWith("\\")
        ? dirPath
        : dirPath + "\\";

    for (const path of [...this._documents.keys()]) {
      if (path.startsWith(prefix) || path.startsWith(altPrefix)) {
        this.close(path);
      }
    }
  }

  // ══════════════════════════════════════════════════
  //  状态监听
  // ══════════════════════════════════════════════════

  /**
   * 监听任意 Document 的状态变化
   */
  onDocumentStateChange(
    listener: (path: string, state: DocState) => void,
  ): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  // ══════════════════════════════════════════════════
  //  清理
  // ══════════════════════════════════════════════════

  /**
   * 销毁所有文档并重置状态
   */
  dispose(): void {
    for (const doc of this._documents.values()) {
      doc.dispose();
    }
    this._documents.clear();
    this._listeners.clear();
    // 注意：不重置 _monaco，允许 dispose 后重新创建 Document
  }

  // ══════════════════════════════════════════════════
  //  内部方法
  // ══════════════════════════════════════════════════

  private _notifyStateChange(path: string, state: DocState): void {
    this._listeners.forEach((fn) => fn(path, state));
  }

  /** 获取文档的 diskHash */
  private _getDocDiskHash(doc: Document): string {
    return doc.diskHash;
  }
}

// ── 导出类型别名 ──

export type DocumentManager = DocumentManagerImpl;

// ── 全局单例 ──

let _documentManager: DocumentManagerImpl | null = null;

export function getDocumentManager(): DocumentManagerImpl {
  if (!_documentManager) {
    _documentManager = new DocumentManagerImpl();
  }
  return _documentManager;
}

export function createDocumentManager(hashFn?: HashFn): DocumentManagerImpl {
  _documentManager = new DocumentManagerImpl(hashFn);
  return _documentManager;
}
