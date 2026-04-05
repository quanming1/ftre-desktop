/**
 * Document — 单个文件的状态机和内容管理
 *
 * 核心设计理念：
 * 1. 单一内容源：内容只存在于 Monaco Model 中（loaded 状态）或 cache 中（hibernated 状态）
 * 2. 状态机驱动：IDLE → LOADING → LOADED ⇄ HIBERNATED
 * 3. 跨平台兼容：检测并保存原始格式（BOM/行尾符），编辑时规范化，保存时恢复
 * 4. Hash 判断 Dirty：用规范化内容的 hash 比较，避免格式差异导致误报
 */

import type { editor } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import type { DocState, FileMetadata, ViewState, HashFn } from "./types";

// ── 工具函数 ──

/** 简单的字符串哈希（djb2 算法） */
function defaultHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/** 检测行尾符风格 */
function detectLineEnding(content: string): "lf" | "crlf" | "mixed" {
  const hasCrlf = content.includes("\r\n");
  const hasLf = /(?<!\r)\n/.test(content);

  if (hasCrlf && hasLf) return "mixed";
  if (hasCrlf) return "crlf";
  return "lf";
}

/** 检测 BOM */
function hasBom(content: string): boolean {
  return content.charCodeAt(0) === 0xfeff;
}

/** 规范化内容：移除 BOM，转为 LF */
function normalizeContent(content: string): string {
  let normalized = content;
  if (hasBom(content)) {
    normalized = normalized.slice(1);
  }
  return normalized.replace(/\r\n/g, "\n");
}

/**
 * 根据元数据恢复原始格式
 * 注意：mixed 模式保持 LF（Monaco 已规范化，无法恢复原始混合状态）
 */
function denormalizeContent(content: string, meta: FileMetadata): string {
  let result = content;

  // CRLF 模式：全部转为 CRLF
  // LF 或 mixed 模式：保持 LF（Monaco 已规范化）
  if (meta.lineEnding === "crlf") {
    result = result.replace(/\n/g, "\r\n");
  }

  if (meta.hasBom) {
    result = "\ufeff" + result;
  }

  return result;
}

// ── Document 类 ──

export class Document {
  readonly path: string;
  readonly language: string;

  private _monaco: typeof Monaco | null = null;
  private _model: editor.ITextModel | null = null;
  private _state: DocState = "idle";

  /** 休眠时缓存的内容 */
  private _cache: string | null = null;

  /** 磁盘内容的规范化 hash（用于 isDirty 判断） */
  private _diskHash: string = "";

  /** 原始文件格式元数据 */
  private _metadata: FileMetadata = {
    lineEnding: "lf",
    hasBom: false,
    encoding: "utf-8",
  };

  /** 视图状态（光标、滚动位置） */
  private _viewState: ViewState | null = null;

  /** 哈希函数（可替换，便于测试） */
  private _hashFn: HashFn;

  /** 状态变化监听器 */
  private _listeners = new Set<(state: DocState) => void>();

  constructor(path: string, language: string, hashFn?: HashFn) {
    this.path = path;
    this.language = language;
    this._hashFn = hashFn ?? defaultHash;
  }

  // ══════════════════════════════════════════════════
  //  状态查询
  // ══════════════════════════════════════════════════

  get state(): DocState {
    return this._state;
  }

  get model(): editor.ITextModel | null {
    return this._model;
  }

  get metadata(): FileMetadata {
    return { ...this._metadata };
  }

  /** 获取磁盘内容的 hash（用于快照恢复） */
  get diskHash(): string {
    return this._diskHash;
  }

  // ══════════════════════════════════════════════════
  //  核心操作
  // ══════════════════════════════════════════════════

  /**
   * 初始化 Monaco 引用
   * 必须在 load/activate 之前调用
   */
  setMonaco(monaco: typeof Monaco): void {
    this._monaco = monaco;
  }

  /**
   * 加载文件内容
   * IDLE → LOADED
   *
   * @param rawContent 从磁盘读取的原始内容
   */
  load(rawContent: string): void {
    if (this._state !== "idle") {
      console.warn(`[Document] Cannot load in state: ${this._state}`);
      return;
    }
    if (!this._monaco) {
      throw new Error("[Document] Monaco not initialized. Call setMonaco() first.");
    }

    // 检测并保存原始格式
    this._metadata = {
      lineEnding: detectLineEnding(rawContent),
      hasBom: hasBom(rawContent),
      encoding: "utf-8",
    };

    // 规范化内容
    const normalized = normalizeContent(rawContent);

    // 计算 diskHash（规范化后的 hash）
    this._diskHash = this._hashFn(normalized);

    // 创建 Monaco Model
    const uri = this._monaco.Uri.parse(this._pathToUri(this.path));
    let model = this._monaco.editor.getModel(uri);

    if (model && !model.isDisposed()) {
      // 复用已有 model
      model.setValue(normalized);
    } else {
      // 创建新 model
      model = this._monaco.editor.createModel(normalized, this.language, uri);
    }

    this._model = model;
    this._setState("loaded");
  }

