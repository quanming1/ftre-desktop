# 编辑器核心机制

> Monaco 编辑器的非受控模式实现和文件内容同步机制，作为独立包 @ftre/editor 的核心

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/editor/src/core/editor-core.ts` | 非响应式编辑器核心模块（全局单例），管理文件内容、Monaco 实例和视图状态 |
| `packages/editor/src/store/editor-store.ts` | 独立的状态管理模块，通过 HostBridge 与宿主应用解耦 |
| `packages/editor/src/ui/MonacoEditor.tsx` | Monaco 编辑器 React 组件，使用非受控模式 |
| `packages/renderer/src/features/editor/EditorArea.tsx` | 渲染器中的编辑器区域组件，消费 editor 包 |

## 业务流程

### 文件外部修改同步流程
edit tool 修改文件 → 文件 watcher 触发 `ftre:file-changed` → EditorArea 调用 `refreshFile` → 同时更新 store + editorCore + Monaco 实例

### refreshFile 完整操作
1. 更新 Zustand store 中 OpenFile.content
2. `editorCore.setContent(path, newContent)` — 更新内存缓存  
3. `editorCore.setDiskContent(path, newContent)` — 更新磁盘快照（保证 dirty 判断正确）
4. `editorCore.pushContentToEditor(path, newContent)` — 直接推送到 Monaco 实例

### Monaco 实例生命周期管理
- **挂载时**：MonacoEditor 组件调用 `editorCore.registerInstance(path, editor)` 注册实例
- **卸载时**：保存 viewState → `editorCore.unregisterInstance(path)` → Monaco 实例销毁
- **切换 Tab**：当前实现会销毁旧实例并创建新实例（每次切换都重建）

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

## 注意事项

- Monaco 编辑器在非受控模式下，store 更新不会自动同步到已挂载的实例
- `refreshFile` 必须同时更新所有三个地方：store、editorCore 缓存、Monaco 实例
- `pushContentToEditor` 有相同内容跳过逻辑，不会重置光标位置和 undo 栈
- 切换 tab 时当前会销毁重建 Monaco 实例，存在性能优化空间（实例复用）