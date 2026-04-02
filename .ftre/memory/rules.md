# Editor 模块开发规则

> **注意**: 修复 editor 模块的 bug 后，记得更新此文件的规则和检查清单。

## 关键文件位置

| 文件 | 职责 |
|------|------|
| `packages/editor/src/core/editor-core.ts` | 内容缓存（contents/diskContents）、isDirty 判断 |
| `packages/editor/src/core/editor-manager.ts` | Slot 池管理、Monaco 实例复用 |
| `packages/editor/src/store/editor-store.ts` | Zustand 状态（groups/tabs/modified） |
| `packages/editor/src/ui/ManagedEditor.tsx` | 编辑器 React 组件，attach/detach 逻辑 |
| `packages/editor/src/ui/MonacoDiffViewer.tsx` | Diff 视图组件 |
| `packages/renderer/src/features/editor/EditorArea.tsx` | 编辑器区域，消费 editor 包 |

## 核心缓存机制

### 1. 内容缓存 (editorCore)
- `contents` = 当前编辑内容
- `diskContents` = 磁盘版本
- `isDirty()` = 两者比较
- **必须同步更新两个 Map**，否则 dirty 判断出错

### 2. Slot 缓存 (EditorManager)
- EditorManager 维护 slot 池，**复用 Monaco 实例**
- `attach()` 复用已有 slot 时**不会触发 `onDidCreate`**
- `onDidChangeContent` 闭包会在每次 attach 时替换
- slot 被复用时，**编辑器内容、undo 栈、滚动位置都保留**
- **切换 tab 不销毁实例**，只是 detach/attach

### 3. 常见陷阱
- 复用 slot 时组件 ref 的初始值可能与实际状态不符
- 同一文件在多个 group 打开时，slot 是共享的
- cleanup 函数执行时 slot 可能已被其他 tab 复用

## 必须遵守的规则

1. **状态更新必须遍历所有 groups**，不能只更新 active group
2. **保存文件后必须同时更新 `diskContent`**，否则 dirty 判断错误
3. **复用 Monaco 组件必须加 `key`**，如 `<MonacoDiffViewer key={diff.id} />`
4. **attach 后必须同步状态**，不能依赖 ref 初始值
5. **onDidCreate 只在新建 slot 时触发**，初始化逻辑要考虑复用场景

## 检查清单

修改 editor 模块前检查：
- 状态更新是否覆盖所有 groups？
- `contents` 和 `diskContents` 是否同步更新？
- 复用 slot 时闭包引用是否正确？
- React 组件是否需要 `key` 强制重建？
- 初始化逻辑是否兼容 slot 复用场景？