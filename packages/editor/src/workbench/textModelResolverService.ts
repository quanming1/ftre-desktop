/**
 * TextModel Resolver Service
 *
 * 参考 VSCode: vs/editor/common/services/resolverService.ts
 *
 * 职责:
 * 1. 管理 TextModel 的生命周期（创建、缓存、销毁）
 * 2. 按 URI 缓存 Model，支持多视图共享
 * 3. 引用计数，自动清理不再使用的 Model
 * 4. 处理 Model 的创建和解析
 */

import type * as monaco from "monaco-editor";
import type { ITextModel } from "../common/editorCommon";

// ═══════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 文本模型创建选项
 */
export interface ITextModelContentOptions {
  /** 文件内容 */
  content: string;
  /** 语言 ID */
  language: string;
  /** 编码（可选） */
  encoding?: string;
}

/**
 * 已解析的文本模型引用
 *
 * 持有此引用时，Model 不会被自动销毁
 * 使用完毕后必须调用 dispose() 释放引用
 */
export interface IResolvedTextModelReference {
  /** 文本模型 */
  readonly model: ITextModel;
  /** 原始换行符类型 */
  readonly lineEnding: "lf" | "crlf";
  /** 保存时的版本 ID */
  readonly savedVersionId: number;
  /** 释放引用 */
  dispose(): void;
}

/**
 * 文本模型解析服务接口
 */
export interface ITextModelResolverService {
  /**
   * 解析/创建文本模型
   *
   * @param resource 资源 URI
   * @param options 创建选项（首次创建时需要）
   * @returns 文本模型引用
   */
  createModelReference(
    resource: string,
    options?: ITextModelContentOptions
  ): Promise<IResolvedTextModelReference>;

  /**
   * 检查模型是否存在
   */
  hasModel(resource: string): boolean;

  /**
   * 获取已存在的模型（不增加引用计数）
   */
  getModel(resource: string): ITextModel | undefined;

  /**
   * 检查模型是否有未保存的更改
   */
  isDirty(resource: string): boolean;

  /**
   * 获取所有 dirty 模型的 URI
   */
  getDirtyUris(): string[];

  /**
   * 标记模型为已保存
   */
  markSaved(resource: string): void;

  /**
   * 获取用于保存的内容（恢复原始换行符）
   */
  getContentForSave(resource: string): string | undefined;

  /**
   * 更新模型内容（外部文件变化时）
   */
  updateContent(resource: string, content: string): void;

  /**
   * 重命名资源
   */
  rename(oldResource: string, newResource: string): void;

  /**
   * 强制销毁模型（忽略引用计数）
   */
  disposeModel(resource: string): void;

  /**
   * 销毁所有模型
   */
  disposeAll(): void;
}

// ═══════════════════════════════════════════════════════════════════════════
// 内部类型
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 模型数据（内部使用）
 */
interface IModelData {
  /** Monaco 文本模型 */
  model: monaco.editor.ITextModel;
  /** 引用计数 */
  refCount: number;
  /** 保存时的版本 ID（用于 dirty 检测） */
  savedVersionId: number;
  /** 原始换行符 */
  lineEnding: "lf" | "crlf";
  /** 是否正在销毁 */
  disposing: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// TextModelResolverService 实现
// ═══════════════════════════════════════════════════════════════════════════

/**
 * TextModel 解析服务
 *
 * 核心职责:
 * 1. 创建和缓存 TextModel
 * 2. 引用计数管理
 * 3. 自动清理无引用的 Model
 */
export class TextModelResolverService implements ITextModelResolverService {
  /** Monaco 实例 */
  private _monaco: typeof monaco | null = null;

  /** 模型缓存: URI -> ModelData */
  private readonly _models: Map<string, IModelData> = new Map();

