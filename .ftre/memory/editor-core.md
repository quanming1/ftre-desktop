# 编辑器核心机制

> Monaco 编辑器的非受控模式实现和文件内容同步机制

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/features/editor/core/editor-core.ts` | 非响应式编辑器核心模块，管理文件内容、Monaco 实例和视图状态 |
| `packages/renderer/src/stores/editor.ts` | Zustand store，管理打开的文件和编辑器组 |
| `packages/renderer/src/features/editor/MonacoEditor.tsx` | Monaco 编辑器 React 组件，使用非受控模式 |
| `packages/renderer/src/features/editor/EditorArea.tsx` | 编辑器区域组件，监听文件变化事件 |

## 业务流程

### 文件外部修改同步流程
edit tool 修改文件 → 文件 watcher 触发 `ftre:file-changed` → EditorArea 调用 `refreshFile` → 同时更新 store + editorCore + Monaco 实例

### refreshFile 完整操作
1. 更新 Zustand store 中 OpenFile.content
2. `editorCore.setContent(path, newContent)` — 更新内存缓存  
3. `editorCore.setDiskContent(path, newContent)` — 更新磁盘快照（保证 dirty 判断正确）
4. `editorCore.pushContentToEditor(path, newContent)` — 直接推送到 Monaco 实例

## 关键数据结构

OpenFile: `{ path, name, language, content, modified, pinned }`

editorCore 存储:
- `contents`: Map<string, string> — 当前内容
- `diskContents`: Map<string, string> — 磁盘版本（用于 dirty 判断）
- `instances`: Map<string, editor.IStandaloneCodeEditor> — Monaco 实例引用
- `viewStates`: Map<string, editor.ICodeEditorViewState> — 视图状态

## 设计决策

- **使用非受控模式**：MonacoEditor 使用 `defaultValue` 而非 `value`，避免频繁的 React 重渲染影响性能
- **分离响应式和非响应式状态**：Zustand store 管理响应式状态（tab 列表等），editorCore 管理非响应式状态（文件内容、编辑器实例）

## 注意事项

- Monaco 编辑器在非受控模式下，store 更新不会自动同步到已挂载的实例
- `refreshFile` 必须同时更新所有三个地方：store、editorCore 缓存、Monaco 实例
- `pushContentToEditor` 有相同内容跳过逻辑，不会重置光标位置和 undo 栈