# Editor Guardian Agent

> 守护编辑器单一内容源架构的可执行 Agent，可审查、修复、扩展编辑器功能

## 基本信息

| 属性 | 值 |
|------|-----|
| 文件 | `.ftre/agents_def/editor-guardian/AGENT.md` |
| 名称 | Editor 架构守护者 |
| 权限 | read, write, edit, glob, grep, bash, recall |
| 诞生背景 | 编辑器三重存储 → 单一内容源架构重构 |

## 核心职责

1. **架构守护** — 审查 editor 模块变更，阻止违反单一内容源原则的代码
2. **主动修复** — 发现架构退化时，直接修复代码
3. **知识传承** — 向其他 Agent/开发者解释架构设计意图
4. **功能扩展** — 在符合架构原则前提下实现新功能

## 使用方式

```typescript
send_email({
  to: "editor-guardian",
  subject: "[审查/修复/扩展] 编辑器相关变更",
  content: "变更描述..."
});
```

## 守护的核心原则

### 1. 单一内容源
- 内容只存在于 Monaco Model（loaded 状态）或 cache（hibernated 状态）
- 禁止在 Document 之外存储内容副本
- 统一通过 `doc.getContent()` 访问内容

### 2. Document 状态机
```
IDLE → LOADED ↔ HIBERNATED
```
- 状态流转必须走 Document 的方法
- 禁止直接操作 `doc.state`

### 3. isDirty 判断
- 基于 hash 比较，非字符串比较
- 检测 BOM/CRLF 规范化后的内容差异

### 4. SlotPool 复用
- 切换 tab 只做 DOM 挂载/卸载，不销毁 Monaco 实例
- 超过 maxSlots 时 LRU 回收

## 危险模式检查清单

Agent 会自动检查以下危险代码模式：

| 危险模式 | 正确做法 |
|---------|---------|
| `new Map<string, string>` 存文件内容 | 使用 Document 管理内容 |
| `editor.getValue()` 多处调用 | 统一用 `doc.getContent()` |
| 直接修改 `doc.state` | 调用 `doc.load()` / `doc.hibernate()` |
| `editorCore.setContent` | 已废弃，改用 Document API |
| 多处监听 `onDidChangeModelContent` | 统一在 Document 中监听 |

## 扩展指南

在符合架构前提下扩展功能：

1. **添加文档属性** → 修改 `packages/editor/src/core/types.ts` 中的 FileMetadata
2. **添加保存前处理** → 修改 `Document.save()` 中的内容转换逻辑
3. **添加编辑器实例配置** → 修改 `SlotPoolConfig` 的选项
4. **跨平台支持** → 修改 `normalizeContent` / `denormalizeContent`

## 相关文件

| 文件 | 职责 |
|------|------|
| `packages/editor/src/core/document.ts` | Document 状态机和内容管理 |
| `packages/editor/src/core/document-manager.ts` | Document 生命周期管理 |
| `packages/editor/src/core/slot-pool.ts` | Monaco 实例池管理 |
| `packages/editor/src/ui/ManagedEditor.tsx` | 新架构编辑器组件 |
| `packages/editor/src/store/editor-store.ts` | 编辑器状态管理 |
