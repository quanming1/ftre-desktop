/**
 * SlotPool — Monaco 编辑器实例池
 *
 * 专注于管理 Monaco 编辑器实例的创建、复用和 DOM 挂载。
 * 与 Document 配合：Document 负责内容和状态，SlotPool 负责渲染。
 *
 * 核心设计：
 * 1. 实例复用：切换 tab 时只做 DOM 挂载/卸载，不销毁 Monaco 实例
 * 2. LRU 回收：超过 maxSlots 时回收最不活跃的实例
 * 3. 分离关注点：不关心内容加载，只关心"给我一个能渲染的编辑器"
 */

import type { editor } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import type { Document } from "./document";
import { getDocumentManager } from "./document-manager";

interface Slot {
  path: string;
  editor: editor.IStandaloneCodeEditor;
  wrapper: HTMLDivElement;
  attached: boolean;
  lastActiveAt: number;
  disposables: Monaco.IDisposable[];
  onContentChange: ((content: string) => void) | null;
}

export interface SlotPoolConfig {
  maxSlots?: number;
  editorOptions?: editor.IStandaloneEditorConstructionOptions;
}

export interface AcquireOptions {
  doc: Document;
  container: HTMLElement;
  onDidCreate?: (
    editor: editor.IStandaloneCodeEditor,
    monaco: typeof Monaco,
  ) => Monaco.IDisposable[];
  onDidChangeContent?: (content: string) => void;
}

const DEFAULT_MAX_SLOTS = 8;

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

class SlotPoolImpl {
  private _monaco: typeof Monaco | null = null;
  private _slots = new Map<string, Slot>();
  private _lruOrder: string[] = [];
  private _activeSlotPath: string | null = null;
  private _maxSlots: number;
  private _editorOptions: editor.IStandaloneEditorConstructionOptions;
  private _resizeObserver: ResizeObserver | null = null;
  private _rafIds = new Map<string, number>();
  private _disposed = false;

  constructor(config?: SlotPoolConfig) {
    this._maxSlots = config?.maxSlots ?? DEFAULT_MAX_SLOTS;
    this._editorOptions = {
      ...DEFAULT_EDITOR_OPTIONS,
      ...(config?.editorOptions ?? {}),
    };
  }

