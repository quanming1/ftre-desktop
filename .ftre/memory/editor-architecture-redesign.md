# Editor 架构重构方案

> 编辑器架构从"三重存储"重构为"单一内容源+状态机驱动"，解决内容同步问题和 isDirty 误报

**📄 正式设计文档：** `.ftre/specs/editor-architecture-refactor/design.md`  
**📋 需求文档：** `.ftre/specs/editor-architecture-refactor/requirements.md`

## 重构进度

- ✅ Phase 1: Document + DocumentManager（已实现）
- ✅ Phase 2: SlotPool（已实现，从 editor-manager.ts 拆分）
- ✅ Phase 3: 简化 ManagedEditor.tsx（已迁移）
- ✅ Phase 4: 移除双重状态更新（已完成，renderer 包所有旧架构调用已清理）
- ⏳ Phase 5: 删除旧的 editor-core.ts 和 editor-manager.ts（新旧架构并行中）

### Phase 4 详细完成记录

**已迁移文件（renderer 包）：**

| 文件 | 变更 |
|------|------|
| `packages/renderer/src/features/explorer/FileTreeItem.tsx` | 预加载逻辑迁移：用 `docManager.hasContent()` 和 `docManager.preload()` 替代 `editorCore.setContent` |
| `packages/renderer/src/features/editor/EditorArea.tsx` | 文件重命名/删除事件：用 `docManager.getDirtyPaths()` 和 `doc.getContentForSave()` 替代 editorCore |
| `packages/renderer/src/features/editor/TabBar.tsx` | 保存关闭逻辑：用 `docManager.get().getContentForSave()` 替代 `editorCore.resolveContent()` |
| `packages/renderer/src/features/memory/MemoryMonitorPanel.tsx` | 统计信息：用 `slotPool.getStats()` 替代 `editorManager.getStats()` |
| `packages/renderer/src/services/memory-monitor.ts` | 统计信息：用 `slotPool.getStats()` 替代 `editorManager.getStats()` |
| `packages/renderer/src/app/main.tsx` | 移除 `editorManager.init()`，只初始化 `docManager` 和 `slotPool` |
| `packages/renderer/src/features/editor/core/index.ts` | 重新导出 `getDocumentManager`, `getSlotPool` 等新架构 API |

**仍保留的旧架构文件（Phase 5 删除）：**
- `packages/editor/src/core/editor-core.ts` - 三重存储
- `packages/editor/src/core/editor-manager.ts` - 混杂管理器
- `packages/editor/src/ui/MonacoEditor.tsx` - 旧编辑器组件
- 测试文件中的旧 mock（需更新测试）

## 核心文件

| 文件 | 职责 | 状态 |
|------|------|------|
| `packages/editor/src/core/types.ts` | 核心类型：DocState, FileMetadata, ViewState | ✅ 已创建 |
| `packages/editor/src/core/document.ts` | Document 类（状态机、内容管理、跨平台元数据） | ✅ 已实现 |
| `packages/editor/src/core/document-manager.ts` | DocumentManager（生命周期管理、快照、工作区切换） | ✅ 已实现 |
| `packages/editor/src/core/slot-pool.ts` | SlotPool（Monaco 实例池、LRU 回收、DOM 挂载） | ✅ 已实现 |
| `packages/editor/src/ui/ManagedEditor.tsx` | 新架构编辑器组件（绑定 Document + SlotPool） | ✅ 已迁移 |
| `packages/editor/src/store/editor-store.ts` | Store 集成（仅使用新架构） | ✅ 已移除 editorCore 依赖 |
| `packages/editor/src/core/editor-core.ts` | 旧架构三重存储（待删除） | ⚠️ 已清理所有调用 |
| `packages/editor/src/core/editor-manager.ts` | 旧架构混杂管理器（待删除） | ⚠️ 已清理所有调用 |

**导出入口：** `packages/editor/src/core/index.ts`  
**全局初始化：** `packages/renderer/src/app/main.tsx` 初始化 docManager 和 slotPool

## 初始化流程

```
main.tsx
  ├─ import monaco-setup (workers 配置)
  ├─ getDocumentManager().init(monaco)  ← 新架构
  ├─ getSlotPool().init(monaco)         ← 新架构
  └─ registerFtreTheme(monaco)
```

## Document 状态机

```
IDLE ──────→ LOADED ←──────→ HIBERNATED
         load()   hibernate()
         restore() activate()
```

**状态说明：**
- `idle`: 初始状态，等待加载
- `loaded`: Monaco model 已创建，可编辑
- `hibernated`: 休眠（释放 model，cache 保留未保存内容）
- Document 被销毁时直接调用 `dispose()`，不经过额外状态

