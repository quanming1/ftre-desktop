/**
 * editorGroup.ts — 编辑器组
 *
 * 参考 VSCode: vs/workbench/browser/parts/editor/editorGroupView.ts
 *
 * 编辑器组管理一组编辑器标签：
 * - 编辑器列表（打开的文件）
 * - 活动编辑器
 * - 标签栏状态
 * - 编辑器的打开/关闭/切换
 */

import type { IDisposable } from "monaco-editor";
import type * as monaco from "monaco-editor";
import { EditorInput } from "./editorInput";
import {
  EditorPanes,
  type IEditorPaneFactory,
  type IOpenEditorResult,
} from "./editorPanes";
import type {
  IEditorGroup,
  IEditorCloseEvent,
  IEditorOpenContext,
  IEditorOptions,
  IDimension,
} from "./editorPane";
import { EditorCloseReason } from "./editorPane";

// ═══════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 编辑器组方向
 */
export const enum GroupDirection {
  UP = 0,
  DOWN = 1,
  LEFT = 2,
  RIGHT = 3,
}

/**
 * 编辑器组位置
 */
export const enum GroupLocation {
  FIRST = 0,
  LAST = 1,
  NEXT = 2,
  PREVIOUS = 3,
}

/**
 * 移动编辑器选项
 */
export interface IMoveEditorOptions {
  /** 目标索引 */
  index?: number;
  /** 是否保持固定状态 */
  preserveFocus?: boolean;
}

/**
 * 复制编辑器选项
 */
export interface ICopyEditorOptions extends IMoveEditorOptions {
  /** 是否保持固定状态 */
  keepCopy?: boolean;
}

/**
 * 编辑器组变化事件
 */
export interface IEditorGroupChangeEvent {
  /** 变化类型 */
  readonly kind: GroupChangeKind;
  /** 相关编辑器 */
  readonly editor?: EditorInput;
}

/**
 * 组变化类型
 */
export const enum GroupChangeKind {
  GROUP_ACTIVE = 0,
  GROUP_INDEX = 1,
  GROUP_LOCKED = 2,
  EDITOR_OPEN = 3,
  EDITOR_CLOSE = 4,
  EDITOR_MOVE = 5,
  EDITOR_ACTIVE = 6,
  EDITOR_LABEL = 7,
  EDITOR_CAPABILITIES = 8,
  EDITOR_PIN = 9,
  EDITOR_STICKY = 10,
  EDITOR_DIRTY = 11,
}

/**
 * 事件发射器
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

// ═══════════════════════════════════════════════════════════════════════════
// EditorGroupModel - 编辑器组数据模型
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 编辑器组数据模型
 *
 * 管理编辑器列表、活动编辑器、固定状态等
 */
export class EditorGroupModel {
  /** 编辑器列表 */
  private _editors: EditorInput[] = [];

  /** 活动编辑器索引 */
  private _activeEditorIndex: number = -1;

  /** 固定编辑器数量（前 N 个是固定的） */
  private _stickyCount: number = 0;

  /** 预览编辑器（未固定，单个） */
  private _preview: EditorInput | undefined;

  // ── 事件 ──
  private readonly _onDidChange = new Emitter<IEditorGroupChangeEvent>();
  readonly onDidChange = this._onDidChange.event;

  /**
   * 获取所有编辑器
   */
  get editors(): readonly EditorInput[] {
    return this._editors;
  }

  /**
   * 获取编辑器数量
   */
  get count(): number {
    return this._editors.length;
  }

  /**
   * 获取活动编辑器
   */
  get activeEditor(): EditorInput | undefined {
    return this._editors[this._activeEditorIndex];
  }

  /**
   * 获取活动编辑器索引
   */
  get activeEditorIndex(): number {
    return this._activeEditorIndex;
  }

  /**
   * 获取预览编辑器
   */
  get previewEditor(): EditorInput | undefined {
    return this._preview;
  }

  /**
   * 获取固定编辑器数量
   */
  get stickyCount(): number {
    return this._stickyCount;
  }

  /**
   * 检查编辑器是否固定
   */
  isSticky(editorOrIndex: EditorInput | number): boolean {
    const index =
      typeof editorOrIndex === "number"
        ? editorOrIndex
        : this._editors.indexOf(editorOrIndex);
    return index >= 0 && index < this._stickyCount;
  }

  /**
   * 检查编辑器是否为预览
   */
  isPreview(editor: EditorInput): boolean {
    return this._preview === editor;
  }

  /**
   * 检查编辑器是否已打开
   */
  contains(editor: EditorInput): boolean {
    return this._editors.some((e) => e.matches(editor));
  }

  /**
   * 获取编辑器索引
   */
  indexOf(editor: EditorInput): number {
    return this._editors.findIndex((e) => e.matches(editor));
  }

