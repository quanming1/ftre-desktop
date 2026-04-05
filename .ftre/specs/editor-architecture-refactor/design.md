> ⚠️ **设计阶段文档** — 实际实现与本文档有差异。以代码和 `.ftre/agents_def/editor-guardian/AGENT.md` 为准。

# 技术设计：Editor Architecture Refactor

> **架构概要：** 将现有的补丁式编辑器架构重构为基于“单一内容源（Single Source of Truth）”和“状态机驱动”的清晰分层架构。通过引入 `Document` 实体来管理文件内容的生命周期和跨平台元数据，分离 `SlotPool` 以专注管理 Monaco 实例复用，从而解决内容同步困难、跨平台行尾符/BOM 导致的 `isDirty` 误报以及工作区切换时的缓存问题。

## 涉及文件

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| 新建 | `packages/editor/src/core/document.ts` | 定义 `Document` 实体，管理单个文件的状态机、内容、元数据（编码/BOM/行尾符）和 Dirty 判断。 |
| 新建 | `packages/editor/src/core/document-manager.ts` | 管理所有 `Document` 实例的生命周期（打开/关闭/休眠/激活），替代 `editorCore` 的工作区快照功能。 |
| 新建 | `packages/editor/src/core/slot-pool.ts` | 专注管理 Monaco 编辑器实例的创建、复用和 DOM 挂载（Attach/Detach），实现 LRU 回收机制。 |
| 修改 | `packages/editor/src/ui/ManagedEditor.tsx` | 退化为纯 UI 组件，移除所有内容同步、Dirty 判断逻辑，仅负责监听 `Document` 状态变化并在 `Loaded` 状态时从 `SlotPool` 获取编辑器实例并挂载。 |
| 删除 | `packages/editor/src/core/editor-core.ts` | 旧的核心状态管理，内容被分散存储，容易引发不同步，被新架构取代。 |
| 删除 | `packages/editor/src/core/editor-manager.ts` | 旧的实例管理器，职责不纯（混杂了内容管理和预加载逻辑），被拆分为 `DocumentManager` 和 `SlotPool`。 |

## 现有代码意图分析

**1. `editorCore.ts` 与 `editor-manager.ts` 的现状**
- **意图：** `editorCore` 试图将文件内容从 React 状态中抽离，作为非响应式的全局数据源（`contents` / `diskContents`）；`editor-manager` 试图通过复用 Monaco 实例来优化性能（池化设计）。
- **问题：** 
  - **三重数据源同步灾难：** 文件内容同时存在于 Monaco model 内部、`editorCore.contents` 和外部 React Store（`file.content`）。必须在多个生命周期钩子中手动同步，极易出现时序 BUG（如灰色空白）。
  - **跨平台支持薄弱：** `isDirty` 通过直接比较 `contents` 和 `diskContents` 判断。但 Monaco 在创建 model 时会自动规范化内容（如处理 BOM、转换行尾符为 LF），这会导致原始磁盘内容与规范化内容比对永远失败，出现“刚打开文件就提示被修改”的现象。
  - **缓存机制僵硬：** 切换工作区时通过 `snapshotForWorkspace` 暴力全量复制 Map。这既耗费内存，又在重新加载时容易导致状态丢失。

**2. `ManagedEditor.tsx` 的现状**
- **意图：** 作为 React 到 Monaco 的桥梁，负责在 Tab 激活时显示对应的编辑器。
- **问题：** 承担了太多非 UI 职责（文件懒加载触发、Dirty 状态检测与向上传递、Monaco 初始化轮询等）。大量相互依赖的 `useEffect` 导致补丁越打越多。

## 架构决策

**1. 确立单一内容源与状态机驱动**
- **决策：** 废弃 `editorCore`，引入 `Document` 类。
- **理由：** `Document` 封装了单个文件的完整生命周期。它的内部有一个明确的状态机：`IDLE` → `LOADING` → `LOADED` (持有 Monaco Model) → `HIBERNATED` (释放 Model 保留缓存) → `CLOSED`。内容始终以 Monaco Model 为准，彻底消灭同步问题。