## DocumentManager API

```typescript
interface ReadResult {
  content: string;
  language?: string;
  error?: string;
}

type ReadFileFn = (path: string) => Promise<ReadResult>;

class DocumentManager {
  // 基本操作
  open(path, language): Document           // 创建新 Document
  get(path): Document | undefined          // 获取已有 Document
  has(path): boolean                       // 是否存在 Document
  hasContent(path): boolean                // Document 是否已加载内容（state !== idle）
  close(path): void
  closeAll(): void
  
  // 异步加载文件内容（从 ManagedEditor 下沉至此）
  loadAsync(path, language, readFn: ReadFileFn): Promise<Document | null>
  
  // 预加载（用于 Explorer hover 预读取）
  preload(path, language, content: string): void
  
  // 文件系统事件处理
  handleFileRenamed(oldPath, newPath): void
  handleDirectoryRenamed(oldDir, newDir): void
  handleFileDeleted(path): void
  handleDirectoryDeleted(dirPath): void
  
  // 工作区切换
  hibernateAll(): void
  hibernateOthers(activePath): void        // 休眠非活跃工作区的文档
  wakeupAll(): void
  
  // Dirty 检查
  getDirtyPaths(): string[]                // 返回所有 dirty 文件路径
  getDirtyFiles(): { path, name }[]        // 返回所有 dirty 文件信息
  hasUnsavedChanges(): boolean
}

// 全局单例
export function getDocumentManager(): DocumentManager
```

**设计意图：** `loadAsync` 接收 `readFn` 回调而非直接依赖 `HostBridge`，保持 core 层不依赖 runtime 层。

## SlotPool API

```typescript
class SlotPool {
  init(monaco): void
  isInitialized(): boolean
  
  // 获取/释放编辑器实例
  acquire({ doc, container, onDidCreate, onDidChangeContent }): IStandaloneCodeEditor | null
  release(path, doc): void
  
  // 统计信息
  getStats(): {
    slotCount: number;
    preloadedModelCount: number;
    viewStateCount: number;
    activeSlotPath: string | null;
  }
  
  getActivePath(): string | null
  setTheme(theme): void
  updateOptions(options): void
  closeAll(): void
  dispose(): void
}

// 全局单例
export function getSlotPool(): SlotPool
```

## Document API

```typescript
class Document {
  readonly path: string
  readonly language: string
  
  // 状态查询
  get state(): DocState                    // 'idle' | 'loaded' | 'hibernated'
  get model(): ITextModel | null
  get metadata(): FileMetadata             // { lineEnding, hasBom, encoding }
  
  // 内容获取
  getContent(): string                     // 规范化内容（LF、无 BOM）
  getContentForSave(): string              // 恢复原始格式（CRLF/BOM）
  
  // 状态变更
  load(rawContent): void                   // 从磁盘加载（检测元数据、计算 hash）
  activate(): void                         // 从 hibernated 唤醒
  hibernate(): void                        // 休眠（释放 model、保留 cache）
  refresh(newContent): void                // 从外部刷新内容
  markSaved(): void                        // 标记为已保存（更新 diskHash）
  
  // Dirty 检测
  isDirty(): boolean                       // hash 比较
  
  // 视图状态
  saveViewState(state): void
  getViewState(): ViewState | null
  
  // 监听
  onStateChange(listener): () => void
}
```

## ManagedEditor 绑定流程

```
ManagedEditor 渲染
  ├─ useMemo: doc = docManager.get(path) ?? docManager.open(path, lang)
  ├─ useEffect 1: 监听 doc.onStateChange，更新本地 state
  ├─ useEffect 2: 懒加载
  │   ├─ docState === "idle":
  │   │   └─ docManager.loadAsync(path, lang, bridge.readFile)
  │   └─ docState === "hibernated": doc.activate() → slotPool.acquire()
  └─ useEffect 清理: slotPool.release(path)
```

**关键实现细节：**
- `docManager.get/open` 必须在 `useMemo` 中调用，避免 React 渲染阶段副作用
- 文件读取职责完全下沉到 DocumentManager，ManagedEditor 退化为纯 UI 组件

## Store 集成（新架构独占）

`packages/editor/src/store/editor-store.ts` 已完全迁移到新架构，所有旧架构 `editorCore.xxx()` 调用已移除：