  /** 语言映射表 */
  private static readonly LANGUAGE_MAP: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    mjs: "javascript",
    cjs: "javascript",
    mts: "typescript",
    cts: "typescript",
    json: "json",
    jsonc: "json",
    json5: "json",
    html: "html",
    htm: "html",
    xhtml: "html",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "less",
    md: "markdown",
    markdown: "markdown",
    xml: "xml",
    svg: "xml",
    yaml: "yaml",
    yml: "yaml",
    py: "python",
    pyw: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    hh: "cpp",
    hxx: "cpp",
    cs: "csharp",
    fs: "fsharp",
    fsx: "fsharp",
    php: "php",
    swift: "swift",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    fish: "shell",
    ps1: "powershell",
    psm1: "powershell",
    psd1: "powershell",
    sql: "sql",
    graphql: "graphql",
    gql: "graphql",
    vue: "vue",
    svelte: "svelte",
    lua: "lua",
    r: "r",
    R: "r",
    scala: "scala",
    clj: "clojure",
    cljs: "clojure",
    cljc: "clojure",
    ex: "elixir",
    exs: "elixir",
    erl: "erlang",
    hrl: "erlang",
    hs: "haskell",
    lhs: "haskell",
    ml: "ocaml",
    mli: "ocaml",
    pl: "perl",
    pm: "perl",
    dart: "dart",
    dockerfile: "dockerfile",
    makefile: "makefile",
    cmake: "cmake",
    toml: "toml",
    ini: "ini",
    cfg: "ini",
    conf: "ini",
    properties: "ini",
    diff: "diff",
    patch: "diff",
    log: "log",
    txt: "plaintext",
  };

  /**
   * 初始化服务
   *
   * @param monacoInstance Monaco 编辑器实例
   */
  init(monacoInstance: typeof monaco): void {
    this._monaco = monacoInstance;
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this._monaco !== null;
  }

  /**
   * 解析/创建文本模型
   */
  async createModelReference(
    resource: string,
    options?: ITextModelContentOptions
  ): Promise<IResolvedTextModelReference> {
    if (!this._monaco) {
      throw new Error("TextModelResolverService not initialized");
    }

    // 检查是否已存在
    let modelData = this._models.get(resource);

    if (modelData) {
      // 已存在，增加引用计数
      modelData.refCount++;
    } else {
      // 不存在，创建新的
      if (!options) {
        throw new Error(
          `Model not found and no options provided: ${resource}`
        );
      }

      modelData = this._createModel(resource, options);
      this._models.set(resource, modelData);
    }

    // 返回引用对象
    return this._createReference(resource, modelData);
  }

  /**
   * 检查模型是否存在
   */
  hasModel(resource: string): boolean {
    return this._models.has(resource);
  }

  /**
   * 获取已存在的模型（不增加引用计数）
   */
  getModel(resource: string): ITextModel | undefined {
    const data = this._models.get(resource);
    return data?.model as ITextModel | undefined;
  }

  /**
   * 检查模型是否有未保存的更改
   */
  isDirty(resource: string): boolean {
    const data = this._models.get(resource);
    if (!data) {
      return false;
    }
    return data.model.getAlternativeVersionId() !== data.savedVersionId;
  }

  /**
   * 获取所有 dirty 模型的 URI
   */
  getDirtyUris(): string[] {
    const dirtyUris: string[] = [];
    for (const [uri, data] of this._models) {
      if (data.model.getAlternativeVersionId() !== data.savedVersionId) {
        dirtyUris.push(uri);
      }
    }
    return dirtyUris;
  }

  /**
   * 标记模型为已保存
   */
  markSaved(resource: string): void {
    const data = this._models.get(resource);
    if (data) {
      data.savedVersionId = data.model.getAlternativeVersionId();
    }
  }

  /**
   * 获取用于保存的内容（恢复原始换行符）
   */
  getContentForSave(resource: string): string | undefined {
    const data = this._models.get(resource);
    if (!data) {
      return undefined;
    }

    const content = data.model.getValue();

    // Monaco 内部使用 \n，需要根据原始换行符转换
    if (data.lineEnding === "crlf") {
      return content.replace(/\n/g, "\r\n");
    }

    return content;
  }

  /**
   * 更新模型内容（外部文件变化时）
   */
  updateContent(resource: string, content: string): void {
    const data = this._models.get(resource);
    if (!data) {
      return;
    }

    // 规范化换行符
    const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // 使用 pushEditOperations 保持 undo 栈
    const fullRange = data.model.getFullModelRange();
    data.model.pushEditOperations(
      [],
      [
        {
          range: fullRange,
          text: normalized,
        },
      ],
      () => null
    );

    // 更新保存版本
    data.savedVersionId = data.model.getAlternativeVersionId();
  }

  /**
   * 重命名资源
   */
  rename(oldResource: string, newResource: string): void {
    const data = this._models.get(oldResource);
    if (!data) {
      return;
    }

    // 移动到新 URI
    this._models.delete(oldResource);
    this._models.set(newResource, data);

    // 注意：Monaco Model 的 URI 无法更改
    // 如果需要，可以创建新 Model 并复制内容
  }

  /**
   * 强制销毁模型（忽略引用计数）
   */
  disposeModel(resource: string): void {
    const data = this._models.get(resource);
    if (data) {
      data.disposing = true;
      if (!data.model.isDisposed()) {
        data.model.dispose();
      }
      this._models.delete(resource);
    }
  }