  init(monaco: typeof Monaco): void {
    if (this._disposed) return;
    this._monaco = monaco;

    if (!this._resizeObserver) {
      this._resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const wrapper = entry.target as HTMLDivElement;
          const path = wrapper.dataset.editorPath;
          if (!path) continue;

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

  getMonaco(): typeof Monaco | null {
    return this._monaco;
  }

  isInitialized(): boolean {
    return this._monaco !== null && !this._disposed;
  }

  /**
   * 获取或创建编辑器实例，挂载到 container，并绑定 Document 的 Model
   */
  acquire(options: AcquireOptions): editor.IStandaloneCodeEditor | null {
    if (this._disposed || !this._monaco) return null;

    const { doc, container, onDidCreate, onDidChangeContent } = options;
    const path = doc.path;

    if (doc.state !== "loaded" || !doc.model) {
      console.warn(`[SlotPool] Document not loaded: ${path}`);
      return null;
    }

    if (this._activeSlotPath && this._activeSlotPath !== path) {
      this._detachSlot(this._activeSlotPath);
    }

    let slot = this._slots.get(path);

    if (slot) {
      slot.onContentChange = onDidChangeContent ?? null;

      const currentModel = slot.editor.getModel();
      if (currentModel !== doc.model) {
        slot.editor.setModel(doc.model);
      }

      this._attachSlot(slot, container, doc);
      this._touchLru(path);
      this._activeSlotPath = path;
      return slot.editor;
    }

    this._ensureSlotCapacity();

    slot = this._createSlot(path, doc, onDidCreate, onDidChangeContent);
    this._attachSlot(slot, container, doc);
    this._touchLru(path);
    this._activeSlotPath = path;

    return slot.editor;
  }

  /**
   * 释放实例（隐藏 DOM，将实例放回池中）
   */
  release(path: string, doc?: Document): void {
    const slot = this._slots.get(path);
    if (!slot) return;

    if (doc && slot.attached) {
      const state = slot.editor.saveViewState();
      if (state) {
        doc.saveViewState(state);
      }
    }

    this._detachSlot(path);

    if (this._activeSlotPath === path) {
      this._activeSlotPath = null;
    }
  }

  /**
   * 释放当前活跃的编辑器
   */
  releaseActive(doc?: Document): void {
    if (this._activeSlotPath) {
      this.release(this._activeSlotPath, doc);
    }
  }

  /**
   * 销毁实例（真正释放内存）
   */
  disposeSlot(path: string): void {
    this._disposeSlot(path);
    if (this._activeSlotPath === path) {
      this._activeSlotPath = null;
    }
  }

  getEditor(path: string): editor.IStandaloneCodeEditor | null {
    return this._slots.get(path)?.editor ?? null;
  }

  getActiveEditor(): editor.IStandaloneCodeEditor | null {
    if (!this._activeSlotPath) return null;
    return this._slots.get(this._activeSlotPath)?.editor ?? null;
  }

  getActivePath(): string | null {
    return this._activeSlotPath;
  }

  hasSlot(path: string): boolean {
    return this._slots.has(path);
  }

  updateOptions(
    options: editor.IEditorOptions & editor.IGlobalEditorOptions,
  ): void {
    Object.assign(this._editorOptions, options);
    for (const slot of this._slots.values()) {
      slot.editor.updateOptions(options);
    }
  }

  setTheme(theme: string): void {
    this._monaco?.editor.setTheme(theme);
  }

  closeAll(): void {
    for (const path of [...this._slots.keys()]) {
      this._disposeSlot(path);
    }
    this._activeSlotPath = null;
    this._lruOrder = [];
  }

  /**
   * 获取统计信息（用于内存监控）
   */
  getStats(): {
    slotCount: number;
    maxSlots: number;
    attachedCount: number;
    slotPaths: string[];
  } {
    let attachedCount = 0;
    for (const slot of this._slots.values()) {
      if (slot.attached) attachedCount++;
    }
    return {
      slotCount: this._slots.size,
      maxSlots: this._maxSlots,
      attachedCount,
      slotPaths: [...this._slots.keys()],
    };
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    for (const rafId of this._rafIds.values()) {
      cancelAnimationFrame(rafId);
    }
    this._rafIds.clear();

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    for (const path of [...this._slots.keys()]) {
      this._disposeSlot(path);
    }

    this._lruOrder = [];
    this._activeSlotPath = null;
    this._monaco = null;
  }

  isDisposed(): boolean {
    return this._disposed;
  }

  private _createSlot(
    path: string,
    doc: Document,
    onDidCreate?: AcquireOptions["onDidCreate"],
    onDidChangeContent?: AcquireOptions["onDidChangeContent"],
  ): Slot {
    const monaco = this._monaco!;

    const wrapper = document.createElement("div");
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    wrapper.style.position = "absolute";
    wrapper.style.top = "0";
    wrapper.style.left = "0";
    wrapper.dataset.editorPath = path;

    const ed = monaco.editor.create(wrapper, {
      model: doc.model,
      ...this._editorOptions,
    });

    const disposables: Monaco.IDisposable[] = [];

    const slot: Slot = {
      path,
      editor: ed,
      wrapper,
      attached: false,
      lastActiveAt: Date.now(),
      disposables,
      onContentChange: onDidChangeContent ?? null,
    };

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

    disposables.push(
      ed.onDidChangeModelContent(() => {
        slot.onContentChange?.(ed.getValue());
      }),
    );

    if (onDidCreate) {
      const extraDisposables = onDidCreate(ed, monaco);
      disposables.push(...extraDisposables);
    }

    this._slots.set(path, slot);
    return slot;
  }

  private _attachSlot(slot: Slot, container: HTMLElement, doc: Document): void {
    if (slot.attached && slot.wrapper.parentElement === container) {
      slot.lastActiveAt = Date.now();
      requestAnimationFrame(() => {
        if (slot.attached) {
          slot.editor.layout();
          slot.editor.focus();
        }
      });
      return;
    }

    if (slot.attached) {
      this._removeFromDom(slot);
    }

    const pos = getComputedStyle(container).position;
    if (pos === "static" || pos === "") {
      container.style.position = "relative";
    }

    container.appendChild(slot.wrapper);
    slot.attached = true;
    slot.lastActiveAt = Date.now();

    const viewState = doc.getViewState();
    if (viewState) {
      slot.editor.restoreViewState(viewState);
    }

    requestAnimationFrame(() => {
      if (slot.attached) {
        slot.editor.layout();
        slot.editor.focus();
      }
    });
  }

  private _detachSlot(path: string): void {
    const slot = this._slots.get(path);
    if (!slot || !slot.attached) return;
    this._removeFromDom(slot);
  }

  private _removeFromDom(slot: Slot): void {
    if (slot.wrapper.parentElement) {
      slot.wrapper.parentElement.removeChild(slot.wrapper);
    }
    slot.attached = false;
  }

  private _disposeSlot(path: string): void {
    const slot = this._slots.get(path);
    if (!slot) return;

    this._removeFromDom(slot);

    for (const d of slot.disposables) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
    slot.disposables.length = 0;
    slot.onContentChange = null;

    try {
      slot.editor.dispose();
    } catch {
      // ignore
    }

    this._slots.delete(path);
    const lruIdx = this._lruOrder.indexOf(path);
    if (lruIdx !== -1) {
      this._lruOrder.splice(lruIdx, 1);
    }
  }

  private _touchLru(path: string): void {
    const idx = this._lruOrder.indexOf(path);
    if (idx !== -1) {
      this._lruOrder.splice(idx, 1);
    }
    this._lruOrder.push(path);
  }

  private _ensureSlotCapacity(): void {
    while (this._slots.size >= this._maxSlots && this._lruOrder.length > 0) {
      const candidatePath = this._lruOrder.find(
        (p) => p !== this._activeSlotPath,
      );
      if (!candidatePath) break;

      // Save viewState before evicting the slot
      const slot = this._slots.get(candidatePath);
      if (slot) {
        const doc = getDocumentManager().get(candidatePath);
        if (doc && slot.attached) {
          const state = slot.editor.saveViewState();
          if (state) {
            doc.saveViewState(state);
          }
        }
      }

      this._disposeSlot(candidatePath);
    }
  }
}

export type SlotPool = SlotPoolImpl;

let _slotPool: SlotPoolImpl | null = null;

export function getSlotPool(): SlotPoolImpl {
  if (!_slotPool) {
    _slotPool = new SlotPoolImpl();
  }
  return _slotPool;
}

export function createSlotPool(config?: SlotPoolConfig): SlotPoolImpl {
  _slotPool = new SlotPoolImpl(config);
  return _slotPool;
}
