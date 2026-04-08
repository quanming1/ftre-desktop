# Editor Guardian Agent

> ⚠️ **此 Agent 定义基于旧架构 (Document + SlotPool)，已归档**
> 
> 旧架构文件已被删除。当前使用 VSCode 三层架构。
> 
> **当前架构文档请参阅：** `editor-architecture-redesign.md`

---

## 原定义文件

`.ftre/agents_def/editor-guardian/AGENT.md`

---

## 新架构要点

当前编辑器已采用 VSCode 风格三层架构：

| 旧概念 | 新对应 |
|--------|--------|
| Document | TextFileModel |
| DocumentManager | TextFileModelManager |
| SlotPool | EditorPanes (按类型复用) |
| hash 判断 dirty | versionId 判断 dirty |

如需创建新的编辑器架构守护 Agent，请参考 `editor-architecture-redesign.md` 中的设计决策部分。
