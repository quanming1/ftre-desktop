# 技术设计：修复编辑器外部文件同步问题

> **架构概要：** 将 EditorArea.tsx 中的 `getTextModelService()` 调用替换为 `getTextModelResolverService()`，确保文件变更时更新的是 Monaco 编辑器实际使用的 model。

## 涉及文件

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| 修改 | `packages/renderer/src/features/editor/EditorArea.tsx` | 将 TextModelService 替换为 TextModelResolverService |

## 现有代码意图分析

### EditorArea.tsx

**当前代码的意图**：
- 监听外部文件变更事件（`onFileChanged`）并同步更新编辑器内容
- 监听文件重命名/删除事件并更新 model 状态
- 处理全部保存（save-all）操作

**承载的隐式约束**：
- 必须检查 model 是否 dirty，dirty 时需要用户确认才能覆盖
- 必须通过 `wasRecentlySaved` 过滤掉用户自己保存触发的变更事件

**问题根因**：
- 代码调用了 `getTextModelService()`（旧架构）
- 但 `CodeEditorWidget` / `TextCodeEditorPane` 使用的是 `getTextModelResolverService()`（新架构）
- 两个服务各自维护独立的 Monaco model 实例，更新错误的服务不会影响编辑器显示

**为什么改动是安全的**：
- `TextModelResolverService` 提供与 `TextModelService` 完全相同的 API：`isInitialized()`、`isDirty()`、`updateContent()`、`rename()`、`disposeModel()`、`hasModel()`、`getContentForSave()`、`markSaved()`、`getDirtyUris()`
- 只是切换到正确的服务实例，逻辑不变

## 接口设计

### TextModelResolverService API（已存在，无需修改）

```typescript
interface ITextModelResolverService {
  // 初始化检查
  isInitialized(): boolean;
  
  // dirty 状态
  isDirty(resource: string): boolean;
  getDirtyUris(): string[];
  markSaved(resource: string): void;
  
  // 内容操作
  updateContent(resource: string, content: string): void;
  getContentForSave(resource: string): string | undefined;
  
  // 模型生命周期
  hasModel(resource: string): boolean;
  disposeModel(resource: string): void;
  rename(oldResource: string, newResource: string): void;
}
```

## 与现有逻辑的关系

```
文件系统变更
    ↓
watcher.ts (Electron main process)
    ↓ fs:fileChanged IPC
EditorArea.tsx (onFileChanged 回调)
    ↓ 调用 getTextModelResolverService()
TextModelResolverService
    ↓ 更新 Monaco model
Monaco Editor (自动响应 model 变化)
    ↓
UI 刷新显示最新内容
```

## 架构决策

- **决策 1**: 直接替换服务调用，而非统一两套服务
  - 原因：统一服务需要大规模重构，风险高；直接替换是最小改动且无副作用
