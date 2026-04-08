/**
 * viewStateCompat.ts — ViewState 兼容层
 *
 * 基于 EditorMemento 提供 ViewState 管理，
 * 并支持从旧 localStorage 格式迁移数据。
 *
 * 功能：
 * 1. 从旧的 localStorage 迁移数据到新格式
 * 2. 提供统一的 ViewState 访问接口
 * 3. 基于 EditorMemento 实现持久化
 */

import type { ICodeEditorViewState } from "../common/editorCommon";
import {
  getEditorMemento,
  saveAllEditorMementos,
  type IEditorMemento,
  type GroupIdentifier,
} from "./editorMemento";

// ═══════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 旧版 ViewState 格式（用于数据迁移）
 */
interface ILegacySerializableViewState {
  cursorState: Array<{
    inSelectionMode: boolean;
    selectionStart: { lineNumber: number; column: number };
    position: { lineNumber: number; column: number };
  }>;
  scrollTop: number;
  scrollLeft: number;
  firstPosition: { lineNumber: number; column: number } | null;
  firstPositionDeltaTop: number;
}

/**
 * 旧版存储格式
 */
interface ILegacyViewStateStorage {
  version: number;
  accessOrder: string[];
  states: Record<string, ILegacySerializableViewState>;
}

/**
 * 兼容层配置
 */
interface IViewStateCompatOptions {
  /** 编辑器 ID */
  editorId?: string;
  /** 默认组 ID */
  defaultGroupId?: GroupIdentifier;
  /** 是否自动迁移旧数据 */
  autoMigrate?: boolean;
  /** 旧存储键前缀 */
  legacyKeyPrefix?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ViewStateCompat 实现
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ViewState 兼容层
 *
 * 提供统一的 ViewState 管理接口，基于 EditorMemento 实现
 */
export class ViewStateCompat {
  private readonly _memento: IEditorMemento<ICodeEditorViewState>;
  private readonly _defaultGroupId: GroupIdentifier;
  private readonly _legacyKeyPrefix: string;
  private _migrated: boolean = false;