**2. 跨平台元数据隔离与哈希校验**
- **决策：** `Document` 加载文件时提取并保存原始格式（BOM、编码、CRLF/LF），存入 Monaco 前统一规范化为 LF。
- **理由：** `diskHash` 只存储规范化后内容的 Hash 值。`isDirty()` 通过比对 `hash(monaco.getValue())` 与 `diskHash`，彻底解决平台差异导致的误报。保存文件时，根据保存的元数据还原原始格式输出。

**3. 工作区切换的 Hibernate 机制**
- **决策：** 切换工作区或内存告急时，调用 `Document.hibernate()`，而不是销毁或做全局快照。
- **理由：** `hibernate()` 会销毁庞大的 Monaco Model，但将当前内容提取为普通字符串（`_cache`）并保存 `viewState`。当切回工作区再次打开时，调用 `activate()` 从缓存恢复 Model。这完美兼容了“跨工作区保留未保存修改”的需求，且内存占用极小。

**4. 拆分实例管理为 SlotPool**
- **决策：** `SlotPool` 仅负责“提供一个带有 DOM 的 Monaco Editor 实例”，不再关心内容加载和预加载。
- **理由：** 分离关注点。UI 层 (`ManagedEditor`) 拿着 `Document` 找 `SlotPool` 要求分配一个编辑器实例，实现纯粹的视图挂载。

## 接口设计

### 1. Document 类（核心状态机）

```typescript
export type DocState = 'idle' | 'loading' | 'loaded' | 'hibernated';

export class Document {
  readonly path: string;
  readonly language: string;
  
  // 状态机
  get state(): DocState;
  
  // 核心操作
  async load(bridge: HostBridge): Promise<void>;
  hibernate(): void;
  activate(): void;
  dispose(): void;
  
  // 读写接口
  getContent(): string;          // 无论在 Loaded 还是 Hibernated 都能正确返回
  getContentForSave(): string;   // 返回恢复了原始 BOM 和行尾符的字符串
  isDirty(): boolean;            // 基于规范化 Hash 比对
  markSaved(): void;             // 更新 diskHash
  
  // 视图状态
  saveViewState(state: editor.ICodeEditorViewState): void;
  getViewState(): editor.ICodeEditorViewState | null;
}
```

### 2. DocumentManager

```typescript
export class DocumentManager {
  // 获取或创建 Document
  open(path: string, language: string): Document;
  
  // 获取已存在的 Document
  get(path: string): Document | undefined;
  
  // 工作区切换时：休眠指定路径前缀外的所有文档
  hibernateOthers(activePrefix: string): void;
  
  // 关闭未保存的文档
  close(path: string): void;
}
```

### 3. SlotPool

```typescript
export class SlotPool {
  // 分配一个编辑器实例，挂载到 container，并绑定 Document 的 Model
  acquire(doc: Document, container: HTMLElement): editor.IStandaloneCodeEditor;
  
  // 释放实例（隐藏 DOM，将实例放回池中）
  release(path: string): void;
  
  // 销毁实例（真正释放内存）
  dispose(path: string): void;
}
```

## UI 层改造 (ManagedEditor.tsx)

重构后，`ManagedEditor` 的职责被极大削减，不再包含复杂的 Effect 链：

1. 从 `DocumentManager` 获取/创建 `Document`
2. 如果 `doc.state === 'idle'`，触发 `doc.load()`
3. 如果 `doc.state === 'loading'`，显示 Loading 占位符
4. 如果 `doc.state === 'loaded'` 或 `hibernated`（激活后变为 loaded），调用 `SlotPool.acquire` 将其挂载到自身的 `containerRef`
5. 监听组件卸载（tab 切换），调用 `SlotPool.release` 隐藏编辑器


架构图是怎么样的？文件目录结构怎么设计
我来设计一下重构后的架构：