| Store 方法 | 新架构调用 |
|------------|-----------|
| `suspendForWorkspace` | `docManager.hibernateAll()` |
| `resumeForWorkspace` | `docManager.wakeupAll()` |
| `handleFileRenamed` | `docManager.handleFileRenamed()` |
| `handleDirectoryRenamed` | `docManager.handleDirectoryRenamed()` |
| `handleFileDeleted` | `docManager.handleFileDeleted()` |
| `handleDirectoryDeleted` | `docManager.handleDirectoryDeleted()` |
| `closeFile` | `docManager.close(path)` |
| `closeAllFiles` | `docManager.closeAll()` |
| `refreshFile` | `docManager.get(path)?.refresh(newContent)` |
| `hydrateFileContent` | `docManager.get(path)?.load(content)` |
| `markSaved` | `docManager.get(path)?.markSaved()` |
| `hasUnsavedChanges` | `docManager.hasUnsavedChanges()` |

## 关键设计决策

1. **单一内容源** - Document 持有唯一可信内容，避免 React Store + editorCore + Monaco 三重同步
2. **hash 判断 dirty** - Document 存储 diskHash，编辑时比较规范化内容的 hash
3. **状态机简化** - 仅 3 态（idle / loaded / hibernated），无 loading 和 closed 状态，状态流转更清晰
4. **文件读取职责下沉** - DocumentManager 提供 `loadAsync`，ManagedEditor 退化为纯 UI
5. **Hibernate 机制** - 工作区切换时休眠文档，恢复时重新激活
6. **跨平台兼容** - FileMetadata 存储原始 BOM/CRLF，编辑时用 LF，保存时恢复
7. **分层清晰** - core 层不依赖 runtime 层，通过回调获取 runtime 能力

## 跨平台处理

| 问题 | 方案 |
|------|------|
| Windows CRLF vs Unix LF | Monaco 内统一用 LF，保存时恢复原始行尾符 |
| UTF-8 BOM | 读取时检测 hasBom，保存时恢复 BOM 头 |
| mixed 行尾符 | Monaco 强制规范化为 LF，保存时按 LF 处理（无法恢复原始混合状态） |
| isDirty 误报 | hash 比较规范化后的内容（LF、无 BOM）|

## 注意事项

- **渲染阶段副作用**：`docManager.get/open` 必须在 `useMemo` 中调用，不能在渲染阶段直接调用
- **Monaco 初始化顺序**：`docManager.init()` 和 `slotPool.init()` 必须在 Monaco Workers 配置之后调用
- **分层依赖**：core 层通过回调（如 `ReadFileFn`）而非直接依赖获取 runtime 能力
- **旧文件待删除**：editor-core.ts 和 editor-manager.ts 已无调用，可安全删除

## 迁移路径

**新架构入口：** `packages/editor/src/core/index.ts` 导出：
```typescript
export { Document, type DocState, type FileMetadata } from "./document";
export { DocumentManager, type DocumentSnapshot } from "./document-manager";
export { SlotPool, type Slot } from "./slot-pool";
export { getDocumentManager, getSlotPool } from "./singleton";
```

**Phase 5 待清理：**
- `packages/editor/src/core/editor-core.ts` - 三重存储，所有调用已移除
- `packages/editor/src/core/editor-manager.ts` - 混杂管理器，所有调用已移除
- `packages/editor/src/ui/MonacoEditor.tsx` - 旧编辑器组件（已被 ManagedEditor 替代）
- 测试文件中的旧 mock（FileTreeItem.test.tsx、MonacoDiffViewer.test.tsx）

## 架构守护者 Agent

**Agent 文件：** `.ftre/agents_def/editor-guardian/AGENT.md`

**触发方式：**
```typescript
send_email({
  to: "editor-guardian",
  subject: "[审查请求] 编辑器模块变更",
  content: "变更文件: xxx.ts\n变更描述: ..."
});
```

**核心职责：**
- 审查涉及 editor 模块的变更，阻止违反单一内容源原则的代码
- 向其他 Agent 或开发者解释架构设计意图
- 评估新需求对现有架构的影响，提供迁移建议

**守护内容：**
- 三层分离原则（UI / Instance / Content）
- 单一内容源原则（Monaco Model 或 cache，无副本）
- isDirty 基于 hash 比较
- 跨平台 BOM/CRLF 规范化
- Slot 复用安全
- 历史教训（如 loading 状态移除原因）

**四不要原则：**
1. 不要创建内容的额外副本（React Store 或全局变量）
2. 不要直接修改 Document 的 model，通过 Document 提供的 API 操作
3. 不要在 acquire() 前操作 model，必须通过 SlotPool 获取编辑器实例
4. 不要在工作区切换时销毁 Document，应使用 hibernate/activate 机制
