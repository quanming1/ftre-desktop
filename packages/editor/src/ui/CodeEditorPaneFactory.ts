/**
 * CodeEditorPaneFactory - EditorPane 工厂实现
 *
 * 实现 IEditorPaneFactory 接口，用于创建和管理 EditorPane 实例
 *
 * 职责:
 * 1. 注册 EditorPane 描述符
 * 2. 根据 EditorInput 类型创建对应的 EditorPane
 * 3. 提供内容获取机制（ITextContentProvider）
 */

import type * as monaco from "monaco-editor";
import {
  type IEditorPaneFactory,
  type IEditorPaneDescriptor,
  type EditorPane,
  type IEditorGroup,
  EditorInput,
  FileEditorInput,
  UntitledEditorInput,
  TextCodeEditorPane,
  textCodeEditorPaneDescriptor,
  createTextCodeEditorPane,
  type ITextCodeEditorOptions,
  type ITextCodeEditorCallbacks,
  type ITextContentProvider,
} from "../workbench";

// ═══════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 内容存储接口
 *
 * 用于从外部获取文件内容
 */
export interface IContentStore {
  /**
   * 获取文件内容
   */
  getContent(path: string): string | undefined;

  /**
   * 获取文件语言
   */
  getLanguage(path: string): string | undefined;
}

/**
 * 工厂配置选项
 */
export interface ICodeEditorPaneFactoryOptions {
  /** Monaco 实例 */
  monaco: typeof monaco;
  /** 编辑器选项 */
  editorOptions?: ITextCodeEditorOptions;
  /** 事件回调 */
  callbacks?: ITextCodeEditorCallbacks;
  /** 内容存储 */
  contentStore?: IContentStore;
}

// ═══════════════════════════════════════════════════════════════════════════
// CodeEditorPaneFactory 实现
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 代码编辑器面板工厂
 *
 * 实现 IEditorPaneFactory 接口，用于 EditorPanes 管理器
 */
export class CodeEditorPaneFactory implements IEditorPaneFactory {
  /** Monaco 实例 */
  private readonly _monaco: typeof monaco;

  /** 编辑器选项 */
  private readonly _editorOptions: ITextCodeEditorOptions;

  /** 事件回调 */
  private _callbacks: ITextCodeEditorCallbacks;

  /** 内容存储 */
  private _contentStore: IContentStore | undefined;

  /** 内容提供者 */
  private readonly _contentProvider: ITextContentProvider;

  /** 已注册的描述符 */
  private readonly _descriptors: Map<string, IEditorPaneDescriptor> = new Map();

  constructor(options: ICodeEditorPaneFactoryOptions) {
    this._monaco = options.monaco;
    this._editorOptions = options.editorOptions || {};
    this._callbacks = options.callbacks || {};
    this._contentStore = options.contentStore;

    // 创建内容提供者
    this._contentProvider = {
      getContent: async (resource: string) => {
        if (!this._contentStore) {
          return undefined;
        }
        const content = this._contentStore.getContent(resource);
        const language = this._contentStore.getLanguage(resource);
        if (content === undefined) {
          return undefined;
        }
        return {
          content,
          language: language || "plaintext",
        };
      },
    };

    // 注册默认描述符
    this._registerDefaultDescriptors();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IEditorPaneFactory 实现
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 获取可以处理指定输入的描述符
   */
  getDescriptor(input: EditorInput): IEditorPaneDescriptor | undefined {
    const typeId = input.typeId;

    // 查找可以处理此类型的描述符
    for (const descriptor of this._descriptors.values()) {
      if (descriptor.canHandle(input)) {
        return descriptor;
      }
    }

    // 回退：检查是否为文件或未命名输入
    if (
      typeId === FileEditorInput.TYPE_ID ||
      typeId === UntitledEditorInput.TYPE_ID
    ) {
      return textCodeEditorPaneDescriptor;
    }

    return undefined;
  }

  /**
   * 创建 EditorPane 实例
   */
  createEditorPane(
    descriptor: IEditorPaneDescriptor,
    group: IEditorGroup,
  ): EditorPane {
    // 目前只支持 TextCodeEditorPane
    if (descriptor.typeId === TextCodeEditorPane.ID) {
      const pane = createTextCodeEditorPane(
        group,
        this._monaco,
        this._editorOptions,
        this._contentProvider,
      );

      // 设置回调
      pane.setCallbacks(this._callbacks);

      return pane;
    }

    // 未知类型，抛出错误
    throw new Error(`Unknown EditorPane descriptor: ${descriptor.typeId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 公共方法
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 注册描述符
   */
  registerDescriptor(descriptor: IEditorPaneDescriptor): void {
    this._descriptors.set(descriptor.typeId, descriptor);
  }

  /**
   * 取消注册描述符
   */
  unregisterDescriptor(typeId: string): void {
    this._descriptors.delete(typeId);
  }

  /**
   * 更新回调
   */
  setCallbacks(callbacks: ITextCodeEditorCallbacks): void {
    this._callbacks = callbacks;
  }

  /**
   * 更新内容存储
   */
  setContentStore(store: IContentStore): void {
    this._contentStore = store;
  }

  /**
   * 获取 Monaco 实例
   */
  getMonaco(): typeof monaco {
    return this._monaco;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 注册默认描述符
   */
  private _registerDefaultDescriptors(): void {
    // 注册 TextCodeEditorPane 描述符
    this.registerDescriptor(textCodeEditorPaneDescriptor);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 工厂函数
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 创建 CodeEditorPaneFactory 实例
 */
export function createCodeEditorPaneFactory(
  options: ICodeEditorPaneFactoryOptions,
): CodeEditorPaneFactory {
  return new CodeEditorPaneFactory(options);
}
