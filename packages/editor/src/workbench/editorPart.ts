/**
 * editorPart.ts — 编辑器部分
 *
 * 参考 VSCode: vs/workbench/browser/parts/editor/editorPart.ts
 *
 * 编辑器部分管理多个编辑器组的网格布局：
 * - 多个 EditorGroup
 * - 分屏/合并
 * - 布局序列化/反序列化
 * - 活动组管理
 */

import type { IDisposable } from "monaco-editor";
import type { EditorInput } from "./editorInput";
import type { IEditorPaneFactory } from "./editorPanes";
import type { IEditorOptions, IDimension } from "./editorPane";
import {
  EditorGroup,
  createEditorGroup,
  GroupDirection,
  GroupLocation,
  type IEditorGroupChangeEvent,
  GroupChangeKind,
} from "./editorGroup";

// ═══════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 分屏方向
 */
export const enum SplitDirection {
  HORIZONTAL = 0,
  VERTICAL = 1,
}

/**
 * 编辑器部分布局状态
 */
export interface IEditorPartLayoutState {
  /** 组布局 */
  groups: IEditorGroupLayoutState[];
  /** 活动组 ID */
  activeGroupId: number;
  /** 布局方向 */
  orientation: SplitDirection;
}

/**
 * 编辑器组布局状态
 */
export interface IEditorGroupLayoutState {
  /** 组 ID */
  id: number;
  /** 打开的编辑器 */
  editors: IEditorLayoutState[];
  /** 活动编辑器索引 */
  activeEditorIndex: number;
}

/**
 * 编辑器布局状态
 */
export interface IEditorLayoutState {
  /** 类型 ID */
  typeId: string;
  /** 资源路径 */
  resource?: string;
  /** 是否固定 */
  pinned: boolean;
  /** 是否粘滞 */
  sticky: boolean;
}

/**
 * 添加组选项
 */
export interface IAddGroupOptions {
  /** 是否激活新组 */
  activate?: boolean;
  /** 是否复制活动编辑器 */
  copyActiveEditor?: boolean;
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
// EditorPart - 编辑器部分
// ═══════════════════════════════════════════════════════════════════════════

/**

 * 编辑器部分
 *
 * 管理窗口内的编辑器组网格布局
 */
export class EditorPart implements IDisposable {
  /** 编辑器组映射 */
  private readonly _groups: Map<number, EditorGroup> = new Map();

  /** 组顺序（用于遍历） */
  private _groupOrder: number[] = [];

  /** 活动组 */
  private _activeGroup: EditorGroup | undefined;

  /** 容器元素 */
  private _container: HTMLElement | undefined;

  /** 组容器元素 */
  private _groupsContainer: HTMLElement | undefined;

  /** 当前尺寸 */
  private _dimension: IDimension | undefined;

  /** 当前布局方向 */
  private _orientation: SplitDirection = SplitDirection.HORIZONTAL;

  /** 是否已释放 */
  private _disposed = false;

  /** 事件清理 */
  private readonly _disposables: IDisposable[] = [];

  // ── 事件 ──
  private readonly _onDidAddGroup = new Emitter<EditorGroup>();
  private readonly _onDidRemoveGroup = new Emitter<EditorGroup>();
  private readonly _onDidChangeActiveGroup = new Emitter<
    EditorGroup | undefined
  >();
  private readonly _onDidChangeGroupIndex = new Emitter<EditorGroup>();
  private readonly _onDidLayout = new Emitter<IDimension>();

  readonly onDidAddGroup = this._onDidAddGroup.event;
  readonly onDidRemoveGroup = this._onDidRemoveGroup.event;
  readonly onDidChangeActiveGroup = this._onDidChangeActiveGroup.event;
  readonly onDidChangeGroupIndex = this._onDidChangeGroupIndex.event;
  readonly onDidLayout = this._onDidLayout.event;

  constructor(private readonly _factory: IEditorPaneFactory) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Getter
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 获取所有组
   */
  get groups(): readonly EditorGroup[] {
    return this._groupOrder.map((id) => this._groups.get(id)!);
  }

  /**
   * 获取组数量
   */
  get count(): number {
    return this._groups.size;
  }