  /**
   * 获取指定索引的编辑器
   */
  getEditorByIndex(index: number): EditorInput | undefined {
    return this._editors[index];
  }

  /**
   * 打开编辑器
   */
  openEditor(
    editor: EditorInput,
    options?: IEditorOptions
  ): { editor: EditorInput; isNew: boolean } {
    const existingIndex = this.indexOf(editor);

    if (existingIndex !== -1) {
      // 已存在，激活它
      const existing = this._editors[existingIndex];

      // 如果是预览编辑器且需要固定，则固定它
      if (this._preview === existing && options?.pinned) {
        this._preview = undefined;
        this._fireChange(GroupChangeKind.EDITOR_PIN, existing);
      }

      // 设为活动编辑器
      if (this._activeEditorIndex !== existingIndex) {
        this._activeEditorIndex = existingIndex;
        this._fireChange(GroupChangeKind.EDITOR_ACTIVE, existing);
      }

      return { editor: existing, isNew: false };
    }

    // 新编辑器
    let insertIndex: number;

    if (options?.sticky) {
      // 固定编辑器插入到固定区域末尾
      insertIndex = this._stickyCount;
      this._stickyCount++;
    } else if (options?.pinned === false || !options?.pinned) {
      // 预览编辑器：替换现有预览
      if (this._preview) {
        const previewIndex = this._editors.indexOf(this._preview);
        if (previewIndex !== -1) {
          this._editors.splice(previewIndex, 1);
          if (this._activeEditorIndex >= previewIndex) {
            this._activeEditorIndex--;
          }
        }
      }
      this._preview = editor;
      insertIndex = this._editors.length;
    } else {
      // 普通固定编辑器
      insertIndex = this._editors.length;
    }

    // 插入编辑器
    this._editors.splice(insertIndex, 0, editor);

    // 设为活动编辑器
    if (!options?.inactive) {
      this._activeEditorIndex = insertIndex;
    } else if (this._activeEditorIndex >= insertIndex) {
      this._activeEditorIndex++;
    }

    this._fireChange(GroupChangeKind.EDITOR_OPEN, editor);

    if (!options?.inactive) {
      this._fireChange(GroupChangeKind.EDITOR_ACTIVE, editor);
    }

    return { editor, isNew: true };
  }

  /**
   * 关闭编辑器
   */
  closeEditor(editor: EditorInput): EditorInput | undefined {
    const index = this.indexOf(editor);
    if (index === -1) {
      return undefined;
    }

    const closing = this._editors[index];

    // 从列表中移除
    this._editors.splice(index, 1);

    // 更新固定计数
    if (index < this._stickyCount) {
      this._stickyCount--;
    }

    // 清除预览引用
    if (this._preview === closing) {
      this._preview = undefined;
    }

    // 更新活动编辑器索引
    if (this._activeEditorIndex === index) {
      // 关闭的是活动编辑器，选择新的活动编辑器
      if (this._editors.length === 0) {
        this._activeEditorIndex = -1;
      } else if (index >= this._editors.length) {
        this._activeEditorIndex = this._editors.length - 1;
      }
      // 否则保持索引不变（下一个编辑器自动成为活动）

      const newActive = this._editors[this._activeEditorIndex];
      if (newActive) {
        this._fireChange(GroupChangeKind.EDITOR_ACTIVE, newActive);
      }
    } else if (this._activeEditorIndex > index) {
      this._activeEditorIndex--;
    }

    this._fireChange(GroupChangeKind.EDITOR_CLOSE, closing);

    return closing;
  }

  /**
   * 移动编辑器
   */
  moveEditor(editor: EditorInput, toIndex: number): void {
    const fromIndex = this.indexOf(editor);
    if (fromIndex === -1 || fromIndex === toIndex) {
      return;
    }

    // 边界检查
    toIndex = Math.max(0, Math.min(toIndex, this._editors.length - 1));

    // 移动
    const [removed] = this._editors.splice(fromIndex, 1);
    this._editors.splice(toIndex, 0, removed);

    // 更新活动编辑器索引
    if (this._activeEditorIndex === fromIndex) {
      this._activeEditorIndex = toIndex;
    } else if (fromIndex < this._activeEditorIndex && toIndex >= this._activeEditorIndex) {
      this._activeEditorIndex--;
    } else if (fromIndex > this._activeEditorIndex && toIndex <= this._activeEditorIndex) {
      this._activeEditorIndex++;
    }

    // 更新固定计数
    // （简化处理：如果移动跨越了固定边界，需要调整）
    if (fromIndex < this._stickyCount && toIndex >= this._stickyCount) {
      this._stickyCount--;
    } else if (fromIndex >= this._stickyCount && toIndex < this._stickyCount) {
      this._stickyCount++;
    }

    this._fireChange(GroupChangeKind.EDITOR_MOVE, editor);
  }