架构图
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              @ftre/editor                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                           UI Layer                                       │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │   │
│  │  │ ManagedEditor   │  │ MonacoDiffViewer│  │ CodeBlock       │          │   │
│  │  │ (纯挂载,无逻辑) │  │                 │  │                 │          │   │
│  │  └────────┬────────┘  └─────────────────┘  └─────────────────┘          │   │
│  └───────────│──────────────────────────────────────────────────────────────┘   │
│              │                                                                  │
│              │ attach/detach                                                    │
│              ▼                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                         Core Layer                                       │   │
│  │                                                                          │   │
│  │  ┌─────────────────────────┐     ┌─────────────────────────┐            │   │
│  │  │    DocumentManager      │     │     SlotPool            │            │   │
│  │  │    ─────────────────    │     │     ────────            │            │   │
│  │  │    documents: Map       │     │     slots: Map          │            │   │
│  │  │    ─────────────────    │     │     maxSlots: 8         │            │   │
│  │  │    open(path)           │◄───►│     acquire(doc)        │            │   │
│  │  │    close(path)          │     │     release(path)       │            │   │
│  │  │    save(path)           │     │     getEditor(path)     │            │   │
│  │  │    isDirty(path)        │     │                         │            │   │
│  │  └───────────┬─────────────┘     └────────────┬────────────┘            │   │
│  │              │                                │                          │   │
│  │              │ owns                           │ creates                  │   │
│  │              ▼                                ▼                          │   │
│  │  ┌─────────────────────────┐     ┌─────────────────────────┐            │   │
│  │  │    Document (class)     │     │     Slot (interface)    │            │   │
│  │  │    ─────────────────    │     │     ────────────────    │            │   │
│  │  │    path: string         │     │     editor: IEditor     │            │   │
│  │  │    model: ITextModel?   │     │     wrapper: HTMLDiv    │            │   │
│  │  │    diskHash: string     │     │     attached: boolean   │            │   │
│  │  │    state: DocState      │     │                         │            │   │
│  │  │    viewState: IViewState│     │                         │            │   │
│  │  │    ─────────────────    │     │                         │            │   │
│  │  │    isDirty()            │     │                         │            │   │
│  │  │    getContent()         │     │                         │            │   │
│  │  └─────────────────────────┘     └─────────────────────────┘            │   │
│  │                                                                          │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                       Runtime Layer                                      │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │   │
│  │  │ MonacoLoader    │  │ HostBridge      │  │ EventBus        │          │   │
│  │  │ (异步加载Monaco)│  │ (与宿主通信)    │  │ (内部事件)      │          │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘          │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                       Store Layer (对外暴露给 renderer)                  │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐    │   │
│  │  │  editorStore (Zustand)                                          │    │   │
│  │  │  ─────────────────────                                          │    │   │
│  │  │  openFiles: OpenFile[]      ← 只关心"打开了哪些文件"            │    │   │
│  │  │  activeFile: string | null  ← 不存储内容，内容在 Document 里     │    │   │
│  │  │  groups: EditorGroup[]                                          │    │   │
│  │  └─────────────────────────────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘


Document 状态机：

  ┌─────────┐   open()    ┌─────────┐  model ready  ┌─────────┐
  │  IDLE   │ ──────────► │ LOADING │ ────────────► │ LOADED  │
  └─────────┘             └─────────┘               └────┬────┘
                                                         │ attach()
                                                         ▼
  ┌─────────┐   close()   ┌─────────┐   detach()   ┌─────────┐
  │ CLOSED  │ ◄────────── │ DETACHED│ ◄─────────── │ ATTACHED│
  └─────────┘             └─────────┘               └─────────┘
目录结构
packages/editor/src/
├── index.ts                    # 统一导出
│
├── core/
│   ├── index.ts                # core 层导出
│   ├── document.ts             # Document 类（单个文件的状态和内容）
│   ├── document-manager.ts     # DocumentManager（管理所有 Document）
│   ├── slot-pool.ts            # SlotPool（Monaco 实例池，纯 DOM 操作）
│   └── types.ts                # 核心类型定义
│
├── runtime/
│   ├── index.ts                # runtime 层导出
│   ├── monaco-loader.ts        # Monaco 异步加载器
│   ├── host-bridge.ts          # 与宿主（Electron/Web）通信
│   ├── event-bus.ts            # 内部事件总线
│   └── file-ops.ts             # 文件操作（读写保存）
│
├── store/
│   ├── index.ts                # store 层导出
│   ├── editor-store.ts         # Zustand store（只管 tab 列表）
│   └── types.ts                # Store 相关类型
│
└── ui/
    ├── index.ts                # UI 层导出
    ├── ManagedEditor.tsx       # 编辑器组件（极简，只做挂载）
    ├── MonacoDiffViewer.tsx    # Diff 视图
    ├── CodeBlock.tsx           # 代码块渲染
    └── themes/
        ├── index.ts
        ├── theme-registry.ts
        └── darcula.ts
