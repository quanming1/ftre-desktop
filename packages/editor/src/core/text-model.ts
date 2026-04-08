/**
 * TextModel — 文本模型管理
 *
 * 参考 VSCode 的 ITextModel 设计，简化版实现：
 * - 管理 Monaco ITextModel 实例
 * - 支持 dirty 状态追踪（基于 versionId）
 * - 支持 viewState 保存/恢复
 * - 全局单例管理所有 model
 */

import type { editor } from "monaco-editor";
import type * as Monaco from "monaco-editor";

// ══════════════════════════════════════════════════
//  类型定义
// ══════════════════════════════════════════════════

export interface ITextModelOptions {
  content: string;
  language: string;
}

export interface IViewState {
  cursorState: editor.ICursorState[] | null;
  viewState: {
    scrollTop: number;
    scrollLeft: number;
    firstPosition: { lineNumber: number; column: number } | null;
    firstPositionDeltaTop: number;
  } | null;
}

export interface ITextModelData {
  model: editor.ITextModel;
  /** 保存时的 alternativeVersionId */
  savedVersionId: number;
  /** 原始换行符 */
  lineEnding: "lf" | "crlf";
  /** 缓存的 viewState */
  viewState: IViewState | null;
}

// ══════════════════════════════════════════════════
//  语言检测
// ══════════════════════════════════════════════════

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  sh: "shellscript",
  bash: "shellscript",
  sql: "sql",
  vue: "vue",
  svelte: "svelte",
  toml: "toml",
  ini: "ini",
  dockerfile: "dockerfile",
  makefile: "makefile",
};

function detectLanguage(uri: string): string {
  const fileName = uri.split(/[\\/]/).pop() ?? "";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_LANGUAGE_MAP[ext] || "plaintext";
}

function detectLineEnding(content: string): "lf" | "crlf" {
  const crlfCount = (content.match(/\r\n/g) || []).length;
  const lfCount = (content.match(/(?<!\r)\n/g) || []).length;
  return crlfCount > lfCount ? "crlf" : "lf";
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function denormalizeContent(content: string, lineEnding: "lf" | "crlf"): string {
  if (lineEnding === "crlf") {
    return content.replace(/\n/g, "\r\n");
  }
  return content;
}

function pathToUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}

// ══════════════════════════════════════════════════
//  TextModelService 类
// ══════════════════════════════════════════════════

class TextModelService {
  private _monaco: typeof Monaco | null = null;
  private _models = new Map<string, ITextModelData>();
  private _disposed = false;

  /**
   * 初始化服务
   */
  init(monaco: typeof Monaco): void {
    if (this._disposed) return;
    this._monaco = monaco;
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this._monaco !== null;
  }

  /**
   * 获取或创建 TextModel
   */
  getOrCreate(uri: string, options?: ITextModelOptions): ITextModelData | null {
    if (!this._monaco) {
      console.error("[TextModelService] Monaco not initialized");
      return null;
    }

    // 检查是否已存在
    const existing = this._models.get(uri);
    if (existing && !existing.model.isDisposed()) {
      return existing;
    }

    // 需要 options 来创建
    if (!options) {
      return null;
    }

    // 检测换行符并规范化
    const lineEnding = detectLineEnding(options.content);
    const normalized = normalizeContent(options.content);

    // 创建 Monaco URI
    const monacoUri = this._monaco.Uri.parse(pathToUri(uri));

    // 检查是否已有 Monaco model（可能是外部创建的）
    let model = this._monaco.editor.getModel(monacoUri);
    if (model && !model.isDisposed()) {
      // 更新内容
      model.setValue(normalized);
    } else {
      // 创建新 model
      const language = options.language || detectLanguage(uri);
      model = this._monaco.editor.createModel(normalized, language, monacoUri);
    }

    const data: ITextModelData = {
      model,
      savedVersionId: model.getAlternativeVersionId(),
      lineEnding,
      viewState: null,
    };

    this._models.set(uri, data);
    return data;
  }

  /**
   * 获取已存在的 TextModel
   */
  get(uri: string): ITextModelData | null {
    const data = this._models.get(uri);
    if (data && !data.model.isDisposed()) {
      return data;
    }
    return null;
  }

