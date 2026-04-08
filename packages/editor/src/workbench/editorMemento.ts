/**
 * editorMemento.ts — 编辑器视图状态持久化
 *
 * 参考 VSCode 的 vs/workbench/browser/parts/editor/editorPane.ts 中的 EditorMemento
 * 使用 LRU 缓存 + localStorage 持久化编辑器 ViewState
 *
 * 清理机制（参考 VSCode）：
 * - clearEditorStateOnDispose: 当 EditorInput dispose 时自动清理状态
 * - clearEditorState: 手动清理指定资源的状态
 */

import type { IDisposable } from "monaco-editor";
import type { EditorInput } from "./editorInput";

// ══════════════════════════════════════════════════
//  类型定义
// ══════════════════════════════════════════════════

/**
 * 编辑器组标识符
 */
export type GroupIdentifier = number;

/**
 * 按组存储的状态映射
 */
interface MapGroupToMemento<T> {
  [group: GroupIdentifier]: T;
}

/**
 * 编辑器 Memento 接口
 */
export interface IEditorMemento<T> {
  /**
   * 保存编辑器状态
   */
  saveEditorState(group: GroupIdentifier, resource: string, state: T): void;

  /**
   * 加载编辑器状态
   */
  loadEditorState(group: GroupIdentifier, resource: string): T | undefined;

  /**
   * 清除编辑器状态
   */
  clearEditorState(resource: string, group?: GroupIdentifier): void;

  /**
   * 移动编辑器状态（重命名文件时）
   */
  moveEditorState(source: string, target: string): void;

  /**
   * 当 EditorInput dispose 时自动清理状态
   */
  clearEditorStateOnDispose(resource: string, editor: EditorInput): void;

  /**
   * 保存到持久化存储
   */
  saveState(): void;
}

/**
 * 持久化存储数据结构
 */
interface IMementoStorage<T> {
  /**
   * 版本号（用于数据迁移）
   */
  version: number;

  /**
   * LRU 访问顺序（最近访问的在末尾）
   */
  accessOrder: string[];

  /**
   * 状态数据
   */
  states: Record<string, MapGroupToMemento<T>>;
}

// ══════════════════════════════════════════════════
//  常量
// ══════════════════════════════════════════════════

const STORAGE_VERSION = 1;
const STORAGE_KEY_PREFIX = "ftre:editorMemento:";

/**
 * 共享状态的特殊组 ID（跨组共享）
 * 使用负数以避免与真实组 ID 冲突
 */
const SHARED_EDITOR_STATE: GroupIdentifier = -1;

// ══════════════════════════════════════════════════
//  LRU Cache 实现
// ══════════════════════════════════════════════════

/**
 * 简单的 LRU Cache 实现
 */
class LRUCache<K, V> {
  private readonly _map = new Map<K, V>();
  private readonly _limit: number;

  constructor(limit: number) {
    this._limit = limit;
  }

  get size(): number {
    return this._map.size;
  }

  has(key: K): boolean {
    return this._map.has(key);
  }

  get(key: K, touch = true): V | undefined {
    const value = this._map.get(key);
    if (value !== undefined && touch) {
      // 移到末尾（最近使用）
      this._map.delete(key);
      this._map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // 如果已存在，先删除
    if (this._map.has(key)) {
      this._map.delete(key);
    }

    // 添加到末尾
    this._map.set(key, value);

    // 清理超出限制的条目
    while (this._map.size > this._limit) {
      const firstKey = this._map.keys().next().value;
      if (firstKey !== undefined) {
        this._map.delete(firstKey);
      } else {
        break;
      }
    }
  }

  delete(key: K): boolean {
    return this._map.delete(key);
  }

  clear(): void {
    this._map.clear();
  }

  keys(): IterableIterator<K> {
    return this._map.keys();
  }

  entries(): IterableIterator<[K, V]> {
    return this._map.entries();
  }

  /**
   * 序列化为 JSON 格式
   */
  toJSON(): [K, V][] {
    return Array.from(this._map.entries());
  }

  /**
   * 从 JSON 格式恢复
   */
  fromJSON(data: [K, V][]): void {
    this._map.clear();
    for (const [key, value] of data) {
      this._map.set(key, value);
    }
  }
}

// ══════════════════════════════════════════════════
//  EditorMemento 实现
// ══════════════════════════════════════════════════

/**
 * 编辑器 Memento 实现
 *
 * 参考 VSCode 的 EditorMemento 设计：
 * - LRU 缓存策略限制内存使用
 * - 支持按编辑器组存储状态
 * - 支持跨组共享状态（sharedViewState 配置）
 * - 持久化到 localStorage
 */
export class EditorMemento<T> implements IEditorMemento<T>, IDisposable {
  /**
   * 编辑器类型 ID
   */
  readonly id: string;

