/**
 * settingsEditorPane.ts — 设置编辑器面板
 *
 * 参考 VSCode 的 SettingsEditor2
 * 管理 Settings UI 的生命周期，支持 React 组件集成
 */

import {
  EditorPane,
  type IEditorGroup,
  type IEditorOpenContext,
  type IEditorOptions,
  type IDimension,
  type IEditorPaneDescriptor,
} from "./editorPane";
import type { EditorInput } from "./editorInput";
import { SettingsEditorInput } from "./settingsEditorInput";

/**
 * 渲染回调类型
 */
export type SettingsRenderCallback = (container: HTMLElement) => void;

/**
 * 卸载回调类型
 */
export type SettingsUnmountCallback = () => void;

/**
 * SettingsEditorPane — 设置编辑器面板
 *
 * 核心职责：
 * 1. 提供 DOM 容器给 React 渲染
 * 2. 通过 setVisible 控制显示/隐藏（不销毁组件）
 * 3. 在 dispose 时通知 React 卸载
 */
export class SettingsEditorPane extends EditorPane {
  static readonly ID = "workbench.editors.settingsEditor";

  private _renderCallback: SettingsRenderCallback | null = null;
  private _unmountCallback: SettingsUnmountCallback | null = null;
  private _contentContainer: HTMLElement | null = null;
  private _rendered = false;

  constructor(group: IEditorGroup) {
    super(SettingsEditorPane.ID, group);
  }

  /**
   * 设置渲染回调（由 React 层提供）
   */
  setRenderCallback(
    render: SettingsRenderCallback,
    unmount: SettingsUnmountCallback,
  ): void {
    this._renderCallback = render;
    this._unmountCallback = unmount;
  }

  /**
   * 创建编辑器 UI
   */
  protected createEditor(parent: HTMLElement): void {
    this._contentContainer = document.createElement("div");
    this._contentContainer.className = "settings-editor-content";
    this._contentContainer.style.cssText =
      "width: 100%; height: 100%; overflow: hidden;";
    parent.appendChild(this._contentContainer);
  }

  /**
   * 设置输入
   */
  async setInput(
    input: EditorInput,
    options: IEditorOptions | undefined,
    context: IEditorOpenContext,
  ): Promise<void> {
    this._input = input;
    this._options = options;

    // 首次设置输入时渲染 React 组件
    if (!this._rendered && this._contentContainer && this._renderCallback) {
      this._renderCallback(this._contentContainer);
      this._rendered = true;
    }
  }

  /**
   * 可见性变化
   */
  protected override setEditorVisible(visible: boolean): void {
    super.setEditorVisible(visible);

    // 可见时确保已渲染
    if (
      visible &&
      !this._rendered &&
      this._contentContainer &&
      this._renderCallback
    ) {
      this._renderCallback(this._contentContainer);
      this._rendered = true;
    }
  }

  /**
   * 布局
   */
  override layout(dimension: IDimension): void {
    // Settings 面板自适应，无需额外布局逻辑
    if (this._contentContainer) {
      this._contentContainer.style.width = `${dimension.width}px`;
      this._contentContainer.style.height = `${dimension.height}px`;
    }
  }

  /**
   * 获取焦点
   */
  override focus(): void {
    // Settings 面板可以聚焦搜索框
    // 由 React 组件内部处理
  }

  /**
   * 释放资源
   */
  override dispose(): void {
    // 通知 React 卸载
    if (this._unmountCallback) {
      this._unmountCallback();
      this._unmountCallback = null;
    }
    this._renderCallback = null;
    this._contentContainer = null;
    this._rendered = false;
    super.dispose();
  }
}

/**
 * SettingsEditorPane 描述符
 */
export const settingsEditorPaneDescriptor: IEditorPaneDescriptor = {
  typeId: SettingsEditorPane.ID,
  name: "Settings Editor",

  describes(editorPane: EditorPane): boolean {
    return editorPane.id === SettingsEditorPane.ID;
  },

  canHandle(input: EditorInput): boolean {
    return input.typeId === SettingsEditorInput.TYPE_ID;
  },
};
