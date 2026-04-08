/**
 * editorPanes.ts — 编辑器面板管理器（复用池）
 *
 * 参考 VSCode 的 vs/workbench/browser/parts/editor/editorPanes.ts
 * 管理 EditorPane 实例池，支持复用已创建的面板
 */

import type { IDisposable } from "monaco-editor";
import type { EditorInput } from "./editorInput";
import type {
  EditorPane,
  IEditorPaneDescriptor,
  IEditorGroup,
  IEditorOptions,
  IEditorOpenContext,
  IDimension,
} from "./editorPane";

// ══════════════════════════════════════════════════
//  类型定义
// ══════════════════════════════════════════════════

/**
 * 打开编辑器的结果
 */
export interface IOpenEditorResult {
  /**
   * 编辑器面板（成功时）
   */
  pane?: EditorPane;

  /**
   * 错误（失败时）
   */
  error?: Error;

  /**
   * 输入是否改变
   */
  changed?: boolean;

  /**
   * 是否取消
   */
  cancelled?: boolean;
}

/**
 * 编辑器面板工厂
 */
export interface IEditorPaneFactory {
  /**
   * 获取可以处理输入的描述符
   */
  getDescriptor(input: EditorInput): IEditorPaneDescriptor | undefined;

  /**
   * 创建编辑器面板
   */
  createEditorPane(
    descriptor: IEditorPaneDescriptor,
    group: IEditorGroup,
  ): EditorPane;
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
//  EditorPanes 实现
// ══════════════════════════════════════════════════

/**
 * EditorPanes — 编辑器面板管理器
 *
 * 核心职责：
 * 1. 管理 EditorPane 实例池，支持复用
 * 2. 处理编辑器打开、关闭、切换
 * 3. 协调 EditorPane 的生命周期
 *
 * 复用策略（参考 VSCode）：
 * - 如果当前活动面板可以处理新输入，直接复用
 * - 否则在池中查找可复用的面板
 * - 找不到则创建新面板
 */
export class EditorPanes implements IDisposable {
  /**
   * 编辑器面板池
   */
  private readonly _editorPanes: EditorPane[] = [];

  /**
   * 当前活动的编辑器面板
   */
  private _activeEditorPane: EditorPane | undefined;

  /**
   * 待处理的 setInput 调用（用于避免竞争）
   */
  private readonly _pendingSetInput = new Map<EditorPane, Promise<void>>();

  /**
   * 容器元素
   */
  private _container: HTMLElement | undefined;

  /**
   * 当前尺寸
   */
  private _dimension: IDimension | undefined;

  /**
   * 是否已释放
   */
  private _disposed = false;

  // ── 事件 ──

  private readonly _onDidFocus = new Emitter<void>();
  readonly onDidFocus = this._onDidFocus.event;

  private readonly _onDidChangeActiveEditorPane = new Emitter<
    EditorPane | undefined
  >();
  readonly onDidChangeActiveEditorPane =
    this._onDidChangeActiveEditorPane.event;

  constructor(
    private readonly _group: IEditorGroup,
    private readonly _factory: IEditorPaneFactory,
  ) {}

  // ══════════════════════════════════════════════════
  //  Getter
  // ══════════════════════════════════════════════════

  /**
   * 获取活动编辑器面板
   */
  get activeEditorPane(): EditorPane | undefined {
    return this._activeEditorPane;
  }

  /**
   * 获取所有编辑器面板数量
   */
  get count(): number {
    return this._editorPanes.length;
  }

  // ══════════════════════════════════════════════════
  //  创建和初始化
  // ══════════════════════════════════════════════════

  /**
   * 创建容器
   */
  create(parent: HTMLElement): HTMLElement {
    this._container = document.createElement("div");
    this._container.className = "editor-panes-container";
    this._container.style.cssText = `
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
    `;
    parent.appendChild(this._container);
    return this._container;
  }

  // ══════════════════════════════════════════════════
  //  打开编辑器
  // ══════════════════════════════════════════════════