  /**
   * 存储键
   */
  private readonly _key: string;

  /**
   * 缓存限制
   */
  private readonly _limit: number;

  /**
   * LRU 缓存
   */
  private _cache: LRUCache<string, MapGroupToMemento<T>> | undefined;

  /**
   * 是否已清理
   */
  private _cleanedUp = false;

  /**
   * 是否共享编辑器状态
   */
  private _shareEditorState = false;

  /**
   * 脏标记
   */
  private _dirty = false;

  /**
   * 防抖定时器
   */
  private _saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * EditorInput dispose 监听器（用于自动清理状态）
   */
  private _editorDisposables: Map<EditorInput, IDisposable> | undefined;

  constructor(
    id: string,
    key: string,
    limit: number = 100,
    shareEditorState: boolean = false,
  ) {
    this.id = id;
    this._key = key;
    this._limit = limit;
    this._shareEditorState = shareEditorState;
  }

  /**
   * 设置是否共享编辑器状态
   */
  setShareEditorState(share: boolean): void {
    this._shareEditorState = share;
  }

  /**
   * 保存编辑器状态
   */
  saveEditorState(group: GroupIdentifier, resource: string, state: T): void {
    if (!resource) {
      return;
    }

    const cache = this._doLoad();

    // 获取或创建资源的状态映射
    let mementosForResource = cache.get(resource);
    if (!mementosForResource) {
      mementosForResource = Object.create(null) as MapGroupToMemento<T>;
      cache.set(resource, mementosForResource);
    }

    // 存储组状态
    mementosForResource[group] = state;

    // 如果启用共享，同时存储到共享状态
    if (this._shareEditorState) {
      mementosForResource[SHARED_EDITOR_STATE] = state;
    }

    this._markDirty();
  }

  /**
   * 加载编辑器状态
   */
  loadEditorState(group: GroupIdentifier, resource: string): T | undefined {
    if (!resource) {
      return undefined;
    }

    const cache = this._doLoad();
    const mementosForResource = cache.get(resource);

    if (mementosForResource) {
      // 首先尝试获取组状态
      const mementoForGroup = mementosForResource[group];
      if (mementoForGroup) {
        return mementoForGroup;
      }

      // 如果启用共享，尝试获取共享状态
      if (this._shareEditorState) {
        return mementosForResource[SHARED_EDITOR_STATE];
      }
    }

    return undefined;
  }

  /**
   * 清除编辑器状态
   */
  clearEditorState(resource: string, group?: GroupIdentifier): void {
    if (!resource) {
      return;
    }

    const cache = this._doLoad();

    if (group !== undefined) {
      // 清除特定组的状态
      const mementosForResource = cache.get(resource);
      if (mementosForResource) {
        delete mementosForResource[group];

        // 如果没有剩余状态，删除整个条目
        if (Object.keys(mementosForResource).length === 0) {
          cache.delete(resource);
        }
      }
    } else {
      // 清除所有组的状态
      cache.delete(resource);
    }

    this._markDirty();
  }

  /**
   * 移动编辑器状态（重命名文件时）
   */
  moveEditorState(source: string, target: string): void {
    if (!source || !target || source === target) {
      return;
    }

    const cache = this._doLoad();

    // 获取源状态（不触发 LRU 更新）
    const sourceState = cache.get(source, false);
    if (sourceState) {
      cache.delete(source);
      cache.set(target, sourceState);
      this._markDirty();
    }
  }

  /**
   * 当 EditorInput dispose 时自动清理状态
   *
   * 参考 VSCode: EditorMemento.clearEditorStateOnDispose
   */
  clearEditorStateOnDispose(resource: string, editor: EditorInput): void {
    if (!this._editorDisposables) {
      this._editorDisposables = new Map<EditorInput, IDisposable>();
    }

    // 避免重复注册
    if (this._editorDisposables.has(editor)) {
      return;
    }

    // 监听 EditorInput 的 dispose 事件
    const disposable = editor.onWillDispose(() => {
      // 清理该资源的所有状态
      this.clearEditorState(resource);
      // 移除监听器
      this._editorDisposables?.delete(editor);
    });

    this._editorDisposables.set(editor, disposable);
  }

  /**
   * 保存到持久化存储
   */
  saveState(): void {
    // 取消待处理的保存
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = null;
    }

    if (!this._dirty) {
      return;
    }

