# 任务清单：修复编辑器外部文件同步问题

> **目标：** 将 EditorArea.tsx 中的 `getTextModelService()` 替换为 `getTextModelResolverService()`
> **技术栈：** React, TypeScript, Monaco Editor

---

### Task 1: 替换 EditorArea.tsx 中的 TextModel 服务调用

**文件：**
- 修改: `packages/renderer/src/features/editor/EditorArea.tsx`

- [ ] **Step 1: 修改 import 语句**

将第 22 行的 import 从 `getTextModelService` 改为 `getTextModelResolverService`：

```typescript
// 修改前 (第 17-24 行)
import {
  CodeEditorWidget,
  SettingsEditorWidget,
  MonacoDiffViewer,
  DiffBar,
  getTextModelService,
  wasRecentlySaved,
} from "@ftre/editor";

// 修改后
import {
  CodeEditorWidget,
  SettingsEditorWidget,
  MonacoDiffViewer,
  DiffBar,
  getTextModelResolverService,
  wasRecentlySaved,
} from "@ftre/editor";
```

- [ ] **Step 2: 替换 file-renamed 事件处理中的服务调用**

修改第 52-56 行：

```typescript
// 修改前
      // 同步更新 TextModelService
      const modelService = getTextModelService();
      if (modelService.isInitialized()) {
        modelService.rename(oldPath, newPath);
      }

// 修改后
      // 同步更新 TextModelResolverService
      const modelService = getTextModelResolverService();
      if (modelService.isInitialized()) {
        modelService.rename(oldPath, newPath);
      }
```

- [ ] **Step 3: 替换 file-deleted 事件处理中的服务调用**

修改第 68-72 行：

```typescript
// 修改前
      // 同步清理 TextModelService
      const modelService = getTextModelService();
      if (modelService.isInitialized()) {
        modelService.dispose(path);
      }

// 修改后
      // 同步清理 TextModelResolverService
      const modelService = getTextModelResolverService();
      if (modelService.isInitialized()) {
        modelService.disposeModel(path);
      }
```

注意：`TextModelResolverService` 的方法名是 `disposeModel()` 而非 `dispose()`。

- [ ] **Step 4: 替换 save-all 事件处理中的服务调用**

修改第 81-92 行：

```typescript
// 修改前
    const handler = async () => {
      const modelService = getTextModelService();
      if (!modelService.isInitialized()) return;

      const dirtyUris = modelService.getDirtyUris();
      for (const uri of dirtyUris) {
        const content = modelService.getContentForSave(uri);
        if (content !== null) {
          const result = await window.desktop.fs.writeFile(uri, content);
          if (result.success) {
            modelService.markSaved(uri);
            useEditor.getState().markSaved(uri);
          }
        }
      }
    };

// 修改后
    const handler = async () => {
      const modelService = getTextModelResolverService();
      if (!modelService.isInitialized()) return;

      const dirtyUris = modelService.getDirtyUris();
      for (const uri of dirtyUris) {
        const content = modelService.getContentForSave(uri);
        if (content !== undefined) {
          const result = await window.desktop.fs.writeFile(uri, content);
          if (result.success) {
            modelService.markSaved(uri);
            useEditor.getState().markSaved(uri);
          }
        }
      }
    };
```

注意：`TextModelResolverService.getContentForSave()` 返回 `string | undefined`，需要检查 `!== undefined` 而非 `!== null`。

- [ ] **Step 5: 替换 onFileChanged 回调中的服务调用（非 dirty 分支）**

修改第 119-131 行：

```typescript
// 修改前
        const modelService = getTextModelService();
        const isDirty =
          modelService.isInitialized() && modelService.isDirty(filePath);

        if (!isDirty) {
          try {
            const result = await window.desktop.fs.readFile(filePath);
            if (!result.error) {
              // 更新 TextModelService
              if (modelService.isInitialized()) {
                modelService.updateContent(filePath, result.content);
              }
              useEditor.getState().refreshFile(filePath, result.content);
            }
          } catch {
            // ignore
          }
        }

// 修改后
        const modelService = getTextModelResolverService();
        const isDirty =
          modelService.isInitialized() && modelService.isDirty(filePath);

        if (!isDirty) {
          try {
            const result = await window.desktop.fs.readFile(filePath);
            if (!result.error) {
              // 更新 TextModelResolverService
              if (modelService.isInitialized()) {
                modelService.updateContent(filePath, result.content);
              }
              useEditor.getState().refreshFile(filePath, result.content);
            }
          } catch {
            // ignore
          }
        }
```

- [ ] **Step 6: 替换 onFileChanged 回调中的服务调用（dirty 分支 - 重新加载）**

修改第 144-156 行（在 notification action 的 onClick 中）：

```typescript
// 修改前
                    if (modelService.isInitialized()) {
                      // 强制更新，即使是 dirty
                      const modelData = modelService.get(filePath);
                      if (modelData) {
                        modelData.model.setValue(result.content);
                        modelData.savedVersionId =
                          modelData.model.getAlternativeVersionId();
                      }
                    }

// 修改后
                    if (modelService.isInitialized()) {
                      // 强制更新，即使是 dirty
                      // TextModelResolverService.updateContent 会同时更新 savedVersionId
                      modelService.updateContent(filePath, result.content);
                    }
```

注意：`TextModelResolverService` 没有 `get()` 方法，但其 `updateContent()` 方法会同时更新 `savedVersionId`，所以可以直接调用。

- [ ] **Step 7: 验证**

运行类型检查：
```bash
cd packages/renderer && pnpm typecheck
```

预期：无类型错误

运行测试：
```bash
cd packages/renderer && pnpm test
```

预期：所有测试通过

- [ ] **Step 8: 手动验证**

1. 启动应用
2. 打开一个文件
3. 使用 AI 的 edit tool 修改该文件
4. 观察编辑器是否自动更新显示新内容

预期：编辑器内容应立即同步更新

- [ ] **Step 9: 提交**

```bash
git add packages/renderer/src/features/editor/EditorArea.tsx
git commit -m "fix(editor): use TextModelResolverService for external file sync

Replace getTextModelService() with getTextModelResolverService() in EditorArea.tsx
to fix the issue where editor content doesn't update after external file changes.

The root cause was that EditorArea was updating TextModelService while Monaco
editor uses TextModelResolverService, resulting in two separate model instances."
```
