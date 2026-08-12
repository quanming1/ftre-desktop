# PRD-A4-文件树 + Git 集成

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | A4 |
| 名称 | 文件树 + Git 集成 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-12 |
| 定稿日期 | 2026-08-12 |
| 验收日期 | 2026-08-12 |
| 关联文档 | docs/TODO.yaml 阶段 A4；AGENTS.md |

## 1. 背景与目标

- **背景**：用户需要浏览工作区文件结构，并实时掌握 git 变更状态（新增 / 修改 / 删除 / 未跟踪）。
- **目标**：提供可交互的文件树视图与 git 变更集成（Changes 节点 + 状态染色 + diff 预览）。
- **非目标**：不做 git 提交/推送等写操作；不做 stash / branch 管理界面。

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：ExplorerView 文件树视图（目录展开 / 折叠 / 懒加载）
- [x] FR2：FileTreeItem 树节点（递归渲染 + 文件类型图标 + 选中态）
- [x] FR3：GitService git 状态服务（git poll 轮询 + 协商缓存，避免重复解析）
- [x] FR4：Changes 节点展示 git 变更（新增 / 修改 / 删除 / 未跟踪）
- [x] FR5：文件操作（新建 / 删除 / 重命名文件）

### 2.2 非功能需求

- 性能：git poll 使用协商缓存，大仓库轮询不卡 UI
- 兼容性：忽略 .git 目录与 node_modules 等无关目录

## 3. 技术方案

- 模块设计：
  - `packages/renderer/src/features/explorer/ExplorerView.tsx`：文件树主视图
  - `packages/renderer/src/features/explorer/FileTreeItem.tsx`：递归树节点
  - `packages/renderer/src/features/git/`：git 相关 store 与组件
  - `GitService`：git status 解析、poll 轮询、协商缓存
- 关键数据结构：tree node（path / type / status / children 懒加载标志）

## 4. 接口定义

- GitService：`getStatus()` 返回工作区变更列表；poll 间隔可配置
- Changes 节点：按 status 分组展示变更文件，点击打开 diff 预览

## 5. 验收标准

- [x] AC1：文件树正确展示工作区目录结构，懒加载正常
- [x] AC2：git 变更文件按状态正确染色（新增绿 / 修改黄 / 删除红 / 未跟踪灰）
- [x] AC3：点击 Changes 节点可预览对应 diff
- [x] AC4：新建 / 删除 / 重命名文件操作正常且实时反映到文件树

## 6. 测试计划

- 手动验证：真实 git 仓库中增删改文件，观察轮询更新与染色

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-12 | 初始定稿 | — |
