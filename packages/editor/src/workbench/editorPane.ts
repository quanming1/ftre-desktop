/**
 * editorPane.ts — 编辑器面板基类
 *
 * 参考 VSCode 的 vs/workbench/browser/parts/editor/editorPane.ts
 * EditorPane 是编辑器的视图容器，负责管理编辑器的生命周期
 */

import type { IDisposable } from "monaco-editor";
import type { EditorInput } from "./editorInput";
import type { IEditorMemento } from "./editorMemento";
import { getEditorMemento } from "./editorMemento";

// ══════════════════════════════════════════════════
//  类型定义
// ══════════════════════════════════════════════════

/**
 * 编辑器组接口（简化版）
 */
export interface IEditorGroup {
  /**
   * 组 ID
   */
  readonly id: number;

  /**
   * 组标签
   */
  readonly label: string;

  /**
   * 获取活动编辑器
   */
  readonly activeEditor: EditorInput | undefined;

  /**
   * 编辑器即将关闭事件
   */
  onWillCloseEditor: (listener: (e: IEditorCloseEvent) => void) => IDisposable;
}

/**
 * 编辑器关闭事件
 */
export interface IEditorCloseEvent {
  /**
   * 被关闭的编辑器
   */
  readonly editor: EditorInput;

  /**
   * 组 ID
   */
  readonly groupId: number;

  /**
   * 关闭原因
   */
  readonly reason: EditorCloseReason;
}

/**
 * 编辑器关闭原因
 */
export const enum EditorCloseReason {
  Unknown = 0,
  Replace = 1,
  Move = 2,
  Unpin = 3,
}

/**
 * 编辑器打开上下文
 */
export interface IEditorOpenContext {
  /**
   * 是否为组内新编辑器
   */
  newInGroup?: boolean;

  /**
   * 是否从恢复中打开
   */
  restored?: boolean;
}

/**
 * 编辑器选项
 */
export interface IEditorOptions {
  /**
   * 是否固定
   */
  pinned?: boolean;

  /**
   * 是否粘滞
   */
  sticky?: boolean;

  /**
   * 是否临时
   */
  transient?: boolean;

  /**
   * 是否非活动
   */
  inactive?: boolean;

  /**
   * 强制重新加载
   */
  forceReload?: boolean;

  /**
   * 选区
   */
  selection?: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber?: number;
    endColumn?: number;
  };

  /**
   * 视图状态
   */
  viewState?: unknown;
}

/**
 * 尺寸
 */
export interface IDimension {
  width: number;
  height: number;
}

/**
 * Disposable 基类
 */
class Disposable implements IDisposable {
  private _disposed = false;
  protected readonly _disposables: IDisposable[] = [];

