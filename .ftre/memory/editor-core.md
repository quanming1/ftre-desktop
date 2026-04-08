# 编辑器核心机制

> ⚠️ **旧架构文档，已归档**
> 
> 旧架构的 `editor-core.ts`, `editor-manager.ts`, `document.ts`, `document-manager.ts`, `slot-pool.ts` 等文件已在架构重构后删除。
> 
> **当前架构文档请参阅：** `editor-architecture-redesign.md`

---

## 迁移要点

| 旧 API | 新 API | 说明 |
|--------|--------|------|
| `getDocumentManager()` | `getTextFileModelManager()` | Model 管理器 |
| `docManager.get(path)` | `modelManager.get(path)` | 获取文件模型 |
| `docManager.close(path)` | `modelManager.disposeModel(path)` | 关闭文件 |
| `doc.markSaved()` | `model.markSaved()` | 标记已保存 |
| `doc.refresh(content)` | `model.updateContent(content)` | 刷新内容 |
| `Document` 类 | `TextFileModel` 类 | 文件状态机 |
| `SlotPool` | `EditorPanes` | Pane 复用 |
