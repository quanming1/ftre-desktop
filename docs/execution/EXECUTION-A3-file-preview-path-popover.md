# A3 文件预览路径浮层收尾审计

## 范围与边界

- 仓库：`E:\binn\ftre-desktop`
- 分支：`develop`
- 阶段：A3 Inspector 面板；本次只覆盖文件/图片/Diff 预览路径浮层、目录 IPC 和相关共享树节点，不扩展到后端仓库。
- 工作区状态：代码和文档改动保留在工作区，未执行 commit/push/merge。

## Owner 迁移表

| 能力 | 旧/重复实现 | 当前唯一 Owner | 审计证据 |
|---|---|---|---|
| 目录 IPC | `fs:readDir` 内原地枚举逻辑 | `packages/electron/src/ipc/fs-directory.ts` 的 `listDirectoryEntries`；`fs:listDirectory` 和兼容 `fs:readDir` 共同委托 | `packages/electron/src/ipc/fs.ts` 仅注册两个 handler，均调用同一 helper |
| 预览树节点 | 弹窗早期独立 `DirectoryTreeItem`（已删除） | `FileTreeSidebar.tsx` 导出的 `TreeItem/TreeNode/filterTreeEntries` | `FilePathPopover.tsx` 直接 import 并渲染 `TreeItem`；最终搜索无 `DirectoryTreeItem` |
| 图片/二进制判断 | Inspector 与聊天卡片各自维护扩展名集合 | `packages/renderer/src/utils/filePreviewKinds.ts` | Inspector 渲染器、FileTreeSidebar、InlineToolCallCard 统一 import |
| 路径浮层 | 无 | `PreviewHeader` 管理路径段/锚点，`FilePathPopover` 管理浮层生命周期和根目录请求 | File/Image/Diff Renderer 均通过 `PreviewHeader pathPicker` 接入 |

## 生命周期审计

| 资源 | 创建/注册 | 停止/回滚 | 重复调用与失败 |
|---|---|---|---|
| `fs:listDirectory` IPC | Electron `main.ts` 单一 Composition Root 调用 `registerFsIPC()` | 进程级 IPC handler，无窗口级监听器 | 参数校验、结构化错误码；单一注册点 |
| 浮层窗口监听 | `FilePathPopover` open 时注册 resize/scroll、pointerdown、keydown | effect cleanup 移除全部监听；关闭/卸载不留全局引用 | 每次打开重置 generation/request id，旧响应被丢弃 |
| 目录异步读取 | 根目录由 `FilePathPopover` 请求；子目录由共享 `TreeItem` effect 懒加载 | 根请求以 generation/request id 防 stale；TreeItem effect 以 cancelled 标记防卸载回写 | 失败显示错误状态；重试重新请求；重复展开不重复注册监听 |

## 旧引用与边界检查

- `DirectoryTreeItem`、旧 Inspector 图片扩展名集合、旧 `getExt` 重复实现已删除。
- `fs:readDir` 仍被 FileTreeSidebar、全局搜索等现有消费者使用，保留为兼容入口；其目录枚举委托新 helper，未误删仍被依赖的 API。
- `registerFsIPC()` 在 `packages/electron/src/main.ts` 只有一个调用点。
- 未发现新的 `ipcRenderer` 泄漏到 Renderer；目录读取只经 `contextBridge` 的 `fs.listDirectory`。
- `dist/`、`node_modules/` 由 `.gitignore` 明确覆盖，是构建/依赖输出；未删除用户数据、依赖、数据库或未知用途资源。

## 验证证据

- `pnpm test`：renderer 48 个测试文件 / 489 项通过；platform 10 项通过。
- IPC Node 回归：路径校验、目录优先排序、隐藏目录过滤、稳定错误码、符号链接不递归，3 项通过。
- `pnpm --filter @ftre/shared build`：通过。
- `pnpm --filter @ftre/electron exec tsc --noEmit`：通过。
- `pnpm --filter @ftre/renderer exec tsc --noEmit`：通过。
- `pnpm build`：shared、ui、editor、electron、renderer 全部构建通过。
- `git diff --check`：通过。
- 最终搜索：无 `DirectoryTreeItem`、`IMAGE_EXTS`、`BINARY_EXTS`、旧 `getExt` 残留；新旧目录 IPC 的唯一 helper/入口关系已确认。

## 已知边界

- 构建仍输出仓库既有的 CSS 语法和动态 import 警告；本次构建 exit code 为 0，警告未由路径浮层引入。
- 工作区当前仍有本次功能和文档的未提交改动；按用户授权边界未自动提交。