  /**
   * 销毁所有模型
   */
  disposeAll(): void {
    for (const [resource] of this._models) {
      this.disposeModel(resource);
    }
    this._models.clear();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 创建新模型
   */
  private _createModel(
    resource: string,
    options: ITextModelContentOptions
  ): IModelData {
    const monaco = this._monaco!;
    const { content, language } = options;

    // 检测原始换行符
    const lineEnding = this._detectLineEnding(content);

    // 规范化换行符（Monaco 内部使用 \n）
    const normalizedContent = content
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");

    // 解析语言
    const resolvedLanguage = this._resolveLanguage(resource, language);

    // 创建 URI
    const uri = monaco.Uri.parse(`file://${resource}`);

    // 检查是否已存在（可能由外部创建）
    let model = monaco.editor.getModel(uri);

    if (model) {
      // 已存在，更新内容
      model.setValue(normalizedContent);
      monaco.editor.setModelLanguage(model, resolvedLanguage);
    } else {
      // 创建新模型
      model = monaco.editor.createModel(normalizedContent, resolvedLanguage, uri);
    }

    return {
      model,
      refCount: 1,
      savedVersionId: model.getAlternativeVersionId(),
      lineEnding,
      disposing: false,
    };
  }

  /**
   * 创建模型引用对象
   */
  private _createReference(
    resource: string,
    data: IModelData
  ): IResolvedTextModelReference {
    let disposed = false;

    return {
      model: data.model as ITextModel,
      lineEnding: data.lineEnding,
      savedVersionId: data.savedVersionId,
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;

        // 减少引用计数
        data.refCount--;

        // 如果引用计数为 0，可以考虑延迟清理
        // 这里我们保留模型，不自动销毁
        // 让 EditorPanes 或上层决定何时销毁
        if (data.refCount <= 0 && !data.disposing) {
          // 可选：延迟清理
          // setTimeout(() => {
          //   if (data.refCount <= 0 && !data.disposing) {
          //     this.disposeModel(resource);
          //   }
          // }, 60000); // 60 秒后清理
        }
      },
    };
  }

  /**
   * 检测换行符类型
   */
  private _detectLineEnding(content: string): "lf" | "crlf" {
    const crlfCount = (content.match(/\r\n/g) || []).length;
    const lfCount = (content.match(/(?<!\r)\n/g) || []).length;
    return crlfCount > lfCount ? "crlf" : "lf";
  }

  /**
   * 解析语言 ID
   */
  private _resolveLanguage(resource: string, language?: string): string {
    if (language && language !== "plaintext") {
      return language;
    }

    // 从文件扩展名推断
    const ext = this._getExtension(resource);
    if (ext) {
      const mapped = TextModelResolverService.LANGUAGE_MAP[ext.toLowerCase()];
      if (mapped) {
        return mapped;
      }
    }

    // 检查特殊文件名
    const filename = this._getFilename(resource).toLowerCase();
    if (filename === "dockerfile" || filename.startsWith("dockerfile.")) {
      return "dockerfile";
    }
    if (filename === "makefile" || filename === "gnumakefile") {
      return "makefile";
    }
    if (filename === "cmakelists.txt") {
      return "cmake";
    }
    if (filename === ".gitignore" || filename === ".dockerignore") {
      return "ignore";
    }
    if (filename === ".env" || filename.startsWith(".env.")) {
      return "dotenv";
    }

    return language || "plaintext";
  }

  /**
   * 获取文件扩展名
   */
  private _getExtension(resource: string): string {
    const filename = this._getFilename(resource);
    const dotIndex = filename.lastIndexOf(".");
    if (dotIndex === -1 || dotIndex === 0) {
      return "";
    }
    return filename.slice(dotIndex + 1);
  }

  /**
   * 获取文件名
   */
  private _getFilename(resource: string): string {
    const normalized = resource.replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 全局单例
// ═══════════════════════════════════════════════════════════════════════════

let _textModelResolverService: TextModelResolverService | null = null;

/**
 * 获取 TextModelResolverService 单例
 */
export function getTextModelResolverService(): TextModelResolverService {
  if (!_textModelResolverService) {
    _textModelResolverService = new TextModelResolverService();
  }
  return _textModelResolverService;
}

/**
 * 销毁 TextModelResolverService 单例
 */
export function disposeTextModelResolverService(): void {
  if (_textModelResolverService) {
    _textModelResolverService.disposeAll();
    _textModelResolverService = null;
  }
}
