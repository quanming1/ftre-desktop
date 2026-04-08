/**
 * editorInput.ts — 编辑器输入抽象
 *
 * 参考 VSCode 的 vs/workbench/common/editor.ts 中的 EditorInput
 * EditorInput 是"要编辑什么"的描述，不是编辑器本身
 */

import type { IDisposable } from "monaco-editor";

// ══════════════════════════════════════════════════
//  类型定义
// ══════════════════════════════════════════════════

/**
 * 编辑器输入能力标志
 */
export const enum EditorInputCapabilities {
  /**
   * 无特定能力
   */
  None = 0,

  /**
   * 只读
   */
  Readonly = 1 << 1,

  /**
   * 未命名（未保存到磁盘）
   */
  Untitled = 1 << 2,

  /**
   * 单例（只能在一个组中打开）
   */
  Singleton = 1 << 3,

  /**
   * 需要工作区信任
   */
  RequiresTrust = 1 << 4,

  /**
   * 可以在同一组内拆分
   */
  CanSplitInGroup = 1 << 5,

  /**
   * 草稿本
   */
  Scratchpad = 1 << 6,
}

/**
 * 关闭编辑器的原因
 */
export const enum CloseReason {
  /**
   * 未知原因
   */
  Unknown = 0,

  /**
   * 用户触发的关闭
   */
  User = 1,

  /**
   * 导航到其他编辑器
   */
  Navigation = 2,

  /**
   * 被替换
   */
  Replace = 3,
}

/**
 * 序列化的编辑器输入
 */
export interface ISerializedEditorInput {
  /**
   * 输入类型 ID
   */
  readonly typeId: string;

  /**
   * 序列化数据
   */
  readonly data?: unknown;
}

/**
 * 事件发射器简单实现
 */
class Emitter<T> {
  private listeners: Set<(e: T) => void> = new Set();

  get event(): (listener: (e: T) => void) => IDisposable {
    return (listener: (e: T) => void) => {
      this.listeners.add(listener);
      return {
        dispose: () => {
          this.listeners.delete(listener);
        },
      };
    };
  }

  fire(event: T): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error("Error in event listener:", e);
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

// ══════════════════════════════════════════════════
//  EditorInput 基类
// ══════════════════════════════════════════════════

/**
 * EditorInput 基类
 *
 * 编辑器输入是编辑器内容的抽象表示：
 * - 不是编辑器本身，而是"要编辑什么"的描述
 * - 每种类型的文件/资源都有对应的 EditorInput 子类
 * - 可以序列化和反序列化用于状态恢复
 */
export abstract class EditorInput implements IDisposable {
  // ── 私有字段 ──

  private _disposed = false;
  private _dirty = false;

  // ── 事件 ──

  private readonly _onWillDispose = new Emitter<void>();
  readonly onWillDispose = this._onWillDispose.event;

  private readonly _onDidChangeDirty = new Emitter<void>();
  readonly onDidChangeDirty = this._onDidChangeDirty.event;

  private readonly _onDidChangeCapabilities = new Emitter<void>();
  readonly onDidChangeCapabilities = this._onDidChangeCapabilities.event;

  private readonly _onDidChangeLabel = new Emitter<void>();
  readonly onDidChangeLabel = this._onDidChangeLabel.event;

  // ══════════════════════════════════════════════════
  //  抽象方法 - 子类必须实现
  // ══════════════════════════════════════════════════

  /**
   * 输入类型 ID（用于序列化和反序列化）
   */
  abstract get typeId(): string;

  /**
   * 关联的资源 URI
   */
  abstract get resource(): string | undefined;

  /**
   * 序列化输入
   */
  abstract serialize(): ISerializedEditorInput | undefined;

  // ══════════════════════════════════════════════════
  //  可选方法 - 子类可重写
  // ══════════════════════════════════════════════════

  /**
   * 获取显示名称
   */
  getName(): string {
    const resource = this.resource;
    if (resource) {
      const parts = resource.split(/[\\/]/);
      return parts[parts.length - 1] || resource;
    }
    return "Untitled";
  }

  /**
   * 获取描述（用于标签提示）
   */
  getDescription(): string | undefined {
    return this.resource;
  }

  /**
   * 获取标题
   */
  getTitle(): string {
    return this.getName();
  }

  /**
   * 获取编辑器能力
   */
  get capabilities(): EditorInputCapabilities {
    return EditorInputCapabilities.None;
  }

  /**
   * 检查是否有特定能力
   */
  hasCapability(capability: EditorInputCapabilities): boolean {
    if (capability === EditorInputCapabilities.None) {
      return this.capabilities === EditorInputCapabilities.None;
    }
    return (this.capabilities & capability) !== 0;
  }