  /**
   * 固定编辑器
   */
  pinEditor(editor: EditorInput): void {
    if (this._preview === editor) {
      this._preview = undefined;
      this._fireChange(GroupChangeKind.EDITOR_PIN, editor);
    }
  }

  /**
   * 设置活动编辑器
   */
  setActive(editor: EditorInput): void {
    const index = this.indexOf(editor);
    if (index !== -1 && this._activeEditorIndex !== index) {
      this._activeEditorIndex = index;
      this._fireChange(GroupChangeKind.EDITOR_ACTIVE, editor);
    }
  }

  /**
   * 触发变化事件
   */
  private _fireChange(kind: GroupChangeKind, editor?: EditorInput): void {
    this._onDidChange.fire({ kind, editor });
  }

  /**
   * 销毁
   */
  dispose(): void {
    this._onDidChange.dispose();
    this._editors = [];
    this._activeEditorIndex = -1;
    this._preview = undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EditorGroup - 编辑器组
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 编辑器组
 *
 * 管理一组编辑器及其视图
 */
export class EditorGroup implements IEditorGroup, IDisposable {
  /** 组 ID */
  readonly id: number;

  /** 数据模型 */
  private readonly _model: EditorGroupModel;

  /** 编辑器面板管理器 */
  private readonly _editorPanes: EditorPanes;

  /** 容器元素 */
  private _container: HTMLElement | undefined;

  /** 当前尺寸 */
  private _dimension: IDimension | undefined;

  /** 是否已释放 */
  private _disposed = false;

  // ── 事件 ──
  private readonly _onWillCloseEditor = new Emitter<IEditorCloseEvent>();
  private readonly _onDidCloseEditor = new Emitter<IEditorCloseEvent>();
  private readonly _onDidChangeActiveEditor = new Emitter<EditorInput | undefined>();
  private readonly _onDidChange = new Emitter<IEditorGroupChangeEvent>();

  constructor(
    id: number,
    private readonly _factory: IEditorPaneFactory
  ) {
    this.id = id;
    this._model = new EditorGroupModel();
    this._editorPanes = new EditorPanes(this, this._factory);

    // 监听模型变化
    this._model.onDidChange((e) => {
      this._onDidChange.fire(e);

      if (e.kind === GroupChangeKind.EDITOR_ACTIVE) {
        this._onDidChangeActiveEditor.fire(e.editor);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IEditorGroup 实现
  // ═══════════════════════════════════════════════════════════════════════════

  get label(): string {
    return `Group ${this.id}`;
  }

  get activeEditor(): EditorInput | undefined {
    return this._model.activeEditor;
  }

  onWillCloseEditor(listener: (e: IEditorCloseEvent) => void): IDisposable {
    return this._onWillCloseEditor.event(listener);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 公共 API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 获取所有编辑器
   */
  get editors(): readonly EditorInput[] {
    return this._model.editors;
  }

  /**
   * 获取编辑器数量
   */
  get count(): number {
    return this._model.count;
  }

  /**
   * 获取预览编辑器
   */
  get previewEditor(): EditorInput | undefined {
    return this._model.previewEditor;
  }

  /**
   * 活动编辑器变化事件
   */
  get onDidChangeActiveEditor() {
    return this._onDidChangeActiveEditor.event;
  }

  /**
   * 编辑器关闭后事件
   */
  get onDidCloseEditor() {
    return this._onDidCloseEditor.event;
  }

  /**
   * 组变化事件
   */
  get onDidChange() {
    return this._onDidChange.event;
  }

  /**
   * 创建组视图
   */
  create(parent: HTMLElement): HTMLElement {
    this._container = document.createElement("div");
    this._container.className = "editor-group";
    this._container.style.cssText = `
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;

    // 创建编辑器面板容器
    const paneContainer = document.createElement("div");
    paneContainer.className = "editor-pane-container";
    paneContainer.style.cssText = `
      flex: 1;
      position: relative;
      overflow: hidden;
    `;
    this._container.appendChild(paneContainer);

    // 初始化 EditorPanes
    this._editorPanes.create(paneContainer);

    parent.appendChild(this._container);

    return this._container;
  }

  /**
   * 打开编辑器
   */
  async openEditor(
    input: EditorInput,
    options?: IEditorOptions
  ): Promise<IOpenEditorResult> {
    if (this._disposed) {
      return { error: new Error("EditorGroup has been disposed") };
    }

    // 更新模型
    const { editor, isNew } = this._model.openEditor(input, options);

    // 打开编辑器面板
    const context: IEditorOpenContext = {
      newInGroup: isNew,
      restored: false,
    };

    const result = await this._editorPanes.openEditor(editor, options, context);

    return result;
  }

  /**
   * 关闭编辑器
   *
   * 参考 VSCode: editorGroupView.ts handleOnDidCloseEditor
   */
  async closeEditor(input: EditorInput): Promise<void> {
    if (this._disposed) {
      return;
    }

    const editor = this._model.editors.find((e) => e.matches(input));
    if (!editor) {
      return;
    }

    // 触发关闭前事件
    const closeEvent: IEditorCloseEvent = {
      editor,
      groupId: this.id,
      reason: EditorCloseReason.Unknown,
    };
    this._onWillCloseEditor.fire(closeEvent);

    // 从模型中移除
    this._model.closeEditor(editor);

    // 如果还有编辑器，打开新的活动编辑器
    const newActive = this._model.activeEditor;
    if (newActive) {
      await this._editorPanes.openEditor(newActive, undefined, {
        newInGroup: false,
      });
    } else {
      // 没有编辑器了，关闭活动面板
      this._editorPanes.closeActiveEditor();
    }

    // 触发关闭后事件
    this._onDidCloseEditor.fire(closeEvent);

    // Dispose EditorInput（释放资源，触发 onWillDispose 清理 ViewState）
    // 参考 VSCode: 在 handleOnDidCloseEditor 中检查 canDispose 后调用 editor.dispose()
    // 简化实现：直接 dispose，因为我们目前每个 EditorInput 只在一个 group 中使用
    editor.dispose();
  }

  /**
   * 关闭所有编辑器
   */
  async closeAllEditors(): Promise<void> {
    const editors = [...this._model.editors];
    for (const editor of editors) {
      await this.closeEditor(editor);
    }
  }

  /**
   * 移动编辑器到另一个组
   */
  moveEditor(
    input: EditorInput,
    targetGroup: EditorGroup,
    options?: IMoveEditorOptions
  ): void {
    const editor = this._model.editors.find((e) => e.matches(input));
    if (!editor) {
      return;
    }

    // 从当前组关闭
    this._model.closeEditor(editor);

    // 在目标组打开
    targetGroup.openEditor(editor, {
      pinned: true,
      inactive: options?.preserveFocus,
    });
  }

  /**
   * 复制编辑器到另一个组
   */
  copyEditor(
    input: EditorInput,
    targetGroup: EditorGroup,
    options?: ICopyEditorOptions
  ): void {
    const editor = this._model.editors.find((e) => e.matches(input));
    if (!editor) {
      return;
    }

    // 在目标组打开（不从当前组移除）
    targetGroup.openEditor(editor, {
      pinned: true,
      inactive: options?.preserveFocus,
    });
  }

  /**
   * 固定编辑器
   */
  pinEditor(input: EditorInput): void {
    const editor = this._model.editors.find((e) => e.matches(input));
    if (editor) {
      this._model.pinEditor(editor);
    }
  }

  /**
   * 设置活动编辑器
   */
  async setActive(input: EditorInput): Promise<void> {
    const editor = this._model.editors.find((e) => e.matches(input));
    if (!editor) {
      return;
    }

    this._model.setActive(editor);

    await this._editorPanes.openEditor(editor, undefined, {
      newInGroup: false,
    });
  }

  /**
   * 检查编辑器是否在组中
   */
  contains(input: EditorInput): boolean {
    return this._model.contains(input);
  }

  /**
   * 获取编辑器索引
   */
  indexOf(input: EditorInput): number {
    return this._model.indexOf(input);
  }

  /**
   * 布局
   */
  layout(dimension: IDimension): void {
    this._dimension = dimension;

    if (this._container) {
      this._container.style.width = `${dimension.width}px`;
      this._container.style.height = `${dimension.height}px`;
    }

    this._editorPanes.layout(dimension);
  }

  /**
   * 获取焦点
   */
  focus(): void {
    this._editorPanes.focus();
  }

  /**
   * 保存状态
   */
  saveState(): void {
    this._editorPanes.saveState();
  }

  /**
   * 销毁
   */
  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;

    this._onWillCloseEditor.dispose();
    this._onDidCloseEditor.dispose();
    this._onDidChangeActiveEditor.dispose();
    this._onDidChange.dispose();

    this._model.dispose();
    this._editorPanes.dispose();

    if (this._container && this._container.parentElement) {
      this._container.parentElement.removeChild(this._container);
    }
    this._container = undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 工厂函数
// ═══════════════════════════════════════════════════════════════════════════

let _groupIdCounter = 0;

/**
 * 生成唯一的组 ID
 */
export function generateGroupId(): number {
  return ++_groupIdCounter;
}

/**
 * 重置组 ID 计数器（仅用于测试）
 */
export function _resetGroupIdCounter(): void {
  _groupIdCounter = 0;
}

/**
 * 创建编辑器组
 */
export function createEditorGroup(factory: IEditorPaneFactory): EditorGroup {
  return new EditorGroup(generateGroupId(), factory);
}