关键设计点
1. Document 类 — 单一内容源


Copy
class Document {
  readonly path: string;
  private _model: ITextModel | null = null;
  private _diskHash: string = "";        // 磁盘内容的 hash
  private _state: DocState = "idle";
  private _viewState: IViewState | null = null;

  // 内容只从 model 获取，不另存
  getContent(): string {
    return this._model?.getValue() ?? "";
  }

  // dirty = 当前内容 hash !== 磁盘 hash
  isDirty(): boolean {
    if (!this._model) return false;
    return hash(this._model.getValue()) !== this._diskHash;
  }

  // 保存后更新 diskHash
  markSaved(): void {
    this._diskHash = hash(this._model?.getValue() ?? "");
  }
}
2. SlotPool — 专注实例复用


Copy
class SlotPool {
  private slots = new Map<string, Slot>();
  private lru: string[] = [];
  
  // 获取或创建 slot，绑定 Document 的 model
  acquire(doc: Document, container: HTMLElement): IEditor;
  
  // 释放 slot（detach DOM，保留实例）
  release(path: string): void;
  
  // 销毁 slot（真正释放）
  dispose(path: string): void;
}
3. ManagedEditor — 极简 UI


Copy
function ManagedEditor({ path }: { path: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const doc = documentManager.get(path);

  useEffect(() => {
    if (!doc || doc.state !== "loaded") return;
    const editor = slotPool.acquire(doc, containerRef.current!);
    return () => slotPool.release(path);
  }, [path, doc?.state]);

  if (!doc || doc.state === "loading") {
    return <Loading />;
  }

  return <div ref={containerRef} className="w-full h-full" />;
}
迁移策略
Phase 1: 新建 document.ts 和 document-manager.ts，与现有代码并存
Phase 2: 重构 slot-pool.ts（从 editor-manager.ts 拆分）
Phase 3: 简化 ManagedEditor.tsx，切换到新架构
Phase 4: 删除旧的 editor-core.ts
要开始实现吗？

别急  是否能解决不同平台的差异问题，是否能完美兼容目前的编辑器缓存设计？
思考
用户提出了两个关键问题： 1. **跨平台差异问题**： - Windows CRLF vs Unix LF - BOM (Byte Order …
好问题。让我分析一下这两个关键点：

1. 跨平台差异问题
现有问题：

只做了行尾符规范化 normalizeLineEndings，但是在比较时可能不一致
BOM、编码等没有处理
Monaco 内部会做自己的规范化，导致 isDirty 误报
新架构的解决方案：


Copy
class Document {
  readonly path: string;
  
  // ── 文件元数据（读取时检测，保存时恢复）──
  private _originalLineEnding: 'lf' | 'crlf' | 'mixed' = 'lf';
  private _encoding: BufferEncoding = 'utf-8';
  private _hasBom: boolean = false;
  
  // ── dirty 判断用 hash，不受规范化影响 ──
  private _diskHash: string = "";  // 磁盘内容规范化后的 hash
  
  isDirty(): boolean {
    // Monaco 内容已经是规范化的 LF
    // diskHash 也是规范化后算的
    // 所以比较是准确的
    return this._model ? hash(this._model.getValue()) !== this._diskHash : false;
  }
  
  // 保存时恢复原始格式
  getContentForSave(): string {
    let content = this._model?.getValue() ?? "";
    
    // 恢复原始行尾符
    if (this._originalLineEnding === 'crlf') {
      content = content.replace(/\n/g, '\r\n');
    }
    
    // 恢复 BOM
    if (this._hasBom) {
      content = '\ufeff' + content;
    }
    
    return content;
  }
}
关键点：

读取时检测并记录原始格式，存入 Monaco 前统一规范化
diskHash 是规范化后内容的 hash
保存时恢复原始格式
isDirty 比较的是规范化后的内容，不会误报
2. 编辑器缓存设计兼容性
现有设计（editorCore）：


Copy
// 工作区切换时快照/恢复
snapshotForWorkspace(workspace)   // 保存 contents + diskContents + viewStates
restoreFromWorkspace(workspace)   // 恢复
新架构需要解决的问题：

Monaco model 在 slot dispose 时不自动销毁，但内存占用大
切换工作区后，旧工作区的未保存修改需要保留
重新打开文件时需要恢复修改和光标位置
新架构的设计：

Document 生命周期（增加 HIBERNATED 状态）：

  ┌──────┐  open   ┌─────────┐  model   ┌────────┐
  │ IDLE │ ──────► │ LOADING │ ───────► │ LOADED │ ◄─── activate
  └──────┘         └─────────┘          └───┬────┘
                                            │
                          hibernate         │
                       (内存压力/工作区切换) │
                                            ▼
                                       ┌────────────┐
                                       │ HIBERNATED │
                                       │ ────────── │
                                       │ model = null
                                       │ cache = 内容
                                       │ diskHash ✓ │
                                       │ viewState ✓│
                                       └────────────┘

Copy
class Document {
  private _model: ITextModel | null = null;
  private _cache: string | null = null;     // hibernate 时缓存内容
  private _diskHash: string = "";
  private _viewState: IViewState | null = null;
  private _state: 'idle' | 'loading' | 'loaded' | 'hibernated' = 'idle';
  
  // ── 休眠：释放 model，保留内容到 cache ──
  hibernate(): void {
    if (this._state !== 'loaded' || !this._model) return;
    
    this._cache = this._model.getValue();
    this._viewState = /* 从 editor 获取 */;
    this._model.dispose();
    this._model = null;
    this._state = 'hibernated';
  }
  
  // ── 激活：从 cache 恢复 model ──
  activate(): void {
    if (this._state !== 'hibernated' || !this._cache) return;
    
    this._model = monaco.editor.createModel(this._cache, this._language, this._uri);
    this._cache = null;
    this._state = 'loaded';
  }
  
  // ── isDirty 在两种状态下都能工作 ──
  isDirty(): boolean {
    if (this._state === 'loaded' && this._model) {
      return hash(this._model.getValue()) !== this._diskHash;
    }
    if (this._state === 'hibernated' && this._cache) {
      return hash(this._cache) !== this._diskHash;
    }
    return false;
  }
  
  // ── 获取内容（不管什么状态）──
  getContent(): string {
    if (this._model) return this._model.getValue();
    if (this._cache) return this._cache;
    return "";
  }
}
工作区切换流程：


Copy
// DocumentManager
switchWorkspace(newWorkspace: string): void {
  // 1. 当前工作区所有 Document 休眠（释放 model，保留 cache）
  for (const doc of this._documents.values()) {
    doc.hibernate();
  }
  
  // 2. 不删除 Document，它们带着未保存的修改继续存在
  
  // 3. 新工作区的文件打开时，检查是否有已存在的 Document
  //    如果有且是 hibernated，activate 它
}
与现有设计的兼容：

现有 editorCore	新架构 Document
contents.get(path)	doc.getContent()
diskContents.get(path)	doc._diskHash（用 hash 代替全量存储）
isDirty(path)	doc.isDirty()
viewStates.get(path)	doc._viewState
snapshotForWorkspace()	不需要，Document 自带状态
restoreFromWorkspace()	不需要，activate() 恢复
总结
能解决跨平台问题：

文件元数据（行尾符/编码/BOM）存在 Document 里
编辑用规范化内容，保存时恢复原始格式
isDirty 用 hash 比较，不受规范化影响
能兼容现有缓存设计：

Document 增加 HIBERNATED 状态，释放 model 但保留 cache
工作区切换时休眠而不是删除，未保存修改保留
激活时从 cache 恢复 model
优于现有设计：

不再有"三份内容需要同步"的问题
状态机清晰，不再需要多个 if 条件判断
内存管理更精细（LRU + hibernate）