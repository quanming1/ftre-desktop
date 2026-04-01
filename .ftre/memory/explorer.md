# 文件浏览器 (Explorer)

> 文件树浏览、操作和 Git 集成的核心功能

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/features/explorer/ExplorerView.tsx` | 主视图组件，整合文件树和 Git 变更 |
| `packages/renderer/src/features/explorer/FileTreeItem.tsx` | 单个文件/文件夹项的渲染和交互逻辑 |
| `packages/renderer/src/features/explorer/Sidebar.tsx` | 侧边栏容器，根据 activeSidebarView 切换面板 |
| `packages/renderer/src/features/explorer/tree-navigation.ts` | 树形结构扁平化和导航工具函数 |
| `packages/renderer/src/features/explorer/drag-drop-utils.ts` | 拖拽移动文件的验证和目标解析 |
| `packages/renderer/src/features/explorer/file-filter.ts` | 文件过滤规则（UI 层面） |
| `packages/renderer/src/features/explorer/InlineInput.tsx` | 内联编辑文件名的输入框组件 |
| `packages/renderer/src/features/explorer/GitChangesView.tsx` | Git 变更文件列表视图 |

## 业务流程

### 文件树渲染
`tree-navigation:flattenVisibleEntries` → `ExplorerView` → `FileTreeItem`

### 文件拖拽移动
用户拖拽 → `drag-drop-utils:canDrop` 验证 → `drag-drop-utils:resolveDropTarget` 解析 → 执行移动操作

### Git 变更显示
`gitService` 单例获取数据 → `useGitService` hook 订阅变更 → `GitChangesView` 渲染

## 设计决策

- **文件过滤策略**：只在 UI 层面隐藏 `.git` 目录，其他大目录（如 `node_modules`）不强制隐藏，留给搜索层面的 `SKIP_DIRS` 处理
- **拖拽安全限制**：禁止拖到自身或子目录，防止循环引用和意外覆盖
- **Git 集成方式**：通过 `gitService` 单例管理数据，`useGitService` hook 处理状态订阅和防闪烁
- **模块拆分决策**：explorer 不适合拆分为独立 monorepo 包，因其重度依赖应用层核心模块（stores/workspace, stores/editor, services/git-service 等），且无跨项目复用场景

## 注意事项

- 文件过滤使用大小写不敏感匹配（`.toLowerCase()`）
- 内联编辑时会自动选中文件名部分（不含扩展名）
- `Sidebar` 组件使用 `rootPath` 作为 key 实现工作区切换时的重新挂载
- explorer 直接 import 应用层几乎所有核心模块，包括 stores、services、lib、components 和 utils，拆包会导致大量胶水代码