  // ══════════════════════════════════════════════════
  //  状态管理
  // ══════════════════════════════════════════════════

  /**
   * 是否为脏状态
   */
  isDirty(): boolean {
    return this._dirty;
  }

  /**
   * 设置脏状态
   */
  protected setDirty(dirty: boolean): void {
    if (this._dirty !== dirty) {
      this._dirty = dirty;
      this._onDidChangeDirty.fire();
    }
  }

  /**
   * 是否只读
   */
  isReadonly(): boolean {
    return this.hasCapability(EditorInputCapabilities.Readonly);
  }

  /**
   * 是否未命名
   */
  isUntitled(): boolean {
    return this.hasCapability(EditorInputCapabilities.Untitled);
  }

  /**
   * 是否已释放
   */
  isDisposed(): boolean {
    return this._disposed;
  }

  // ══════════════════════════════════════════════════
  //  比较和匹配
  // ══════════════════════════════════════════════════

  /**
   * 判断两个输入是否匹配（用于查找已打开的编辑器）
   */
  matches(other: EditorInput | IResourceEditorInput | IUntitledEditorInput): boolean {
    if (this === other) {
      return true;
    }

    if (other instanceof EditorInput) {
      return this.typeId === other.typeId && this.resource === other.resource;
    }

    // 检查资源匹配
    if (isResourceEditorInput(other)) {
      return this.resource === other.resource;
    }

    return false;
  }

  // ══════════════════════════════════════════════════
  //  生命周期
  // ══════════════════════════════════════════════════

  /**
   * 关闭前回调
   */
  async closeHandler?(
    group: { id: number },
    reason: CloseReason,
  ): Promise<boolean>;

  /**
   * 释放资源
   */
  dispose(): void {
    if (!this._disposed) {
      this._disposed = true;
      this._onWillDispose.fire();
      this._onWillDispose.dispose();
      this._onDidChangeDirty.dispose();
      this._onDidChangeCapabilities.dispose();
      this._onDidChangeLabel.dispose();
    }
  }
}

// ══════════════════════════════════════════════════
//  具体实现 - FileEditorInput
// ══════════════════════════════════════════════════

/**
 * 文件编辑器输入
 */
export class FileEditorInput extends EditorInput {
  static readonly TYPE_ID = "workbench.editors.files.fileEditorInput";

  private _name: string;
  private _path: string;
  private _language: string;

  constructor(options: {
    path: string;
    name?: string;
    language?: string;
  }) {
    super();
    this._path = options.path;
    this._name = options.name ?? this._extractName(options.path);
    this._language = options.language ?? "plaintext";
  }

  private _extractName(path: string): string {
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
  }

  get typeId(): string {
    return FileEditorInput.TYPE_ID;
  }

  get resource(): string {
    return this._path;
  }

  get path(): string {
    return this._path;
  }

  get language(): string {
    return this._language;
  }

  setLanguage(language: string): void {
    this._language = language;
  }

  override getName(): string {
    return this._name;
  }

  override getDescription(): string {
    return this._path;
  }

  serialize(): ISerializedEditorInput {
    return {
      typeId: this.typeId,
      data: {
        path: this._path,
        name: this._name,
        language: this._language,
      },
    };
  }

  /**
   * 从序列化数据恢复
   */
  static deserialize(data: unknown): FileEditorInput | undefined {
    if (data && typeof data === "object") {
      const d = data as { path?: string; name?: string; language?: string };
      if (d.path) {
        return new FileEditorInput({
          path: d.path,
          name: d.name,
          language: d.language,
        });
      }
    }
    return undefined;
  }
}

// ══════════════════════════════════════════════════
//  具体实现 - UntitledEditorInput
// ══════════════════════════════════════════════════

/**
 * 未命名编辑器输入（临时文件）
 */
export class UntitledEditorInput extends EditorInput {
  static readonly TYPE_ID = "workbench.editors.untitledEditorInput";

  private static _counter = 0;
  private readonly _id: number;
  private _name: string;
  private _language: string;
  private _content: string;

  constructor(options?: {
    name?: string;
    language?: string;
    content?: string;
  }) {
    super();
    this._id = ++UntitledEditorInput._counter;
    this._name = options?.name ?? `Untitled-${this._id}`;
    this._language = options?.language ?? "plaintext";
    this._content = options?.content ?? "";
  }

  get typeId(): string {
    return UntitledEditorInput.TYPE_ID;
  }

  get resource(): string {
    return `untitled:${this._id}`;
  }

  override get capabilities(): EditorInputCapabilities {
    return EditorInputCapabilities.Untitled;
  }

  override getName(): string {
    return this._name;
  }