  /**
   * 从缓存或外部内容恢复（用于工作区恢复场景）
   * IDLE → LOADED（跳过 LOADING）
   *
   * @param content 缓存的内容（已规范化）
   * @param diskHash 磁盘内容的 hash
   * @param metadata 可选的元数据
   */
  restore(content: string, diskHash: string, metadata?: FileMetadata): void {
    if (this._state !== "idle") {
      console.warn(`[Document] Cannot restore in state: ${this._state}`);
      return;
    }
    if (!this._monaco) {
      throw new Error("[Document] Monaco not initialized. Call setMonaco() first.");
    }

    this._diskHash = diskHash;
    if (metadata) {
      this._metadata = { ...metadata };
    }

    const uri = this._monaco.Uri.parse(this._pathToUri(this.path));
    let model = this._monaco.editor.getModel(uri);

    if (model && !model.isDisposed()) {
      model.setValue(content);
    } else {
      model = this._monaco.editor.createModel(content, this.language, uri);
    }

    this._model = model;
    this._setState("loaded");
  }

  /**
   * 休眠：释放 Model，保留内容到缓存
   * LOADED → HIBERNATED
   *
   * 用于工作区切换或内存压力时释放资源，同时保留未保存的修改
   */
  hibernate(): void {
    if (this._state !== "loaded" || !this._model) {
      return;
    }

    // 保存内容到缓存
    this._cache = this._model.getValue();

    // 销毁 model
    this._model.dispose();
    this._model = null;

    this._setState("hibernated");
  }

  /**
   * 激活：从缓存恢复 Model
   * HIBERNATED → LOADED
   */
  activate(): void {
    if (this._state !== "hibernated" || this._cache === null) {
      return;
    }
    if (!this._monaco) {
      throw new Error("[Document] Monaco not initialized. Call setMonaco() first.");
    }

    const uri = this._monaco.Uri.parse(this._pathToUri(this.path));
    let model = this._monaco.editor.getModel(uri);

    if (model && !model.isDisposed()) {
      model.setValue(this._cache);
    } else {
      model = this._monaco.editor.createModel(this._cache, this.language, uri);
    }

    this._model = model;
    this._cache = null;

    this._setState("loaded");
  }

  /**
   * 销毁文档，释放所有资源
   */
  dispose(): void {
    if (this._model && !this._model.isDisposed()) {
      this._model.dispose();
    }
    this._model = null;
    this._cache = null;
    this._viewState = null;
    this._listeners.clear();
  }

  // ══════════════════════════════════════════════════
  //  内容读写
  // ══════════════════════════════════════════════════

  /**
   * 获取当前内容（规范化的）
   * 无论在 LOADED 还是 HIBERNATED 状态都能正确返回
   */
  getContent(): string {
    if (this._model && !this._model.isDisposed()) {
      return this._model.getValue();
    }
    if (this._cache !== null) {
      return this._cache;
    }
    return "";
  }

  /**
   * 获取用于保存的内容（恢复原始格式）
   */
  getContentForSave(): string {
    const content = this.getContent();
    return denormalizeContent(content, this._metadata);
  }

  /**
   * 检查是否有未保存的修改
   * 通过比较当前内容 hash 与 diskHash
   */
  isDirty(): boolean {
    const content = this.getContent();
    if (!content && !this._diskHash) return false;
    return this._hashFn(content) !== this._diskHash;
  }

  /**
   * 标记为已保存（更新 diskHash）
   */
  markSaved(): void {
    this._diskHash = this._hashFn(this.getContent());
  }

  /**
   * 外部文件变更时刷新内容
   * 更新 model 和 diskHash
   */
  refresh(rawContent: string): void {
    // 更新元数据
    this._metadata = {
      lineEnding: detectLineEnding(rawContent),
      hasBom: hasBom(rawContent),
      encoding: "utf-8",
    };

    const normalized = normalizeContent(rawContent);
    this._diskHash = this._hashFn(normalized);

    if (this._state === "loaded" && this._model && !this._model.isDisposed()) {
      this._model.setValue(normalized);
    } else if (this._state === "hibernated") {
      this._cache = normalized;
    }
  }

  // ══════════════════════════════════════════════════
  //  视图状态
  // ══════════════════════════════════════════════════

  saveViewState(state: ViewState): void {
    this._viewState = state;
  }

  getViewState(): ViewState | null {
    return this._viewState;
  }

  // ══════════════════════════════════════════════════
  //  状态监听
  // ══════════════════════════════════════════════════

  onStateChange(listener: (state: DocState) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  // ══════════════════════════════════════════════════
  //  内部方法
  // ══════════════════════════════════════════════════

  private _setState(newState: DocState): void {
    if (this._state === newState) return;
    this._state = newState;
    this._listeners.forEach((fn) => fn(newState));
  }

  private _pathToUri(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    if (/^[a-zA-Z]:/.test(normalized)) {
      return `file:///${normalized}`;
    }
    return `file://${normalized}`;
  }
}