    const cache = this._doLoad();

    // 清理无效的组状态
    if (!this._cleanedUp) {
      this._cleanUp(cache);
      this._cleanedUp = true;
    }

    try {
      const data: IMementoStorage<T> = {
        version: STORAGE_VERSION,
        accessOrder: Array.from(cache.keys()),
        states: Object.fromEntries(cache.entries()),
      };

      const storageKey = this._getStorageKey();
      localStorage.setItem(storageKey, JSON.stringify(data));
      this._dirty = false;
    } catch (error) {
      console.warn(`[EditorMemento] Failed to save state:`, error);

      // 如果存储满了，尝试清理一些条目
      if (error instanceof Error && error.name === "QuotaExceededError") {
        this._evictOldest(10);
        // 不再重试，避免无限循环
      }
    }
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this._cache?.size ?? 0;
  }

  /**
   * 清除所有状态
   */
  clearAll(): void {
    if (this._cache) {
      this._cache.clear();
    }

    try {
      localStorage.removeItem(this._getStorageKey());
    } catch {
      // ignore
    }

    this._dirty = false;
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.saveState();

    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = null;
    }

    this._cache?.clear();
    this._cache = undefined;
  }

  // ══════════════════════════════════════════════════
  //  私有方法
  // ══════════════════════════════════════════════════

  /**
   * 获取存储键
   */
  private _getStorageKey(): string {
    return `${STORAGE_KEY_PREFIX}${this._key}`;
  }

  /**
   * 加载缓存
   */
  private _doLoad(): LRUCache<string, MapGroupToMemento<T>> {
    if (!this._cache) {
      this._cache = new LRUCache<string, MapGroupToMemento<T>>(this._limit);
      this._loadFromStorage();
    }
    return this._cache;
  }

  /**
   * 从持久化存储加载
   */
  private _loadFromStorage(): void {
    try {
      const storageKey = this._getStorageKey();
      const raw = localStorage.getItem(storageKey);

      if (!raw) {
        return;
      }

      const data: IMementoStorage<T> = JSON.parse(raw);

      // 版本检查
      if (data.version !== STORAGE_VERSION) {
        localStorage.removeItem(storageKey);
        return;
      }

      // 按 LRU 顺序恢复
      const accessOrder = data.accessOrder || [];
      for (const resource of accessOrder) {
        const state = data.states[resource];
        if (state) {
          this._cache!.set(resource, state);
        }
      }
    } catch (error) {
      console.warn(`[EditorMemento] Failed to load from storage:`, error);
    }
  }

  /**
   * 标记需要保存
   */
  private _markDirty(): void {
    this._dirty = true;

    // 防抖保存
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
    }

    this._saveDebounceTimer = setTimeout(() => {
      this.saveState();
    }, 1000);
  }

  /**
   * 清理无效的组状态
   */
  private _cleanUp(cache: LRUCache<string, MapGroupToMemento<T>>): void {
    // 这里可以添加清理逻辑
    // 例如：删除不存在的组的状态
    // 由于我们没有组管理服务，暂时不做处理
  }

  /**
   * 清理最老的条目
   */
  private _evictOldest(count: number): void {
    if (!this._cache) {
      return;
    }

    const keys = Array.from(this._cache.keys());
    for (let i = 0; i < count && i < keys.length; i++) {
      this._cache.delete(keys[i]);
    }
  }
}

// ══════════════════════════════════════════════════
//  工厂函数
// ══════════════════════════════════════════════════

/**
 * 全局 Memento 注册表
 */
const mementoRegistry = new Map<string, EditorMemento<unknown>>();

/**
 * 获取或创建 EditorMemento
 */
export function getEditorMemento<T>(
  editorId: string,
  key: string,
  limit: number = 100,
  shareEditorState: boolean = false,
): IEditorMemento<T> {
  const fullKey = `${editorId}:${key}`;

  let memento = mementoRegistry.get(fullKey) as EditorMemento<T> | undefined;

  if (!memento) {
    memento = new EditorMemento<T>(editorId, fullKey, limit, shareEditorState);
    mementoRegistry.set(fullKey, memento as EditorMemento<unknown>);
  }

  return memento;
}

/**
 * 销毁所有 EditorMemento
 */
export function disposeAllEditorMementos(): void {
  for (const memento of mementoRegistry.values()) {
    memento.dispose();
  }
  mementoRegistry.clear();
}

/**
 * 保存所有 EditorMemento
 */
export function saveAllEditorMementos(): void {
  for (const memento of mementoRegistry.values()) {
    memento.saveState();
  }
}