  /**
   * 获取活动组
   */
  get activeGroup(): EditorGroup | undefined {
    return this._activeGroup;
  }

  /**
   * 获取布局方向
   */
  get orientation(): SplitDirection {
    return this._orientation;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 创建和初始化
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 创建编辑器部分
   */
  create(parent: HTMLElement): HTMLElement {
    this._container = document.createElement("div");
    this._container.className = "editor-part";
    this._container.style.cssText = `
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      overflow: hidden;
    `;

    // 组容器
    this._groupsContainer = document.createElement("div");
    this._groupsContainer.className = "editor-groups-container";
    this._groupsContainer.style.cssText = `
      flex: 1;
      display: flex;
      flex-direction: ${this._orientation === SplitDirection.HORIZONTAL ? "row" : "column"};
      overflow: hidden;
    `;
    this._container.appendChild(this._groupsContainer);

    parent.appendChild(this._container);

    // 创建初始组
    if (this._groups.size === 0) {
      this._createInitialGroup();
    }

    return this._container;
  }

  /**
   * 创建初始组
   */
  private _createInitialGroup(): EditorGroup {
    const group = this._doCreateGroup();
    this._activeGroup = group;
    return group;
  }

  /**
   * 创建组的内部方法
   */
  private _doCreateGroup(): EditorGroup {
    const group = createEditorGroup(this._factory);

    // 创建组容器
    if (this._groupsContainer) {
      const groupContainer = document.createElement("div");
      groupContainer.className = "editor-group-container";
      groupContainer.style.cssText = `
        flex: 1;
        position: relative;
        overflow: hidden;
        min-width: 100px;
        min-height: 100px;
      `;
      groupContainer.dataset.groupId = String(group.id);
      this._groupsContainer.appendChild(groupContainer);

      // 创建组视图
      group.create(groupContainer);
    }

    // 添加到映射
    this._groups.set(group.id, group);
    this._groupOrder.push(group.id);

    // 监听组变化
    const changeDisposable = group.onDidChange((e: IEditorGroupChangeEvent) => {
      // 可以在这里处理组变化事件
    });
    this._disposables.push(changeDisposable);

    return group;
  }

  /**
   * 根据位置获取组
   */
  private _getGroupByLocation(
    location: GroupLocation,
  ): EditorGroup | undefined {
    switch (location) {
      case GroupLocation.FIRST:
        return this._groups.get(this._groupOrder[0]);
      case GroupLocation.LAST:
        return this._groups.get(this._groupOrder[this._groupOrder.length - 1]);
      case GroupLocation.NEXT:
        if (this._activeGroup) {
          const index = this._groupOrder.indexOf(this._activeGroup.id);
          if (index < this._groupOrder.length - 1) {
            return this._groups.get(this._groupOrder[index + 1]);
          }
        }
        return undefined;
      case GroupLocation.PREVIOUS:
        if (this._activeGroup) {
          const index = this._groupOrder.indexOf(this._activeGroup.id);
          if (index > 0) {
            return this._groups.get(this._groupOrder[index - 1]);
          }
        }
        return undefined;
      default:
        return undefined;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 组管理
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 添加组
   */
  addGroup(
    location: GroupLocation | EditorGroup,
    direction: GroupDirection,
    options?: IAddGroupOptions,
  ): EditorGroup {
    // 确定参考组
    let referenceGroup: EditorGroup | undefined;
    if (typeof location === "object") {
      referenceGroup = location;
    } else {
      referenceGroup = this._getGroupByLocation(location);
    }

    // 创建新组
    const newGroup = this._doCreateGroup();

    // 确定插入位置
    let insertIndex: number;
    if (referenceGroup) {
      const refIndex = this._groupOrder.indexOf(referenceGroup.id);
      if (
        direction === GroupDirection.LEFT ||
        direction === GroupDirection.UP
      ) {
        insertIndex = refIndex;
      } else {
        insertIndex = refIndex + 1;
      }
    } else {
      insertIndex = this._groupOrder.length;
    }

    // 重新排列组顺序（新组已在 _doCreateGroup 中添加到末尾）
    const currentIndex = this._groupOrder.indexOf(newGroup.id);
    if (currentIndex !== insertIndex) {
      this._groupOrder.splice(currentIndex, 1);
      this._groupOrder.splice(insertIndex, 0, newGroup.id);
    }

    // 触发事件
    this._onDidAddGroup.fire(newGroup);

    // 更新索引事件
    for (let i = insertIndex; i < this._groupOrder.length; i++) {
      const g = this._groups.get(this._groupOrder[i]);
      if (g) {
        this._onDidChangeGroupIndex.fire(g);
      }
    }

    // 激活新组
    if (options?.activate !== false) {
      this.activateGroup(newGroup);
    }

    // 复制活动编辑器
    if (options?.copyActiveEditor && referenceGroup?.activeEditor) {
      referenceGroup.copyEditor(referenceGroup.activeEditor, newGroup);
    }

    // 更新布局
    this._layoutGroups();

    return newGroup;
  }

  /**
   * 移除组
   */
  removeGroup(group: EditorGroup): void {
    if (!this._groups.has(group.id)) {
      return;
    }

    // 不能移除最后一个组
    if (this._groups.size === 1) {
      return;
    }

    // 关闭所有编辑器
    group.closeAllEditors();

    // 从映射和顺序中移除
    const index = this._groupOrder.indexOf(group.id);
    this._groupOrder.splice(index, 1);
    this._groups.delete(group.id);

    // 移除 DOM 元素
    if (this._groupsContainer) {
      const groupContainer = this._groupsContainer.querySelector(
        `[data-group-id="${group.id}"]`,
      );
      if (groupContainer) {
        this._groupsContainer.removeChild(groupContainer);
      }
    }

    // 触发事件
    this._onDidRemoveGroup.fire(group);

    // 如果移除的是活动组，激活相邻组
    if (this._activeGroup === group) {
      const newActiveIndex = Math.min(index, this._groupOrder.length - 1);
      const newActiveGroup = this._groups.get(this._groupOrder[newActiveIndex]);
      this.activateGroup(newActiveGroup);
    }

    // 销毁组
    group.dispose();

    // 更新布局
    this._layoutGroups();
  }

  /**
   * 合并所有组到目标组
   */
  mergeAllGroups(targetGroup?: EditorGroup): void {
    const target = targetGroup || this._activeGroup;
    if (!target) {
      return;
    }

    // 移动所有其他组的编辑器到目标组
    const groupsToRemove: EditorGroup[] = [];
    for (const group of this.groups) {
      if (group === target) {
        continue;
      }

      for (const editor of [...group.editors]) {
        group.moveEditor(editor, target);
      }

      groupsToRemove.push(group);
    }

    // 移除空组
    for (const group of groupsToRemove) {
      this.removeGroup(group);
    }
  }

  /**
   * 激活组
   */
  activateGroup(group: EditorGroup | undefined): void {
    if (this._activeGroup === group) {
      return;
    }

    this._activeGroup = group;
    this._onDidChangeActiveGroup.fire(group);

    if (group) {
      group.focus();
    }
  }

  /**
   * 获取组
   */
  getGroup(id: number): EditorGroup | undefined {
    return this._groups.get(id);
  }

  /**
   * 查找包含指定编辑器的组
   */
  findGroup(editor: EditorInput): EditorGroup | undefined {
    for (const group of this.groups) {
      if (group.contains(editor)) {
        return group;
      }
    }
    return undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 编辑器操作（便捷方法）
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 打开编辑器（在活动组）
   */
  async openEditor(
    input: EditorInput,
    options?: IEditorOptions,
    group?: EditorGroup,
  ): Promise<void> {
    const targetGroup = group || this._activeGroup;
    if (!targetGroup) {
      return;
    }

    await targetGroup.openEditor(input, options);
  }

  /**
   * 关闭编辑器
   */
  async closeEditor(input: EditorInput, group?: EditorGroup): Promise<void> {
    const targetGroup = group || this.findGroup(input) || this._activeGroup;
    if (!targetGroup) {
      return;
    }

    await targetGroup.closeEditor(input);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 布局
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 设置布局方向
   */
  setOrientation(orientation: SplitDirection): void {
    if (this._orientation === orientation) {
      return;
    }

    this._orientation = orientation;

    if (this._groupsContainer) {
      this._groupsContainer.style.flexDirection =
        orientation === SplitDirection.HORIZONTAL ? "row" : "column";
    }

    this._layoutGroups();
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

    this._layoutGroups();
    this._onDidLayout.fire(dimension);
  }

  /**
   * 布局所有组
   */
  private _layoutGroups(): void {
    if (!this._dimension || !this._groupsContainer) {
      return;
    }

    const groupCount = this._groups.size;
    if (groupCount === 0) {
      return;
    }

    // 简单的均分布局
    const isHorizontal = this._orientation === SplitDirection.HORIZONTAL;
    const totalSize = isHorizontal
      ? this._dimension.width
      : this._dimension.height;
    const groupSize = Math.floor(totalSize / groupCount);

    for (const group of this.groups) {
      const groupDimension: IDimension = isHorizontal
        ? { width: groupSize, height: this._dimension.height }
        : { width: this._dimension.width, height: groupSize };

      group.layout(groupDimension);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 状态序列化
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 保存状态
   */
  saveState(): void {
    for (const group of this.groups) {
      group.saveState();
    }
  }

  /**
   * 获取布局状态
   */
  getLayoutState(): IEditorPartLayoutState {
    const groups: IEditorGroupLayoutState[] = [];

    for (const group of this.groups) {
      const editors: IEditorLayoutState[] = [];
      let activeEditorIndex = -1;

      for (let i = 0; i < group.editors.length; i++) {
        const editor = group.editors[i];
        editors.push({
          typeId: editor.typeId,
          resource: editor.resource,
          pinned: !group.previewEditor || group.previewEditor !== editor,
          sticky: false, // 简化处理
        });

        if (group.activeEditor === editor) {
          activeEditorIndex = i;
        }
      }

      groups.push({
        id: group.id,
        editors,
        activeEditorIndex,
      });
    }

    return {
      groups,
      activeGroupId: this._activeGroup?.id ?? -1,
      orientation: this._orientation,
    };
  }

  /**
   * 恢复布局状态
   */
  async restoreLayoutState(
    state: IEditorPartLayoutState,
    resolveEditor: (layout: IEditorLayoutState) => EditorInput | undefined,
  ): Promise<void> {
    // 设置方向
    this.setOrientation(state.orientation);

    // 恢复每个组
    for (const groupState of state.groups) {
      // 获取或创建组
      let group = this.getGroup(groupState.id);
      if (!group && this._groups.size < state.groups.length) {
        group = this.addGroup(GroupLocation.LAST, GroupDirection.RIGHT, {
          activate: false,
        });
      }

      if (!group) {
        continue;
      }

      // 恢复编辑器
      for (let i = 0; i < groupState.editors.length; i++) {
        const editorState = groupState.editors[i];
        const editor = resolveEditor(editorState);

        if (editor) {
          await group.openEditor(editor, {
            pinned: editorState.pinned,
            sticky: editorState.sticky,
            inactive: i !== groupState.activeEditorIndex,
          });
        }
      }
    }

    // 激活指定组
    if (state.activeGroupId !== -1) {
      const activeGroup = this.getGroup(state.activeGroupId);
      if (activeGroup) {
        this.activateGroup(activeGroup);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 生命周期
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 销毁
   */
  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;

    // 清理事件监听
    for (const disposable of this._disposables) {
      disposable.dispose();
    }
    this._disposables.length = 0;

    // 销毁所有组
    for (const group of this.groups) {
      group.dispose();
    }
    this._groups.clear();
    this._groupOrder = [];

    // 清理事件发射器
    this._onDidAddGroup.dispose();
    this._onDidRemoveGroup.dispose();
    this._onDidChangeActiveGroup.dispose();
    this._onDidChangeGroupIndex.dispose();
    this._onDidLayout.dispose();

    // 移除 DOM
    if (this._container && this._container.parentElement) {
      this._container.parentElement.removeChild(this._container);
    }
    this._container = undefined;
    this._groupsContainer = undefined;
    this._activeGroup = undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 工厂函数
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 创建编辑器部分
 */
export function createEditorPart(factory: IEditorPaneFactory): EditorPart {
  return new EditorPart(factory);
}

// 重新导出类型
export { GroupDirection, GroupLocation };