  /**
   * 检查是否存在
   */
  has(uri: string): boolean {
    const data = this._models.get(uri);
    return data !== undefined && !data.model.isDisposed();
  }

  /**
   * 更新内容（外部文件变更时）
   */
  updateContent(uri: string, newContent: string): boolean {
    const data = this._models.get(uri);
    if (!data || data.model.isDisposed()) {
      return false;
    }

    // 如果 dirty，不自动更新（需要用户确认）
    if (this.isDirty(uri)) {
      return false;
    }

    const lineEnding = detectLineEnding(newContent);
    const normalized = normalizeContent(newContent);

    data.model.setValue(normalized);
    data.savedVersionId = data.model.getAlternativeVersionId();
    data.lineEnding = lineEnding;

    return true;
  }

  /**
   * 检查是否 dirty
   */
  isDirty(uri: string): boolean {
    const data = this._models.get(uri);
    if (!data || data.model.isDisposed()) {
      return false;
    }
    return data.model.getAlternativeVersionId() !== data.savedVersionId;
  }

  /**
   * 获取所有 dirty 的 uri
   */
  getDirtyUris(): string[] {
    const result: string[] = [];
    for (const [uri, data] of this._models) {
      if (!data.model.isDisposed() && this.isDirty(uri)) {
        result.push(uri);
      }
    }
    return result;
  }

  /**
   * 标记为已保存
   */
  markSaved(uri: string): void {
    const data = this._models.get(uri);
    if (!data || data.model.isDisposed()) {
      return;
    }
    data.savedVersionId = data.model.getAlternativeVersionId();
  }

  /**
   * 获取用于保存的内容（恢复原始换行符）
   */
  getContentForSave(uri: string): string | null {
    const data = this._models.get(uri);
    if (!data || data.model.isDisposed()) {
      return null;
    }
    const content = data.model.getValue();
    return denormalizeContent(content, data.lineEnding);
  }

  /**
   * 保存 viewState
   */
  saveViewState(uri: string, viewState: IViewState): void {
    const data = this._models.get(uri);
    if (data) {
      data.viewState = viewState;
    }
  }

  /**
   * 获取 viewState
   */
  getViewState(uri: string): IViewState | null {
    return this._models.get(uri)?.viewState ?? null;
  }

  /**
   * 设置语言
   */
  setLanguage(uri: string, language: string): void {
    if (!this._monaco) return;
    const data = this._models.get(uri);
    if (data && !data.model.isDisposed()) {
      this._monaco.editor.setModelLanguage(data.model, language);
    }
  }

  /**
   * 销毁指定 model
   */
  dispose(uri: string): void {
    const data = this._models.get(uri);
    if (data) {
      if (!data.model.isDisposed()) {
        data.model.dispose();
      }
      this._models.delete(uri);
    }
  }

  /**
   * 销毁所有 model
   */
  disposeAll(): void {
    for (const [uri] of this._models) {
      this.dispose(uri);
    }
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.disposeAll();
    this._monaco = null;
  }

  /**
   * 重命名文件时更新 uri
   */
  rename(oldUri: string, newUri: string): void {
    const data = this._models.get(oldUri);
    if (!data) return;

    // Monaco model 不支持重命名 uri，需要重新创建
    const content = data.model.getValue();
    const language = data.model.getLanguageId();
    const viewState = data.viewState;
    const savedVersionId = data.savedVersionId;
    const currentVersionId = data.model.getAlternativeVersionId();
    const wasDirty = currentVersionId !== savedVersionId;

    // 销毁旧的
    this.dispose(oldUri);

    // 创建新的
    const newData = this.getOrCreate(newUri, { content, language });
    if (newData) {
      newData.viewState = viewState;
      newData.lineEnding = data.lineEnding;
      // 如果之前是 dirty，保持 dirty 状态
      if (!wasDirty) {
        newData.savedVersionId = newData.model.getAlternativeVersionId();
      }
    }
  }
}

// ══════════════════════════════════════════════════
//  全局单例
// ══════════════════════════════════════════════════

let instance: TextModelService | null = null;

export function getTextModelService(): TextModelService {
  if (!instance) {
    instance = new TextModelService();
  }
  return instance;
}

export function disposeTextModelService(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

// 用于测试
export function _resetTextModelService(): void {
  if (instance) {
    instance.disposeAll();
  }
}