  get language(): string {
    return this._language;
  }

  setLanguage(language: string): void {
    this._language = language;
  }

  get content(): string {
    return this._content;
  }

  setContent(content: string): void {
    this._content = content;
  }

  serialize(): ISerializedEditorInput {
    return {
      typeId: this.typeId,
      data: {
        id: this._id,
        name: this._name,
        language: this._language,
        content: this._content,
      },
    };
  }

  static deserialize(data: unknown): UntitledEditorInput | undefined {
    if (data && typeof data === "object") {
      const d = data as {
        name?: string;
        language?: string;
        content?: string;
      };
      return new UntitledEditorInput({
        name: d.name,
        language: d.language,
        content: d.content,
      });
    }
    return undefined;
  }
}

// ══════════════════════════════════════════════════
//  具体实现 - DiffEditorInput
// ══════════════════════════════════════════════════

/**
 * 差异编辑器输入
 */
export class DiffEditorInput extends EditorInput {
  static readonly TYPE_ID = "workbench.editors.diffEditorInput";

  constructor(
    private readonly _name: string,
    private readonly _original: EditorInput,
    private readonly _modified: EditorInput,
  ) {
    super();
  }

  get typeId(): string {
    return DiffEditorInput.TYPE_ID;
  }

  get resource(): string | undefined {
    return this._modified.resource;
  }

  get original(): EditorInput {
    return this._original;
  }

  get modified(): EditorInput {
    return this._modified;
  }

  override getName(): string {
    return this._name;
  }

  override getDescription(): string {
    return `${this._original.getName()} ↔ ${this._modified.getName()}`;
  }

  serialize(): ISerializedEditorInput | undefined {
    const originalSerialized = this._original.serialize();
    const modifiedSerialized = this._modified.serialize();

    if (!originalSerialized || !modifiedSerialized) {
      return undefined;
    }

    return {
      typeId: this.typeId,
      data: {
        name: this._name,
        original: originalSerialized,
        modified: modifiedSerialized,
      },
    };
  }

  override dispose(): void {
    this._original.dispose();
    this._modified.dispose();
    super.dispose();
  }
}

// ══════════════════════════════════════════════════
//  辅助接口
// ══════════════════════════════════════════════════

/**
 * 资源编辑器输入接口
 */
export interface IResourceEditorInput {
  readonly resource: string;
}

/**
 * 未命名编辑器输入接口
 */
export interface IUntitledEditorInput {
  readonly forceUntitled: true;
}

/**
 * 判断是否为资源编辑器输入
 */
export function isResourceEditorInput(
  thing: unknown,
): thing is IResourceEditorInput {
  if (thing && typeof thing === "object") {
    const input = thing as IResourceEditorInput;
    return typeof input.resource === "string";
  }
  return false;
}

/**
 * 判断是否为未命名编辑器输入
 */
export function isUntitledEditorInput(
  thing: unknown,
): thing is IUntitledEditorInput {
  if (thing && typeof thing === "object") {
    const input = thing as IUntitledEditorInput;
    return input.forceUntitled === true;
  }
  return false;
}

// ══════════════════════════════════════════════════
//  编辑器输入工厂
// ══════════════════════════════════════════════════

/**
 * 编辑器输入序列化器接口
 */
export interface IEditorInputSerializer<T extends EditorInput = EditorInput> {
  /**
   * 是否可以序列化
   */
  canSerialize(input: EditorInput): boolean;

  /**
   * 序列化
   */
  serialize(input: T): ISerializedEditorInput | undefined;

  /**
   * 反序列化
   */
  deserialize(data: unknown): T | undefined;
}

/**
 * 编辑器输入工厂
 */
export class EditorInputFactory {
  private static readonly serializers = new Map<
    string,
    IEditorInputSerializer
  >();

  /**
   * 注册序列化器
   */
  static registerSerializer<T extends EditorInput>(
    typeId: string,
    serializer: IEditorInputSerializer<T>,
  ): void {
    this.serializers.set(typeId, serializer as IEditorInputSerializer);
  }

  /**
   * 反序列化
   */
  static deserialize(
    serialized: ISerializedEditorInput,
  ): EditorInput | undefined {
    const serializer = this.serializers.get(serialized.typeId);
    if (serializer) {
      return serializer.deserialize(serialized.data);
    }

    // 内置类型
    switch (serialized.typeId) {
      case FileEditorInput.TYPE_ID:
        return FileEditorInput.deserialize(serialized.data);
      case UntitledEditorInput.TYPE_ID:
        return UntitledEditorInput.deserialize(serialized.data);
      default:
        console.warn(`Unknown editor input type: ${serialized.typeId}`);
        return undefined;
    }
  }
}
