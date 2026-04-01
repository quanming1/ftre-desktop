/**
 * EditorManager — Monaco 实例池管理器
 *
 * 核心设计理念：
 * 1. 实例复用：切换 tab 时隐藏/显示 DOM，而不是销毁/重建 Monaco 实例
 * 2. 预加载：后台提前创建 model，加快首次打开速度
 * 3. 自动回收：基于 LRU 策略回收不活跃的实例，防止内存泄漏
 *
 * 架构：
 * ┌──────────────────────────────────────────────────┐
 * │  EditorManager（全局单例）                        │
 * │  ┌────────────────┐  ┌────────────────────────┐  │
 * │  │ slots Map       │  │ models Map              │  │
 * │  │ path → Slot     │  │ path → ITextModel       │  │
 * │  │ (editor+DOM)    │  │ (预加载 / 活跃)         │  │
 * │  └────────────────┘  └────────────────────────┘  │
 * │  ┌────────────────┐  ┌────────────────────────┐  │
 * │  │ lruOrder []     │  │ viewStates Map          │  │
 * │  │ 最近
使用排序    │  │ path → viewState        │  │
 * │  └────────────────┘  └────────────────────────┘  │
 * └──────────────────────────────────────────────────┘
 *
 * Slot 生命周期：
 *   create → attach(挂到可见容器) → detach(从容器移除，DOM 保留) → dispose(彻底销毁)
 *
 * 与 React 的集成方式：
 *   React 组件只负责提供一个 container div，通过 ref 传给 EditorManager。
 *   EditorManager 把 slot 的 DOM 挂到 container 里（attach），
 *   切换 tab 时把旧 slot detach、新 slot attach，Monaco 实例始终存活。
 */

import type { editor } from "monaco-editor";
import type * as Monaco from "monaco-editor";

// ── 类型定义 ──

/** 单个编辑器 slot 的内部状态 */
interface EditorSlot {
  /** 文件路径（唯一标识） */
  path: string;
  /** Monaco 编辑器实例 */
  editor: editor.IStandaloneCodeEditor;
  /** slot 自己的 DOM wrapper（不随 React 树销毁） */
  wrapper: HTMLDivElement;
  /** 当前是否挂载到可见容器 */
  attached: boolean;
  /** 上次激活时间戳（用于 LRU 回收） */
  lastActiveAt: number;
  /** 已注册的事件监听 disposable（dispose 时统一清理） */
  disposables: Monaco.IDisposable[];
  /** 可变的内容变化回调引用（允许 React 重渲染时替换闭包） */
  onContentChange: ((content: string) => void) | null;
}

/** 预加载的 model 信息 */
interface PreloadedModel {
  path: string;
  model: editor.ITextModel;
  language: string;
  createdAt: number;
}

/** EditorManager 配置 */
export interface EditorManagerConfig {
  /** 最大保持活跃的 editor slot 数量（默认 8） */
  maxSlots?: number;
  /** 最大预加载 model 数量（默认 15） */
  maxPreloadedModels?: number;
  /** slot 空闲多久后可被回收（毫秒，默认 5 分钟） */
  slotIdleTimeoutMs?: number;
  /** 预加载 model 空闲多久后可被回收（毫秒，默认 10 分钟） */
  modelIdleTimeoutMs?: number;
  /** 默认的 editor 创建选项 */
  editorOptions?: editor.IStandaloneEditorConstructionOptions;
}

/** attach 时的选项 */
export interface AttachOptions {
  /** 文件路径 */
  path: string;
  /** 文件语言 */
  language: string;
  /** 文件内容（仅首次创建时使用，已有 slot 时忽略） */
  content: string;
  /** 挂载目标容器 */
  container: HTMLElement;
  /**
   * editor 首次创建后的回调（仅在新建 slot 时调用）
   *
   * 用于注册快捷键、右键菜单、光标事件等。
   * 返回的 IDisposable[] 会在 slot dispose 时自动清理。
   */
  onDidCreate?: (
    editor: editor.IStandaloneCodeEditor,
    monaco: typeof Monaco,
  ) => Monaco.IDisposable[];
  /**
   * 内容变化回调
   *
   * 每次 attach 都可以传新的闭包，EditorManager 会自动替换旧的。
   * 这样 React 组件重渲染时闭包更新不会有问题。
   */
  onDidChangeContent?: (content: string) => void;
}