  protected _register<T extends IDisposable>(disposable: T): T {
    if (this._disposed) {
      console.warn("Registering disposable on disposed object");
      disposable.dispose();
    } else {
      this._disposables.push(disposable);
    }
    return disposable;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  dispose(): void {
    if (!this._disposed) {
      this._disposed = true;
      for (const d of this._disposables) {
        d.dispose();
      }
      this._disposables.length = 0;
    }
  }
}

// ══════════════════════════════════════════════════
//  EditorPane 基类
// ══════════════════════════════════════════════════

/**
 * EditorPane 基类
 *
 * 生命周期（参考 VSCode 注释）：
 * 1. createEditor() - 创建编辑器 UI
 * 2. setEditorVisible(true) - 编辑器变为可见
 * 3. layout() - 布局
 * 4. setInput() - 设置编辑器输入
 * 5. focus() - 获取焦点
 * 6. clearInput() - 清除输入
 * 7. setEditorVisible(false) - 隐藏
 * 8. dispose() - 销毁（仅在组关闭时）
 *
 * 注意：在工作台使用过程中，编辑器会频繁收到 clearInput()、setEditorVisible()、
 * layout() 和 focus() 调用，但只有一次 create() 和 dispose() 调用。
 */
export abstract class EditorPane<
  TViewState extends object = object,
> extends Disposable {
  /**
   * 面板 ID（类型标识）
   */
  readonly id: string;

  /**
   * 所属编辑器组
   */
  readonly group: IEditorGroup;

  /**
   * 当前输入
   */
  protected _input: EditorInput | undefined;

  /**
   * 当前选项
   */
  protected _options: IEditorOptions | undefined;

  /**
   * 容器元素
   */
  protected _container: HTMLElement | undefined;

  /**
   * 是否可见
   */
  private _visible = false;

  /**
   * 组关闭监听器
   */
  private _groupCloseListener: IDisposable | undefined;

  constructor(id: string, group: IEditorGroup) {
    super();
    this.id = id;
    this.group = group;
  }

  // ══════════════════════════════════════════════════
  //  抽象方法 - 子类必须实现
  // ══════════════════════════════════════════════════

  /**
   * 创建编辑器 UI
   * @param parent 父容器元素
   */
  protected abstract createEditor(parent: HTMLElement): void;

  /**
   * 设置编辑器输入
   * @param input 编辑器输入
   * @param options 编辑器选项
   * @param context 打开上下文
   */
  abstract setInput(
    input: EditorInput,
    options: IEditorOptions | undefined,
    context: IEditorOpenContext,
  ): Promise<void>;

  // ══════════════════════════════════════════════════
  //  Getter / Setter
  // ══════════════════════════════════════════════════

  /**
   * 获取当前输入
   */
  get input(): EditorInput | undefined {
    return this._input;
  }

  /**
   * 获取当前选项
   */
  get options(): IEditorOptions | undefined {
    return this._options;
  }

  /**
   * 是否可见
   */
  get visible(): boolean {
    return this._visible;
  }

  /**
   * 获取容器元素
   */
  get container(): HTMLElement | undefined {
    return this._container;
  }

  // ══════════════════════════════════════════════════
  //  生命周期方法
  // ══════════════════════════════════════════════════

  /**
   * 创建面板（由工作台调用）
   */
  create(parent: HTMLElement): void {
    this._container = parent;
    this.createEditor(parent);
  }

  /**
   * 清除输入
   *
   * 子类应在此保存 ViewState
   */
  clearInput(): void {
    this._input = undefined;
    this._options = undefined;
  }

  /**
   * 设置选项
   */
  setOptions(options: IEditorOptions | undefined): void {
    this._options = options;
  }

  /**
   * 设置可见性
   */
  setVisible(visible: boolean): void {
    if (this._visible !== visible) {
      this._visible = visible;
      this.setEditorVisible(visible);
    }
  }

  /**
   * 编辑器可见性变化回调
   *
   * 子类可重写以响应可见性变化
   */
  protected setEditorVisible(visible: boolean): void {
    if (visible) {
      // 监听组关闭事件，以便在关闭时保存 ViewState
      this._groupCloseListener?.dispose();
      this._groupCloseListener = this.group.onWillCloseEditor((e) => {
        if (e.editor === this._input) {
          this.onWillCloseEditor(e);
        }
      });
    } else {
      this._groupCloseListener?.dispose();
      this._groupCloseListener = undefined;
    }
  }

  /**
   * 编辑器即将关闭回调
   *
   * 子类可重写以保存 ViewState
   */
  protected onWillCloseEditor(_event: IEditorCloseEvent): void {
    // 子类实现
  }

  /**
   * 布局
   */
  layout(dimension: IDimension): void {
    // 子类实现
  }

  /**
   * 获取焦点
   */
  focus(): void {
    // 子类实现
  }

  /**
   * 是否有焦点
   */
  hasFocus(): boolean {
    return false;
  }

  // ══════════════════════════════════════════════════
  //  ViewState 管理
  // ══════════════════════════════════════════════════

  /**
   * 获取 EditorMemento
   */
  protected getEditorMemento<T>(
    key: string,
    limit: number = 100,
  ): IEditorMemento<T> {
    return getEditorMemento<T>(this.id, key, limit);
  }

  /**
   * 获取视图状态
   *
   * 子类应重写以返回当前视图状态
   */
  getViewState(): TViewState | undefined {
    return undefined;
  }

  // ══════════════════════════════════════════════════
  //  生命周期
  // ══════════════════════════════════════════════════

  /**
   * 保存状态（窗口关闭前调用）
   */
  protected saveState(): void {
    // 子类可重写以保存状态
  }

  /**
   * 释放资源
   */
  override dispose(): void {
    this._groupCloseListener?.dispose();
    this._input = undefined;
    this._options = undefined;
    super.dispose();
  }
}

// ══════════════════════════════════════════════════
//  EditorPaneDescriptor
// ══════════════════════════════════════════════════

/**
 * 编辑器面板描述符
 *
 * 用于注册和查找可以处理特定输入类型的 EditorPane
 */
export interface IEditorPaneDescriptor {
  /**
   * 面板类型 ID
   */
  readonly typeId: string;

  /**
   * 面板显示名称
   */
  readonly name: string;

  /**
   * 判断此描述符是否描述给定的面板
   */
  describes(editorPane: EditorPane): boolean;

  /**
   * 判断此描述符是否可以处理给定的输入
   */
  canHandle(input: EditorInput): boolean;
}

/**
 * 创建编辑器面板描述符
 */
export function createEditorPaneDescriptor(
  typeId: string,
  name: string,
  inputTypeIds: string[],
): IEditorPaneDescriptor {
  return {
    typeId,
    name,
    describes(editorPane: EditorPane): boolean {
      return editorPane.id === typeId;
    },
    canHandle(input: EditorInput): boolean {
      return inputTypeIds.includes(input.typeId);
    },
  };
}