  constructor(options: IViewStateCompatOptions = {}) {
    const {
      editorId = "textCodeEditor",
      defaultGroupId = 1,
      autoMigrate = true,
      legacyKeyPrefix = "ftre:viewState:",
    } = options;

    this._defaultGroupId = defaultGroupId;
    this._legacyKeyPrefix = legacyKeyPrefix;

    // 获取新的 EditorMemento
    this._memento = getEditorMemento<ICodeEditorViewState>(
      editorId,
      "viewState",
      100,
      true, // 跨组共享
    );

    // 自动迁移
    if (autoMigrate) {
      this._migrateFromLegacy();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 公共 API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 保存 ViewState
   */
  saveViewState(
    resource: string,
    viewState: ICodeEditorViewState,
    groupId?: GroupIdentifier,
  ): void {
    this._memento.saveEditorState(
      groupId ?? this._defaultGroupId,
      resource,
      viewState,
    );
  }

  /**
   * 加载 ViewState
   */
  loadViewState(
    resource: string,
    groupId?: GroupIdentifier,
  ): ICodeEditorViewState | undefined {
    // 先尝试从新格式加载
    let viewState = this._memento.loadEditorState(
      groupId ?? this._defaultGroupId,
      resource,
    );

    // 如果没有，尝试从旧格式加载
    if (!viewState && !this._migrated) {
      viewState = this._loadFromLegacy(resource);
      if (viewState) {
        // 保存到新格式
        this.saveViewState(resource, viewState, groupId);
      }
    }

    return viewState;
  }

  /**
   * 清除 ViewState
   */
  clearViewState(resource: string, groupId?: GroupIdentifier): void {
    this._memento.clearEditorState(resource, groupId);
  }

  /**
   * 移动 ViewState（重命名时）
   */
  moveViewState(oldResource: string, newResource: string): void {
    this._memento.moveEditorState(oldResource, newResource);
  }

  /**
   * 保存所有状态到存储
   */
  saveState(): void {
    this._memento.saveState();
  }

  /**
   * 迁移所有旧数据
   */
  migrateAll(): number {
    return this._migrateFromLegacy();
  }

  /**
   * 清除旧存储
   */
  clearLegacyStorage(): void {
    this._clearLegacyStorage();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 从旧格式迁移数据
   */
  private _migrateFromLegacy(): number {
    if (this._migrated) {
      return 0;
    }

    let migratedCount = 0;

    try {
      // 查找所有旧的存储键
      const legacyKeys = this._findLegacyKeys();

      for (const key of legacyKeys) {
        const data = localStorage.getItem(key);
        if (!data) continue;

        try {
          const storage = JSON.parse(data) as ILegacyViewStateStorage;
          if (storage.states) {
            for (const [resource, legacyState] of Object.entries(
              storage.states,
            )) {
              const viewState = this._convertLegacyState(legacyState);
              if (viewState) {
                this._memento.saveEditorState(
                  this._defaultGroupId,
                  resource,
                  viewState,
                );
                migratedCount++;
              }
            }
          }
        } catch {
          // 忽略解析错误
        }
      }

      this._migrated = true;

      // 保存迁移后的数据
      if (migratedCount > 0) {
        this._memento.saveState();
      }
    } catch {
      // 迁移失败，静默处理
    }

    return migratedCount;
  }

  /**
   * 从旧格式加载单个 ViewState
   */
  private _loadFromLegacy(resource: string): ICodeEditorViewState | undefined {
    try {
      const legacyKeys = this._findLegacyKeys();

      for (const key of legacyKeys) {
        const data = localStorage.getItem(key);
        if (!data) continue;

        try {
          const storage = JSON.parse(data) as ILegacyViewStateStorage;
          const legacyState = storage.states?.[resource];
          if (legacyState) {
            return this._convertLegacyState(legacyState);
          }
        } catch {
          // 忽略解析错误
        }
      }
    } catch {
      // 静默处理
    }

    return undefined;
  }

  /**
   * 转换旧格式到新格式
   */
  private _convertLegacyState(
    legacy: ILegacySerializableViewState,
  ): ICodeEditorViewState | undefined {
    try {
      return {
        cursorState: legacy.cursorState.map((cursor) => ({
          inSelectionMode: cursor.inSelectionMode,
          selectionStart: cursor.selectionStart,
          position: cursor.position,
        })),
        viewState: {
          scrollTop: legacy.scrollTop,
          scrollLeft: legacy.scrollLeft,
          firstPosition: legacy.firstPosition ?? { lineNumber: 1, column: 1 },
          firstPositionDeltaTop: legacy.firstPositionDeltaTop,
        },
        contributionsState: {},
      };
    } catch {
      return undefined;
    }
  }

  /**
   * 查找所有旧的存储键
   */
  private _findLegacyKeys(): string[] {
    const keys: string[] = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this._legacyKeyPrefix)) {
          keys.push(key);
        }
      }
    } catch {
      // localStorage 访问失败
    }

    return keys;
  }

  /**
   * 清除旧存储
   */
  private _clearLegacyStorage(): void {
    try {
      const legacyKeys = this._findLegacyKeys();
      for (const key of legacyKeys) {
        localStorage.removeItem(key);
      }
    } catch {
      // 静默处理
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 工厂函数和单例
// ═══════════════════════════════════════════════════════════════════════════

let _viewStateCompat: ViewStateCompat | null = null;

/**
 * 获取 ViewStateCompat 单例
 */
export function getViewStateCompat(
  options?: IViewStateCompatOptions,
): ViewStateCompat {
  if (!_viewStateCompat) {
    _viewStateCompat = new ViewStateCompat(options);
  }
  return _viewStateCompat;
}

/**
 * 销毁 ViewStateCompat 单例
 */
export function disposeViewStateCompat(): void {
  if (_viewStateCompat) {
    _viewStateCompat.saveState();
    _viewStateCompat = null;
  }
}

/**
 * 保存所有 ViewState（窗口关闭前调用）
 */
export function saveAllViewStates(): void {
  if (_viewStateCompat) {
    _viewStateCompat.saveState();
  }
  saveAllEditorMementos();
}

// ═══════════════════════════════════════════════════════════════════════════
// 便捷函数（直接操作默认单例）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 保存 ViewState（便捷函数）
 */
export function saveViewState(
  resource: string,
  viewState: ICodeEditorViewState,
): void {
  getViewStateCompat().saveViewState(resource, viewState);
}

/**
 * 加载 ViewState（便捷函数）
 */
export function loadViewState(
  resource: string,
): ICodeEditorViewState | undefined {
  return getViewStateCompat().loadViewState(resource);
}

/**
 * 清除 ViewState（便捷函数）
 */
export function clearViewState(resource: string): void {
  getViewStateCompat().clearViewState(resource);
}