// ── 默认配置 ──

const DEFAULT_EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
  lineHeight: 22,
  minimap: { enabled: true },
  scrollBeyondLastLine: false,
  renderLineHighlight: "line",
  padding: { top: 10, bottom: 10 },
  smoothScrolling: false,
  cursorBlinking: "blink",
  cursorSmoothCaretAnimation: "off",
  bracketPairColorization: { enabled: true },
  automaticLayout: false,
  renderValidationDecorations: "off",
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    verticalScrollbarSize: 5,
    horizontalScrollbarSize: 5,
  },
};

const DEFAULT_MAX_SLOTS = 8;
const DEFAULT_MAX_PRELOADED_MODELS = 15;
const DEFAULT_SLOT_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟
const DEFAULT_MODEL_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟
const GC_INTERVAL_MS = 30_000; // 30 秒

// ── EditorManager ──

class EditorManagerImpl {
  // Monaco 全局对象引用（需要外部注入）
  private _monaco: typeof Monaco | null = null;

  // 活跃的 editor slots（path → Slot）
  private _slots = new Map<string, EditorSlot>();

  // 预加载的 models（path → PreloadedModel）
  private _preloadedModels = new Map<string, PreloadedModel>();

  // LRU 顺序：最近使用的 path 在末尾
  private _lruOrder: string[] = [];

  // viewState 缓存（持久化，不随 slot 回收而丢失）
  private _viewStates = new Map<string, editor.ICodeEditorViewState>();

  // 当前激活的 slot 路径
  private _activeSlotPath: string | null = null;

  // 配置
  private _maxSlots: number;
  private _maxPreloadedModels: number;
  private _slotIdleTimeoutMs: number;
  private _modelIdleTimeoutMs: number;
  private _editorOptions: editor.IStandaloneEditorConstructionOptions;

  // GC 定时器
  private _gcTimer: ReturnType<typeof setInterval> | null = null;

  // 共享的 ResizeObserver
  private _resizeObserver: ResizeObserver | null = null;
  // 每个 wrapper 的 rAF id（用于节流）
  private _rafIds = new Map<string, number>();

  // 已销毁标志
  private _disposed = false;

  constructor(config?: EditorManagerConfig) {
    this._maxSlots = config?.maxSlots ?? DEFAULT_MAX_SLOTS;
    this._maxPreloadedModels =
      config?.maxPreloadedModels ?? DEFAULT_MAX_PRELOADED_MODELS;
    this._slotIdleTimeoutMs =
      config?.slotIdleTimeoutMs ?? DEFAULT_SLOT_IDLE_TIMEOUT_MS;
    this._modelIdleTimeoutMs =
      config?.modelIdleTimeoutMs ?? DEFAULT_MODEL_IDLE_TIMEOUT_MS;
    this._editorOptions = {
      ...DEFAULT_EDITOR_OPTIONS,
      ...(config?.editorOptions ?? {}),
    };
  }

  // ══════════════════════════════════════════════════
  //  初始化
  // ══════════════════════════════════════════════════