  /**
   * 打开编辑器
   *
   * 核心流程（参考 VSCode）：
   * 1. 获取可以处理输入的描述符
   * 2. 显示编辑器面板（复用或创建）
   * 3. 设置输入
   */
  async openEditor(
    input: EditorInput,
    options: IEditorOptions | undefined,
    context: IEditorOpenContext = {},
  ): Promise<IOpenEditorResult> {
    if (this._disposed) {
      return { error: new Error("EditorPanes has been disposed") };
    }

    try {
      // 1. 获取描述符
      const descriptor = this._factory.getDescriptor(input);
      if (!descriptor) {
        return {
          error: new Error(
            `No editor pane descriptor found for input: ${input.typeId}`,
          ),
        };
      }

      // 2. 显示编辑器面板
      const pane = this._doShowEditorPane(descriptor);
      if (!pane) {
        return { error: new Error("Failed to create editor pane") };
      }

      // 3. 设置输入
      const result = await this._doSetInput(pane, input, options, context);

      return {
        pane,
        changed: result.changed,
        cancelled: result.cancelled,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * 显示编辑器面板
   *
   * 复用逻辑（参考 VSCode）：
   * 1. 如果当前活动面板可以处理，直接使用
   * 2. 否则在池中查找可复用的面板
   * 3. 找不到则创建新面板
   */
  private _doShowEditorPane(
    descriptor: IEditorPaneDescriptor,
  ): EditorPane | undefined {
    // 检查当前活动面板是否可复用
    if (
      this._activeEditorPane &&
      descriptor.describes(this._activeEditorPane)
    ) {
      return this._activeEditorPane;
    }

    // 在池中查找可复用的面板
    let pane = this._editorPanes.find((p) => descriptor.describes(p));

    // 如果找不到，创建新面板
    if (!pane) {
      pane = this._createEditorPane(descriptor);
      if (!pane) {
        return undefined;
      }
    }

    // 切换到新面板
    this._doSetActiveEditorPane(pane);

    return pane;
  }

  /**
   * 创建编辑器面板
   */
  private _createEditorPane(
    descriptor: IEditorPaneDescriptor,
  ): EditorPane | undefined {
    if (!this._container) {
      return undefined;
    }

    // 获取容器尺寸（用于设置面板初始尺寸）
    const containerRect = this._container.getBoundingClientRect();
    const width = this._dimension?.width ?? containerRect.width;
    const height = this._dimension?.height ?? containerRect.height;

    // 创建面板容器
    // 注意：使用具体尺寸而不是 100%，因为 Monaco 在 display:none 时需要知道尺寸
    const paneContainer = document.createElement("div");
    paneContainer.className = "editor-pane";
    paneContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: ${width}px;
      height: ${height}px;
      display: none;
    `;
    this._container.appendChild(paneContainer);

    // 创建面板实例
    const pane = this._factory.createEditorPane(descriptor, this._group);
    pane.create(paneContainer);

    // 立即布局面板（确保 Monaco 使用正确的尺寸）
    if (width > 0 && height > 0) {
      pane.layout({ width, height });
    }

    // 添加到池中
    this._editorPanes.push(pane);

    return pane;
  }

  /**
   * 设置活动编辑器面板
   */
  private _doSetActiveEditorPane(pane: EditorPane): void {
    if (this._activeEditorPane === pane) {
      return;
    }

    // 隐藏当前活动面板
    if (this._activeEditorPane) {
      this._activeEditorPane.setVisible(false);
      const container = this._activeEditorPane.container;
      if (container) {
        container.style.display = "none";
      }
    }

    // 显示新面板
    this._activeEditorPane = pane;
    pane.setVisible(true);
    const container = pane.container;
    if (container) {
      container.style.display = "block";
    }

    // 应用布局
    if (
      this._dimension &&
      this._dimension.width > 0 &&
      this._dimension.height > 0
    ) {
      pane.layout(this._dimension);
    } else if (this._container) {
      // 后备：如果 dimension 无效，尝试从容器获取尺寸
      const rect = this._container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this._dimension = { width: rect.width, height: rect.height };
        pane.layout(this._dimension);
      } else {
        // 延迟布局作为最后手段
        requestAnimationFrame(() => {
          if (this._container && this._activeEditorPane === pane) {
            const delayedRect = this._container.getBoundingClientRect();
            if (delayedRect.width > 0 && delayedRect.height > 0) {
              this._dimension = {
                width: delayedRect.width,
                height: delayedRect.height,
              };
              pane.layout(this._dimension);
            }
          }
        });
      }
    }

    // 触发事件
    this._onDidChangeActiveEditorPane.fire(pane);
  }

  /**
   * 设置编辑器输入
   *
   * 关键逻辑（参考 VSCode）：
   * 1. 检查输入是否匹配（避免重复设置）
   * 2. 等待待处理的 setInput 完成
   * 3. 清除旧输入（保存 ViewState）
   * 4. 设置新输入
   */
  private async _doSetInput(
    pane: EditorPane,
    input: EditorInput,
    options: IEditorOptions | undefined,
    context: IEditorOpenContext,
  ): Promise<{ changed: boolean; cancelled: boolean }> {
    // 检查输入是否匹配
    let inputMatches = pane.input?.matches(input);

    if (inputMatches && !options?.forceReload) {
      // 等待待处理的 setInput 完成
      if (this._pendingSetInput.has(pane)) {
        await this._pendingSetInput.get(pane);
      }

      // 再次检查（可能已经变化）
      inputMatches = pane.input?.matches(input);
      if (inputMatches) {
        // 只应用选项
        pane.setOptions(options);
        return { changed: false, cancelled: false };
      }
    }

    // 清除旧输入（这里会保存 ViewState）
    pane.clearInput();

    // 设置新输入
    const setInputPromise = pane.setInput(input, options, context);
    this._pendingSetInput.set(pane, setInputPromise);

    try {
      await setInputPromise;
      return { changed: true, cancelled: false };
    } finally {
      this._pendingSetInput.delete(pane);
    }
  }

  // ══════════════════════════════════════════════════
  //  关闭编辑器
  // ══════════════════════════════════════════════════

  /**
   * 关闭活动编辑器
   */
  closeActiveEditor(): void {
    if (this._activeEditorPane) {
      this._activeEditorPane.clearInput();
    }
  }

  // ══════════════════════════════════════════════════
  //  布局
  // ══════════════════════════════════════════════════

  /**
   * 布局
   */
  layout(dimension: IDimension): void {
    this._dimension = dimension;

    if (this._container) {
      this._container.style.width = `${dimension.width}px`;
      this._container.style.height = `${dimension.height}px`;
    }

    // 更新所有面板容器尺寸
    for (const pane of this._editorPanes) {
      const container = pane.container;
      if (container) {
        container.style.width = `${dimension.width}px`;
        container.style.height = `${dimension.height}px`;
      }
    }

    // 只布局活动面板（实际调用 Monaco layout）
    if (this._activeEditorPane) {
      this._activeEditorPane.layout(dimension);
    }
  }

  // ══════════════════════════════════════════════════
  //  焦点
  // ══════════════════════════════════════════════════

  /**
   * 获取焦点
   */
  focus(): void {
    if (this._activeEditorPane) {
      this._activeEditorPane.focus();
      this._onDidFocus.fire();
    }
  }

  /**
   * 是否有焦点
   */
  hasFocus(): boolean {
    return this._activeEditorPane?.hasFocus() ?? false;
  }

  // ══════════════════════════════════════════════════
  //  状态
  // ══════════════════════════════════════════════════

  /**
   * 保存所有面板的状态
   */
  saveState(): void {
    for (const pane of this._editorPanes) {
      // 触发 clearInput 以保存 ViewState
      if (pane === this._activeEditorPane && pane.input) {
        // 活动面板需要特殊处理
        // 这里我们不清除输入，而是让面板自己保存状态
      }
    }
  }

  // ══════════════════════════════════════════════════
  //  生命周期
  // ══════════════════════════════════════════════════

  /**
   * 释放资源
   */
  dispose(): void {
    if (this._disposed) {
      return;
    }

    this._disposed = true;

    // 清除待处理的 setInput
    this._pendingSetInput.clear();

    // 释放所有面板
    for (const pane of this._editorPanes) {
      pane.dispose();
    }
    this._editorPanes.length = 0;

    // 清除活动面板
    this._activeEditorPane = undefined;

    // 移除容器
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._container = undefined;

    // 释放事件
    this._onDidFocus.dispose();
    this._onDidChangeActiveEditorPane.dispose();
  }
}
