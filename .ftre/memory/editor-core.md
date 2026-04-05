> ⚠️ **此文档描述旧架构，已被 `editor-architecture-redesign.md` 替代。**
> 旧架构的 `editor-core.ts` 和 `editor-manager.ts` 即将在 Phase 5 中删除。
> 新架构文档请参阅 `editor-architecture-redesign.md` 和 `.ftre/agents_def/editor-guardian/AGENT.md`。

# 编辑器核心机制

> Monaco 编辑器的非受控模式实现和文件内容同步机制，作为独立包 @ftre/editor 的核心

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/editor/src/core/editor-core.ts` | 非响应式编辑器核心模块（全局单例），管理文件内容、Monaco 实例和视图状态 |
| `packages/editor/src/core/editor-manager.ts` | 实例池管理器，实现 slot 复用（切换 tab 时不销毁重建 Monaco） |
| `packages/editor/src/ui/ManagedEditor.tsx` | 基于 EditorManager 的编辑器组件，DOM attach/detach 机制 |
| `packages/editor/src/store/editor-store.ts` | 独立的状态管理模块，通过 HostBridge 与宿主应用解耦 |
| `packages/renderer/src/features/editor/EditorArea.tsx` | 渲染器中的编辑器区域组件，消费 editor 包 |

## 业务流程

### 文件外部修改同步流程
edit tool 修改文件 → 文件 watcher 触发 `ftre:file-changed` → EditorArea 调用 `refreshFile` → 同时更新 store + editorCore + Monaco 实例

### refreshFile 完整操作
1. 更新 Zustand store 中 OpenFile.content
2. `editorCore.setContent(path, newContent)` — 更新内存缓存  
3. `editorCore.setDiskContent(path, newContent)` — 更新磁盘快照（保证 dirty 判断正确）
4. `editorCore.pushContentToEditor(path, newContent)` — 直接推送到 Monaco 实例

### Monaco 实例生命周期管理（ManagedEditor）
- **架构**：EditorManager 维护 slot 池，每个 slot 包含 {editor, wrapper, attached}
- **attach**：将 slot 的 DOM wrapper 挂到 React 容器，恢复 viewState
- **detach**：从 React 容器移除 wrapper，保存 viewState，slot 保留在池中
- **切换 Tab**：复用 slot，只做 DOM 挂载/卸载（<1ms），不重建 Monaco 实例

## 关键数据结构

OpenFile: `{ path, name, language, content, modified, pinned, loaded }`

editorCore 存储:
- `contents`: Map<string, string> — 当前内容
- `diskContents`: Map<string, string> — 磁盘版本（用于 dirty 判断）
- `instances`: Map<string, editor.IStandaloneCodeEditor> — Monaco 实例引用
- `viewStates`: Map<string, editor.ICodeEditorViewState> — 视图状态（滚动/光标位置）

## 设计决策

- **使用非受控模式**：MonacoEditor 使用 `defaultValue` 而非 `value`，避免频繁的 React 重渲染影响性能
- **分离响应式和非响应式状态**：store 管理响应式状态（tab 列表等），editorCore 管理非响应式状态（文件内容、编辑器实例）
- **独立包架构**：editor 功能封装为 @ftre/editor 独立包，renderer 作为消费方
- **slot 复用机制**：切换 tab 时不销毁重建 Monaco 实例，复用 slot 避免冷启动开销

## 已知问题与修复

### 灰色空白
- **现象**：打开文件时显示灰色空白，没有代码编辑器
- **原因**：Monaco 初始化未完成时，ManagedEditor Effect 直接 return，没有执行 attach
- **修复**：添加 `monacoReady` 状态，Monaco 未就绪时显示 loading 占位，就绪后触发重渲染再 attach

### 打开文件立即提示被修改
- **现象**：刚打开的文件 tab 显示修改标记（dot）
- **原因**：Monaco 创建 model 时会规范化内容（如 BOM、行尾符），导致 `contents` ≠ `diskContents`，isDirty() 返回 true
- **修复**：首次 attach 后检查 Monaco 实际内容与缓存是否不同，如不同且是首次加载，同步 Monaco 内容到 editorCore 的 contents 和 diskContents

## 注意事项

- Monaco 编辑器在非受控模式下，store 更新不会自动同步到已挂载的实例
- `refreshFile` 必须同时更新所有三个地方：store、editorCore 缓存、Monaco 实例
- `pushContentToEditor` 有相同内容跳过逻辑，不会重置光标位置和 undo 栈
- ManagedEditor 依赖 EditorManager 初始化完成，需处理加载状态