  /**
   * 注入 Monaco 全局对象（必须在使用前调用一次）
   */
  init(monaco: typeof Monaco): void {
    if (this._disposed) return;
    this._monaco = monaco;

    // 启动定时 GC
    if (!this._gcTimer) {
      this._gcTimer = setInterval(() => this._gc(), GC_INTERVAL_MS);
    }

    // 创建共享的 ResizeObserver
    if (!this._resizeObserver) {
      this._resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const wrapper = entry.target as HTMLDivElement;
          const path = wrapper.dataset.editorPath;
          if (!path) continue;

          // rAF 节流：同一 path 只允许一个 pending layout
          if (this._rafIds.has(path)) continue;

          const rafId = requestAnimationFrame(() => {
            this._rafIds.delete(path);
            const slot = this._slots.get(path);
            if (slot?.attached) {
              slot.editor.layout();
            }
          });
          this._rafIds.set(path, rafId);
        }
      });
    }
  }

  /** 获取 Monaco 全局对象 */
  getMonaco(): typeof Monaco | null {
    return this._monaco;
  }

  /** 检查是否已初始化 */
  isInitialized(): boolean {
    return this._monaco !== null && !this._disposed;
  }

  // ══════════════════════════════════════════════════
  //  核心 API：attach / detach
  // ══════════════════════════════════════════════════

  /**
   * 将指定文件的 editor 挂载到容器中
   *
   * - 如果该文件已有 slot → 直接 attach（极快，无需重建）
   * - 如果该文件有预加载的 model → 用已有 model 创建 editor（快，跳过 model 创建）
   * - 否则 → 从零创建 model + editor
   *
   * @returns editor 实例，如果 manager 未初始化或已销毁则返回 null
   */
  attach(options: AttachOptions): editor.IStandaloneCodeEditor | null {
    if (this._disposed || !this._monaco) return null;

    const {
      path,
      language,
      content,
      container,
      onDidCreate,
      onDidChangeContent,
    } = options;

    // 先 detach 当前活跃的 slot（如果不是同一个文件）
    if (this._activeSlotPath && this._activeSlotPath !== path) {
      this._detachSlot(this._activeSlotPath);
    }

    let slot = this._slots.get(path);

    if (slot) {
      // ── 命中已有 slot：直接复用（核心优化路径） ──
      // 更新内容变化回调引用（React 闭包可能变了）
      slot.onContentChange = onDidChangeContent ?? null;

      this._attachSlot(slot, container);
      this._touchLru(path);
      this._activeSlotPath = path;
      return slot.editor;
    }

    // ── 需要新建 slot ──

    // 确保 slot 数量不超限
    this._ensureSlotCapacity();

    // 获取或创建 model
    const model = this._getOrCreateModel(path, content, language);

    // 创建 slot
    slot = this._createSlot(path, model, onDidCreate, onDidChangeContent);

    // attach 到容器
    this._attachSlot(slot, container);
    this._touchLru(path);
    this._activeSlotPath = path;

    return slot.editor;
  }

  /**
   * 将当前活跃的 editor 从容器中分离（隐藏，不销毁）
   *
   * 下次 attach 同一文件时直接复用，滚动位置/光标/undo 历史全部保留。
   */
  detachActive(): void {
    if (this._activeSlotPath) {
      this._detachSlot(this._activeSlotPath);
      this._activeSlotPath = null;
    }
  }

  /**
   * 分离指定路径的 slot（隐藏，不销毁）
   */
  detach(path: string): void {
    this._detachSlot(path);
    if (this._activeSlotPath === path) {
      this._activeSlotPath = null;
    }
  }

  // ══════════════════════════════════════════════════
  //  实例查询
  // ══════════════════════════════════════════════════

  /** 获取指定路径的活跃 editor 实例（如果有 slot） */
  getEditor(path: string): editor.IStandaloneCodeEditor | null {
    return this._slots.get(path)?.editor ?? null;
  }

  /** 获取当前激活的 editor */
  getActiveEditor(): editor.IStandaloneCodeEditor | null {
    if (!this._activeSlotPath) return null;
    return this._slots.get(this._activeSlotPath)?.editor ?? null;
  }

  /** 获取当前激活的文件路径 */
  getActivePath(): string | null {
    return this._activeSlotPath;
  }

  /** 检查指定路径是否有活跃的 slot */
  hasSlot(path: string): boolean {
    return this._slots.has(path);
  }

  /** 获取所有 slot 的路径 */
  getSlotPaths(): string[] {
    return [...this._slots.keys()];
  }

  // ══════════════════════════════════════════════════
  //  预加载
  // ══════════════════════════════════════════════════

  /**
   * 预加载文件的 model（不创建 editor 实例）
   *
   * 只创建 ITextModel，开销很小。
   * 当用户真正打开文件时 attach() 会复用这个 model，跳过 model 创建和 tokenization 冷启动。
   */
  preloadModel(path: string, content: string, language: string): void {
    if (this._disposed || !this._monaco) return;

    // 已有 slot 或已预加载 → 跳过
    if (this._slots.has(path)) return;
    if (this._preloadedModels.has(path)) return;

    // 确保容量
    this._ensurePreloadCapacity();

    const uri = this._monaco.Uri.parse(this._pathToUri(path));
    let model = this._monaco.editor.getModel(uri);
    if (!model) {
      model = this._monaco.editor.createModel(content, language, uri);
    }

    this._preloadedModels.set(path, {
      path,
      model,
      language,
      createdAt: Date.now(),
    });
  }

  /** 检查指定路径是否有预加载的 model */
  hasPreloadedModel(path: string): boolean {
    return this._preloadedModels.has(path);
  }

  // ══════════════════════════════════════════════════
  //  viewState 管理
  // ══════════════════════════════════════════════════

  /**
   * 手动保存指定文件的 viewState（光标、滚动位置等）
   *
   * detach 时会自动保存，通常不需要手动调用。
   */
  saveViewState(path: string): void {
    const slot = this._slots.get(path);
    if (!slot) return;
    const state = slot.editor.saveViewState();
    if (state) {
      this._viewStates.set(path, state);
    }
  }

  /** 手动恢复 viewState */
  restoreViewState(path: string): void {
    const slot = this._slots.get(path);
    if (!slot) return;
    const state = this._viewStates.get(path);
    if (state) {
      slot.editor.restoreViewState(state);
    }
  }

  /** 获取指定路径的缓存 viewState（仅读取，不应用） */
  getViewState(path: string): editor.ICodeEditorViewState | null {
    return this._viewStates.get(path) ?? null;
  }

  /** 移除指定路径的 viewState */
  removeViewState(path: string): void {
    this._viewStates.delete(path);
  }

  // ══════════════════════════════════════════════════
  //  内容操作
  // ══════════════════════════════════════════════════

  /**
   * 获取指定文件的当前内容
   *
   * 优先从活跃 editor 取（最准确），回退到 model。
   */
  getContent(path: string): string | null {
    const slot = this._slots.get(path);
    if (slot) return slot.editor.getValue();

    const preloaded = this._preloadedModels.get(path);
    if (preloaded && !preloaded.model.isDisposed()) {
      return preloaded.model.getValue();
    }

    return null;
  }

  /**
   * 更新指定文件的内容
   *
   * 如果有活跃 editor → 用 executeEdits（**保留 undo/redo 栈**）
   * 如果只有预加载 model → 直接 setValue
   */
  setContent(path: string, content: string): void {
    const slot = this._slots.get(path);
    if (slot) {
      const currentValue = slot.editor.getValue();
      if (currentValue === content) return;

      // 用 executeEdits 替代 setValue，保留 undo 栈
      const model = slot.editor.getModel();
      if (model) {
        slot.editor.pushUndoStop();
        slot.editor.executeEdits("editor-manager.setContent", [
          {
            range: model.getFullModelRange(),
            text: content,
            forceMoveMarkers: true,
          },
        ]);
        slot.editor.pushUndoStop();
      }
      return;
    }

    const preloaded = this._preloadedModels.get(path);
    if (preloaded && !preloaded.model.isDisposed()) {
      preloaded.model.setValue(content);
    }
  }

  /**
   * 更新指定文件的语言
   */
  setLanguage(path: string, language: string): void {
    if (!this._monaco) return;

    const slot = this._slots.get(path);
    if (slot) {
      const model = slot.editor.getModel();
      if (model) {
        this._monaco.editor.setModelLanguage(model, language);
      }
      return;
    }

    const preloaded = this._preloadedModels.get(path);
    if (preloaded && !preloaded.model.isDisposed()) {
      this._monaco.editor.setModelLanguage(preloaded.model, language);
    }
  }

  // ══════════════════════════════════════════════════
  //  文件系统事件
  // ══════════════════════════════════════════════════

  /**
   * 文件重命名：迁移 slot / model / viewState
   */
  handleFileRenamed(oldPath: string, newPath: string): void {
    // 迁移 slot
    const slot = this._slots.get(oldPath);
    if (slot) {
      slot.path = newPath;
      slot.wrapper.dataset.editorPath = newPath;
      this._slots.delete(oldPath);
      this._slots.set(newPath, slot);

      // 迁移 rAF id
      const rafId = this._rafIds.get(oldPath);
      if (rafId !== undefined) {
        this._rafIds.delete(oldPath);
        this._rafIds.set(newPath, rafId);
      }

      // 更新 LRU
      const idx = this._lruOrder.indexOf(oldPath);
      if (idx !== -1) this._lruOrder[idx] = newPath;

      if (this._activeSlotPath === oldPath) {
        this._activeSlotPath = newPath;
      }
    }

    // 迁移预加载 model
    const preloaded = this._preloadedModels.get(oldPath);
    if (preloaded) {
      preloaded.path = newPath;
      this._preloadedModels.delete(oldPath);
      this._preloadedModels.set(newPath, preloaded);
    }

    // 迁移 viewState
    const vs = this._viewStates.get(oldPath);
    if (vs) {
      this._viewStates.delete(oldPath);
      this._viewStates.set(newPath, vs);
    }
  }

  /**
   * 文件删除：释放 slot / model / viewState
   */
  handleFileDeleted(path: string): void {
    this._disposeSlot(path);
    this._disposePreloadedModel(path);
    this._viewStates.delete(path);

    if (this._activeSlotPath === path) {
      this._activeSlotPath = null;
    }
  }

  /**
   * 批量处理文件夹删除
   */
  handleDirectoryDeleted(dirPath: string): void {
    const prefix =
      dirPath.endsWith("/") || dirPath.endsWith("\\") ? dirPath : dirPath + "/";
    const altPrefix =
      dirPath.endsWith("/") || dirPath.endsWith("\\")
        ? dirPath
        : dirPath + "\\";

    const matchesPrefix = (p: string) =>
      p.startsWith(prefix) || p.startsWith(altPrefix);

    for (const path of [...this._slots.keys()]) {
      if (matchesPrefix(path)) this.handleFileDeleted(path);
    }
    for (const path of [...this._preloadedModels.keys()]) {
      if (matchesPrefix(path)) this._disposePreloadedModel(path);
    }
    for (const path of [...this._viewStates.keys()]) {
      if (matchesPrefix(path)) this._viewStates.delete(path);
    }
  }

  // ══════════════════════════════════════════════════
  //  选项更新
  // ══════════════════════════════════════════════════

  /** 更新所有 editor 实例的选项（如 minimap、字体等） */
  updateOptions(
    options: editor.IEditorOptions & editor.IGlobalEditorOptions,
  ): void {
    Object.assign(this._editorOptions, options);
    for (const slot of this._slots.values()) {
      slot.editor.updateOptions(options);
    }
  }

  /** 更新管理器配置 */
  updateConfig(config: Partial<EditorManagerConfig>): void {
    if (config.maxSlots !== undefined) this._maxSlots = config.maxSlots;
    if (config.maxPreloadedModels !== undefined)
      this._maxPreloadedModels = config.maxPreloadedModels;
    if (config.slotIdleTimeoutMs !== undefined)
      this._slotIdleTimeoutMs = config.slotIdleTimeoutMs;
    if (config.modelIdleTimeoutMs !== undefined)
      this._modelIdleTimeoutMs = config.modelIdleTimeoutMs;
  }

  // ══════════════════════════════════════════════════
  //  主题
  // ══════════════════════════════════════════════════

  /** 设置所有 editor 的主题 */
  setTheme(theme: string): void {
    this._monaco?.editor.setTheme(theme);
  }

  // ══════════════════════════════════════════════════
  //  工作区操作
  // ══════════════════════════════════════════════════

  /**
   * 关闭指定路径的 slot（释放资源）
   *
   * 当用户关闭 tab 时调用。
   * viewState 会被保留（除非明确移除），以便短时间内重新打开时恢复。
   */
  closeSlot(path: string): void {
    this._disposeSlot(path);
    if (this._activeSlotPath === path) {
      this._activeSlotPath = null;
    }
  }

  /**
   * 关闭所有 slot 和预加载 model（工作区切换时调用）
   *
   * 保留 viewState 缓存。
   */
  closeAll(): void {
    for (const path of [...this._slots.keys()]) {
      this._disposeSlot(path);
    }
    for (const path of [...this._preloadedModels.keys()]) {
      this._disposePreloadedModel(path);
    }
    this._activeSlotPath = null;
    this._lruOrder = [];
  }

  // ══════════════════════════════════════════════════
  //  生命周期
  // ══════════════════════════════════════════════════

  /**
   * 完全销毁管理器（应用关闭时调用）
   *
   * 释放所有 editor 实例、model、DOM 节点、定时器。
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // 停止 GC
    if (this._gcTimer) {
      clearInterval(this._gcTimer);
      this._gcTimer = null;
    }

    // 清理所有 rAF
    for (const rafId of this._rafIds.values()) {
      cancelAnimationFrame(rafId);
    }
    this._rafIds.clear();

    // 销毁 ResizeObserver
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    // 销毁所有 slots
    for (const path of [...this._slots.keys()]) {
      this._disposeSlot(path);
    }

    // 销毁所有预加载 models
    for (const path of [...this._preloadedModels.keys()]) {
      this._disposePreloadedModel(path);
    }

    // 清理状态
    this._viewStates.clear();
    this._lruOrder = [];
    this._activeSlotPath = null;
    this._monaco = null;
  }

  /** 检查是否已销毁 */
  isDisposed(): boolean {
    return this._disposed;
  }

  // ══════════════════════════════════════════════════
  //  调试 / 监控
  // ══════════════════════════════════════════════════

  /** 获取当前状态快照 */
  getStats(): {
    slotCount: number;
    preloadedModelCount: number;
    viewStateCount: number;
    activeSlotPath: string | null;
    lruOrder: string[];
    slots: Array<{
      path: string;
      attached: boolean;
      lastActiveAt: number;
    }>;
  } {
    return {
      slotCount: this._slots.size,
      preloadedModelCount: this._preloadedModels.size,
      viewStateCount: this._viewStates.size,
      activeSlotPath: this._activeSlotPath,
      lruOrder: [...this._lruOrder],
      slots: [...this._slots.values()].map((s) => ({
        path: s.path,
        attached: s.attached,
        lastActiveAt: s.lastActiveAt,
      })),
    };
  }

  // ══════════════════════════════════════════════════
  //  内部方法：slot 创建与管理
  // ══════════════════════════════════════════════════

  /**
   * 创建一个新的 editor slot
   */
  private _createSlot(
    path: string,
    model: editor.ITextModel,
    onDidCreate?: AttachOptions["onDidCreate"],
    onDidChangeContent?: AttachOptions["onDidChangeContent"],
  ): EditorSlot {
    const monaco = this._monaco!;

    // 创建独立的 DOM wrapper（不在 React 树中，不会被 React 销毁）
    const wrapper = document.createElement("div");
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    wrapper.style.position = "absolute";
    wrapper.style.top = "0";
    wrapper.style.left = "0";
    wrapper.dataset.editorPath = path;

    // 创建 editor 实例
    const ed = monaco.editor.create(wrapper, {
      model,
      ...this._editorOptions,
    });

    const disposables: Monaco.IDisposable[] = [];

    // 创建 slot 对象（onContentChange 是可变引用）
    const slot: EditorSlot = {
      path,
      editor: ed,
      wrapper,
      attached: false,
      lastActiveAt: Date.now(),
      disposables,
      onContentChange: onDidChangeContent ?? null,
    };

    // 注册 ResizeObserver
    if (this._resizeObserver) {
      this._resizeObserver.observe(wrapper);
      disposables.push({
        dispose: () => {
          this._resizeObserver?.unobserve(wrapper);
          const rafId = this._rafIds.get(path);
          if (rafId !== undefined) {
            cancelAnimationFrame(rafId);
            this._rafIds.delete(path);
          }
        },
      });
    }

    // 注册内容变化监听（通过 slot.onContentChange 间接引用，支持闭包替换）
    disposables.push(
      ed.onDidChangeModelContent(() => {
        slot.onContentChange?.(ed.getValue());
      }),
    );

    // 调用外部创建回调（注册快捷键、右键菜单等）
    if (onDidCreate) {
      const extraDisposables = onDidCreate(ed, monaco);
      disposables.push(...extraDisposables);
    }

    this._slots.set(path, slot);
    return slot;
  }

  /**
   * 将 slot 的 DOM 挂载到指定容器并恢复状态
   */
  private _attachSlot(slot: EditorSlot, container: HTMLElement): void {
    if (slot.attached && slot.wrapper.parentElement === container) {
      // 已经挂在同一个容器里，只需 layout + focus
      slot.lastActiveAt = Date.now();
      requestAnimationFrame(() => {
        if (slot.attached) {
          slot.editor.layout();
          slot.editor.focus();
        }
      });
      return;
    }

    // 如果挂在别的容器里，先 detach DOM
    if (slot.attached) {
      this._removeFromDom(slot);
    }

    // 确保容器支持绝对定位子元素
    const pos = getComputedStyle(container).position;
    if (pos === "static" || pos === "") {
      container.style.position = "relative";
    }

    container.appendChild(slot.wrapper);
    slot.attached = true;
    slot.lastActiveAt = Date.now();

    // 恢复 viewState（光标/滚动位置）
    const viewState = this._viewStates.get(slot.path);
    if (viewState) {
      slot.editor.restoreViewState(viewState);
    }

    // layout + focus（在下一帧，确保 DOM 尺寸已确定）
    requestAnimationFrame(() => {
      if (slot.attached) {
        slot.editor.layout();
        slot.editor.focus();
      }
    });
  }

  /**
   * 分离 slot：保存 viewState 并从 DOM 中移除
   */
  private _detachSlot(path: string): void {
    const slot = this._slots.get(path);
    if (!slot || !slot.attached) return;

    // 保存 viewState
    const state = slot.editor.saveViewState();
    if (state) {
      this._viewStates.set(path, state);
    }

    this._removeFromDom(slot);
  }

  /**
   * DOM 层面移除 wrapper（不保存 viewState）
   */
  private _removeFromDom(slot: EditorSlot): void {
    if (slot.wrapper.parentElement) {
      slot.wrapper.parentElement.removeChild(slot.wrapper);
    }
    slot.attached = false;
  }

  /**
   * 彻底销毁一个 slot：释放 editor + model + DOM + 事件
   */
  private _disposeSlot(path: string): void {
    const slot = this._slots.get(path);
    if (!slot) return;

    // 最后机会保存 viewState
    if (slot.attached) {
      try {
        const state = slot.editor.saveViewState();
        if (state) this._viewStates.set(path, state);
      } catch {
        // editor 可能已经处于异常状态
      }
    }

    // 从 DOM 移除
    this._removeFromDom(slot);

    // dispose 所有注册的事件
    for (const d of slot.disposables) {
      try {
        d.dispose();
      } catch {
        // 忽略 dispose 错误
      }
    }
    slot.disposables.length = 0;
    slot.onContentChange = null;

    // dispose model（如果还活着）
    try {
      const model = slot.editor.getModel();
      if (model && !model.isDisposed()) {
        model.dispose();
      }
    } catch {
      // 忽略
    }

    // dispose editor
    try {
      slot.editor.dispose();
    } catch {
      // 忽略
    }

    // 从 Map 和 LRU 中移除
    this._slots.delete(path);
    const lruIdx = this._lruOrder.indexOf(path);
    if (lruIdx !== -1) {
      this._lruOrder.splice(lruIdx, 1);
    }
  }

  /**
   * 销毁一个预加载的 model
   */
  private _disposePreloadedModel(path: string): void {
    const preloaded = this._preloadedModels.get(path);
    if (!preloaded) return;

    try {
      if (!preloaded.model.isDisposed()) {
        preloaded.model.dispose();
      }
    } catch {
      // 忽略
    }
    this._preloadedModels.delete(path);
  }

  // ══════════════════════════════════════════════════
  //  内部方法：model 管理
  // ══════════════════════════════════════════════════

  /**
   * 获取或创建 model
   *
   * 优先级：已有 model → 预加载 model → 新建 model
   */
  private _getOrCreateModel(
    path: string,
    content: string,
    language: string,
  ): editor.ITextModel {
    const monaco = this._monaco!;
    const uri = monaco.Uri.parse(this._pathToUri(path));

    // 1. 已有的 Monaco model（可能来自其他途径创建）
    const existingModel = monaco.editor.getModel(uri);
    if (existingModel && !existingModel.isDisposed()) {
      this._preloadedModels.delete(path);
      return existingModel;
    }

    // 2. 预加载 model
    const preloaded = this._preloadedModels.get(path);
    if (preloaded && !preloaded.model.isDisposed()) {
      this._preloadedModels.delete(path);
      return preloaded.model;
    }
    if (preloaded) {
      // model 已被 dispose，清理残留引用
      this._preloadedModels.delete(path);
    }

    // 3. 新建 model
    return monaco.editor.createModel(content, language, uri);
  }

  /**
   * 将文件路径转为 Monaco URI 字符串
   *
   * 统一使用 file:/// 前缀，将反斜杠替换为正斜杠
   */
  private _pathToUri(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    return `file:///${normalized}`;
  }

  // ══════════════════════════════════════════════════
  //  内部方法：LRU 与 GC
  // ══════════════════════════════════════════════════

  /**
 更新 LRU 顺序（将 path 移到末尾 = 最新） */
  private _touchLru(path: string): void {
    const idx = this._lruOrder.indexOf(path);
    if (idx !== -1) {
      this._lruOrder.splice(idx, 1);
    }
    this._lruOrder.push(path);
  }

  /** 确保 slot 数量不超限，回收最旧且非活跃的 slot */
  private _ensureSlotCapacity(): void {
    while (this._slots.size >= this._maxSlots && this._lruOrder.length > 0) {
      // 从 LRU 头部（最旧）开始找，跳过当前激活的
      const candidatePath = this._lruOrder.find(
        (p) => p !== this._activeSlotPath,
      );
      if (!candidatePath) break;
      this._disposeSlot(candidatePath);
    }
  }

  /** 确保预加载 model 数量不超限 */
  private _ensurePreloadCapacity(): void {
    if (this._preloadedModels.size < this._maxPreloadedModels) return;

    // 按创建时间排序，淘汰最旧的
    const entries = [...this._preloadedModels.entries()].sort(
      (a, b) => a[1].createdAt - b[1].createdAt,
    );

    const toRemove = entries.slice(
      0,
      this._preloadedModels.size - this._maxPreloadedModels + 1,
    );

    for (const [path] of toRemove) {
      this._disposePreloadedModel(path);
    }
  }

  /** 定期 GC：回收空闲超时的 slot 和预加载 model */
  private _gc(): void {
    if (this._disposed) return;
    const now = Date.now();

    // 回收空闲 slots（不回收正在 attach 的）
    for (const [path, slot] of this._slots) {
      if (path === this._activeSlotPath) continue;
      if (slot.attached) continue;
      if (now - slot.lastActiveAt > this._slotIdleTimeoutMs) {
        this._disposeSlot(path);
      }
    }

    // 回收空闲预加载 models
    for (const [path, preloaded] of this._preloadedModels) {
      if (now - preloaded.createdAt > this._modelIdleTimeoutMs) {
        this._disposePreloadedModel(path);
      }
    }
  }
}

// ══════════════════════════════════════════════════════
//  导出
// ══════════════════════════════════════════════════════

/**
 * EditorManager 全局单例
 *
 * 用法：
 *
 * ```ts
 * import { editorManager } from "@ftre/editor/core";
 * import * as monaco from "monaco-editor";
 *
 * // 1. 初始化（应用启动时调用一次）
 * editorManager.init(monaco);
 *
 * // 2. 预加载（用户 hover 文件树时）
 * editorManager.preloadModel("/src/app.ts", content, "typescript");
 *
 * // 3. 打开文件
 * const editor = editorManager.attach({
 *   path: "/src/app.ts",
 *   language: "typescript",
 *   content: fileContent,
 *   container: containerRef.current!,
 *   onDidCreate: (editor, monaco) => {
 *     editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save());
 *     return []; // IDisposable[]
 *   },
 *   onDidChangeContent: (content) => {
 *     editorCore.setContent(path, content);
 *   },
 * });
 *

 * // 4. 切换 tab（核心优化点：不销毁不重建，只移动 DOM）
 * // editorManager.attach() 内部会自动 detach 旧的
 *
 * // 5. 关闭 tab
 * editorManager.closeSlot("/src/app.ts");
 *
 * // 6. 应用退出
 * editorManager.dispose();
 * ```
 */
export const editorManager = new EditorManagerImpl();

/**
 * 创建一个新的 EditorManager 实例（用于测试或多工作区场景）
 */
export function createEditorManager(
  config?: EditorManagerConfig,
): EditorManagerImpl {
  return new EditorManagerImpl(config);
}

/** EditorManager 类型（用于依赖注入/类型标注） */
export type EditorManager = EditorManagerImpl;
