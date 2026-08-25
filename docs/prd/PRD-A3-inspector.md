# PRD-A3-Inspector 面板

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | A3 |
| 名称 | Inspector 面板 |
| 状态 | 已验收 |
| 创建日期 | 2026-08-12 |
| 定稿日期 | 2026-08-24 |
| 验收日期 | 2026-08-24 |
| 关联文档 | docs/TODO.yaml 阶段 A3；AGENTS.md |

## 1. 背景与目标

- **背景**：agent 在工作区执行文件操作时，用户需要直观查看文件内容、diff 变更与图片预览。
- **目标**：提供可停靠的 Inspector 扩展面板，以 tab 形式展示文件内容 / diff / 图片，并支持文件树侧栏浏览。
- **非目标**：不做文件编辑能力（只读查看）；不做跨会话的 tab 持久化。

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：InspectorPanel tab 管理（打开 / 切换 / 关闭 / 拖拽排序 / 去重）
- [x] FR2：DiffRenderer diff 渲染（side-by-side 与 unified 两种模式）
- [x] FR3：FileRenderer 文件内容渲染（Monaco 只读编辑器）
- [x] FR4：ImageRenderer 图片预览（base64 数据渲染）
- [x] FR5：tabRegistry tab 注册表（按 toolCallId 去重，同一操作只开一个 tab）
- [x] FR6：FileTreeSidebar 文件树侧栏（目录懒加载 + git 状态标识）
- [x] FR7：FileRenderer md / html 渲染预览（markdown 走共享渲染管线，html 走 sandbox iframe；默认渲染视图，可切换源码）
- [x] FR8：FileRenderer 暂存区 Diff 按钮——git 已跟踪且有未暂存修改（M）的文件，工具栏显示「查看与暂存区的差异」按钮（按文件自身路径查询所在仓库的 index 版本，不依赖工作区级 git 缓存），点击新开 DiffTab（before=暂存区版本，after=工作区内容）
- [x] FR9：FileTreeSidebar 树结构实时刷新——对 session 工作区注册递归 fs watcher（IPC 按路径幂等、不 unwatch），文件变更事件 150ms 防抖聚合后按受影响目录增量刷新（根目录 → rootEntries；子目录 → 版本号驱动 TreeItem 重读），agent 新建/删除文件后文件树自动更新；工作区外路径与 .git 内部变更不触发
- [x] FR17：Inspector 显示/隐藏入口按状态分区——面板关闭时入口固定在 Chat Header 最右侧，面板打开时 Header 入口隐藏并在 Inspector 顶部右上角提供关闭按钮；入口不得被“更多操作”按钮遮挡。

### 2.2 非功能需求

- 性能：大文件打开不卡顿（Monaco 虚拟渲染）
- 兼容性：常见文本与图片格式；diff 支持行内高亮

## 3. 技术方案

- 模块设计（`packages/renderer/src/features/inspector/`）：
  - `InspectorPanel.tsx`：面板容器 + tab 管理
  - `renderers/DiffRenderer.tsx`：diff 视图（side-by-side / unified）
  - `renderers/FileRenderer.tsx`：Monaco 只读文件视图
  - `renderers/ImageRenderer.tsx`：base64 图片预览
  - `tabRegistry.ts`：tab 去重注册表
  - `FileTreeSidebar.tsx`：文件树侧栏
- 依赖选型：@monaco-editor/react、diff 解析库

## 4. 接口定义

- tab 注册：`tabRegistry.open({ toolCallId, kind, payload })` → 返回或复用已有 tab
- Inspector 与 chat 联动：read / edit / write 工具调用自动打开对应 tab

## 5. 验收标准

- [x] AC1：read 工具调用后打开 file tab 并正确渲染文件内容
- [x] AC2：edit / write 工具调用后打开 diff tab 展示变更
- [x] AC3：图片工具返回的 base64 内容可在 ImageRenderer 预览
- [x] AC4：tab 支持拖拽排序，同 toolCallId 不重复开 tab
- [x] AC5：md / html 文件默认打开渲染视图且可切回源码（keep-alive 切换）；html 以 sandbox iframe 隔离渲染；非 md / html 文件不受影响（自动化测试 3/3 通过）
- [x] AC6：git 已跟踪且有未暂存修改（M）的文件，FileRenderer 工具栏显示暂存区 Diff 按钮，点击新开 DiffTab 展示工作区 vs 暂存区差异；干净 / 仅已暂存 / untracked 文件不显示；文件被 stage / 还原后按钮消失（自动化测试 FileRenderer.test 7/7 通过）
- [x] AC7：agent 在 session 工作区新建/删除文件后，右侧文件树约 150ms（防抖窗口）内自动出现/移除该条目；工作区外路径与 .git 内部变更不触发树刷新（自动化测试 FileTreeSidebar.test 5/5 通过）
- [x] AC15：Inspector 关闭时 Chat Header 的展开按钮位于操作区最右侧；Inspector 打开时该按钮从 Header 消失，关闭按钮固定在 Inspector 顶部右上角，且不与“更多操作”或新建面板按钮重叠（自动化测试 InspectorPanel.test 通过）

## 6. 测试计划

- 手动验证：模拟 read / edit / write / 图片工具调用，检查 tab 行为与渲染

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-12 | 初始定稿 | — |
| 2026-08-14 | 新增 FR7 / AC5：FileRenderer 支持 md / html 渲染预览——markdown 复用共享渲染管线（markdown-plugins + rehype-highlight），html 走 sandbox iframe；默认打开即渲染视图，工具栏可切回源码（markdown keep-alive、iframe 切回即卸载）。原 AC1-AC4 不受影响，新增 AC5 自动化测试 3/3 通过 | 用户需求：文件预览 md / html 时直接看渲染结果 |
| 2026-08-14 | 增强 AC5：md 渲染视图内 ```mermaid 代码块由 MermaidBlock 渲染为图表（动态 import mermaid ^11.16.1、securityLevel 默认 strict、渲染失败回退源码）；源码/渲染切换按钮沿用文件级切换，切源码可见 mermaid 源码。新增自动化测试（FileRenderer.test 4/4 通过） | 用户需求：md 中的 mermaid 图表应可视化展示 |
| 2026-08-18 | 新增 FR8 / AC6：FileRenderer 暂存区 Diff 按钮——git 已跟踪且有未暂存修改（M）的文件工具栏显示「查看与暂存区的差异」（新增 git:index-diff IPC 按文件自身路径查询所在仓库 index 版本，不依赖工作区级 git 缓存），点击新开 DiffTab（before=暂存区、after=工作区），干净 / 仅已暂存 / untracked 不显示、stage / 还原后消失；同时预览 header 统一为矮版共享组件（PreviewHeader），文件 / diff 预览 CodeDiff 背景对齐 --ftre-bg-surface。原 AC1-AC5 不受影响，自动化测试 7/7 通过 | 用户需求：查看工作区与暂存区的差异；统一预览 header 高度与背景色差 |
| 2026-08-18 | 新增 FR9 / AC7：FileTreeSidebar 树结构实时刷新——树结构此前只在展开时读一次（git 徽标走 1s 轮询、内容走 mtime 失效，唯独结构不刷），且 Workbench 只 watch 应用工作区、session 工作区在其外时无事件源。现对 session 工作区注册递归 watcher（IPC 幂等、不 unwatch），变更事件 150ms 防抖聚合后按受影响目录增量刷新（根→rootEntries、子目录→版本号驱动 memo 节点重读）。原 AC1-AC6 不受影响，自动化测试 5/5 通过 | 用户反馈：agent 编辑/新建文件后文件树不更新 |

| 2026-08-24 | 新增 FR10-FR16 / AC8-AC14：文件预览路径段按目录打开懒加载文件列表；每个目录段以自身为根，当前路径自动展开，文件可打开/复用 Inspector Tab；新增规范化 `fs:listDirectory` IPC、共享错误码、Main 统一目录 helper、preload 最小暴露面和请求竞态隔离；FileRenderer/ImageRenderer/DiffRenderer 接入，补充 renderer 与 IPC 回归测试。AC8-AC14 已通过；原 FR1-FR9、AC1-AC7 不受影响 | 用户需求：点击 A/B/C/D 路径段展示对应目录下的文件和文件夹，并可跳转预览 |
| 2026-08-24 | 新增 FR17 / AC15：侧面板入口改为状态分区定位；关闭时位于 Chat Header 最右侧，打开时隐藏 Header 入口并将关闭按钮放入 Inspector 顶部右上角，避免被“更多操作”遮挡 | 用户反馈：展开与关闭应保持同一右上角操作位置，减少鼠标移动 |

## 8. 文件预览路径弹窗（已实现）

> 本节为 2026-08-24 评审后实现并验收的 A3 增量能力；原 FR1-FR9、AC1-AC7 保持不变。

### 8.1 用户场景与目标

- **场景**：用户在 Inspector 预览文件时，当前只能复制/查看完整路径；想从路径所在目录快速浏览同级文件和子目录，并直接打开另一个文件。
- **目标**：点击预览 Header 的任一路径段后，在 Header 下方打开一个文件列表浮层；每个目录段都以自身为列表根（例如 `A > B > C > D > E.txt` 中点击 `A` 展示 `A` 下内容，点击 `B` 展示 `B` 下内容，`C/D` 同理），沿当前文件路径自动展开，文件点击后打开或激活对应预览 Tab。
- **非目标**：不把浮层做成系统文件选择对话框；不新增文件编辑、创建、删除、重命名、Git 操作；不扫描整个工作区或一次性读取所有文件内容；不改变现有 FileTreeSidebar 的布局和行为。

### 8.2 功能需求（已实现）

- [x] FR10：PreviewHeader 将路径拆为可点击的 breadcrumb 段；每个目录段点击后都以该目录自身为根打开路径浮层（`A` 看 `A` 下内容、`B` 看 `B` 下内容，依此类推），当前文件段点击后打开其父目录浮层；复制绝对路径仍可用，但不再由整条路径独占点击行为。
- [x] FR11：路径浮层展示所选目录的直接子项，目录在上、文件在下并按名称排序；隐藏目录、`.git` 目录不展示；每个条目显示目录/文件图标、名称和选中态。
- [x] FR12：目录节点按需懒加载；点击目录箭头或目录行展开/收起；浮层打开时自动展开当前文件从浮层根目录到父目录的路径，并高亮当前文件。
- [x] FR13：点击文件条目关闭浮层，并打开或激活对应文件预览；相同绝对路径复用已有 File/Image Tab，不覆盖当前文件的内容快照；无法预览的二进制文件保持不可打开提示。
- [x] FR14：浮层支持 Escape、点击外部区域和再次点击当前路径段关闭；加载中、空目录、读取失败均有明确的轻量状态，不阻塞预览正文。
- [x] FR15：路径解析兼容 Windows 盘符、POSIX 根路径、反斜杠和 `~` 展开；路径段显示可截断，完整绝对路径仅通过复制按钮获取，不再由 hover 展示。
- [x] FR16：目录读取通过 Electron preload 暴露的类型化 IPC 完成，Renderer 不直接访问 Node `fs` 或 `ipcRenderer`；目录请求取消/过期时不得用旧响应覆盖当前浮层。

### 8.3 非功能需求（已实现）

- **性能**：首次只读取浮层根目录；展开目录才读取其子项；单次读取只返回目录元数据，不读取文件内容；浮层列表超过可视高度时内部滚动。
- **安全**：IPC 只读目录元数据；规范化分隔符并拒绝空路径/非法参数；过滤 `.git` 与隐藏目录；错误信息返回给 Renderer 时不暴露堆栈。
- **兼容性**：Electron 生产模式和 Vite 开发模式均可安全降级；无 preload bridge 时不崩溃，浮层显示“当前环境不可读取目录”。
- **可访问性**：浮层使用 `role="tree"` / `role="treeitem"` 语义，支持键盘 Escape 关闭和 Enter 打开/展开，当前条目有可读的 `aria-current` 或选中态。

### 8.4 技术方案（已实现）

- `packages/renderer/src/features/inspector/renderers/PreviewHeader.tsx`：只负责 breadcrumb 展示、锚点和浮层开关；保留复制路径能力。
- `packages/renderer/src/features/inspector/renderers/FilePathPopover.tsx`：浮层容器与目录请求状态；通过 portal 渲染到 body，避免被 Inspector 的 `overflow` 截断；复用 `FileTreeSidebar.tsx` 导出的 `TreeItem`、`TreeNode` 和目录过滤/排序逻辑，负责外部点击、Escape、加载/错误状态和当前路径展开。
- `packages/renderer/src/features/inspector/renderers/FileRenderer.tsx` / `ImageRenderer.tsx` / `DiffRenderer.tsx`：传入当前路径和“打开路径”回调，沿用 `useInspector.openFilePreview` / `openImagePreview` 的稳定路径去重语义。
- `packages/electron/src/ipc/fs.ts`：抽取统一的只读目录枚举 helper；新增明确的 `fs:listDirectory` IPC 通道供预览浮层使用，现有 `fs:readDir` 保持兼容并委托同一 helper，统一目录枚举、排序和正斜杠路径。
- `packages/electron/src/preload.ts`、`packages/shared/src/types.ts`、`packages/renderer/src/types/desktop.d.ts`：同步暴露 `fs.listDirectory(dirPath)` 类型；不得把 `ipcRenderer` 泄漏给 Renderer。

### 8.5 IPC 契约

```ts
type PreviewDirectoryEntry = {
  name: string;
  path: string;       // 规范化为 /
  isDir: boolean;
  ext: string | null;
};

type DirectoryErrorCode =
  | "INVALID_PATH"
  | "NOT_FOUND"
  | "NOT_DIRECTORY"
  | "PERMISSION_DENIED"
  | "READ_FAILED";

type DirectoryError = {
  code: DirectoryErrorCode;
  message: string;
};

type ListDirectoryResult = {
  entries: PreviewDirectoryEntry[];
  error?: DirectoryError;
};

// Renderer -> preload -> main
fs.listDirectory(dirPath: string): Promise<ListDirectoryResult>;
// main IPC channel: fs:listDirectory
```

- `dirPath` 只接受非空字符串；Main 进程负责 `~` 展开、路径规范化、目录读取和错误转换。
- 返回结果按“目录优先、名称不区分大小写排序”；`.git` 和隐藏目录在 Main 进程过滤，Renderer 再做一次防御性过滤。
- 本契约只返回元数据，不返回文件内容；打开文件仍走现有 `fs:readFile` / `fs:readImageBase64` 和 Inspector Tab 流程。

### 8.6 IPC 实现规范（已遵守）

1. **共享类型单一来源**：`FileEntry`、目录读取结果和错误码只定义在 `packages/shared/src/types.ts`；`packages/renderer/src/types/desktop.d.ts` 只能通过类型引用同步，不得再复制一套结构或使用 `any`。
2. **Main 进程集中处理**：`packages/electron/src/ipc/fs.ts` 抽取纯函数 `listDirectoryEntries(dirPath)`，负责输入校验、`~` 展开、路径分隔符规范化、目录存在性/类型检查、目录枚举、过滤和排序；`fs:listDirectory` 和现有 `fs:readDir` 如需共用逻辑，必须调用同一 helper，不能各写一份。
3. **稳定错误契约**：IPC 不把 Node `Error` 或堆栈直接返回 Renderer；使用有限错误码 `INVALID_PATH`、`NOT_FOUND`、`NOT_DIRECTORY`、`PERMISSION_DENIED`、`READ_FAILED`，并返回用户可展示的短消息。未知异常统一记录 Main 日志后映射为 `READ_FAILED`。
4. **最小 preload 暴露面**：`packages/electron/src/preload.ts` 只通过 `contextBridge` 暴露 `fs.listDirectory(dirPath)`，内部固定调用 `ipcRenderer.invoke("fs:listDirectory", { dirPath })`；Renderer 不得导入 Electron、调用 `ipcRenderer` 或直接使用 Node `fs`。
5. **只读与无副作用**：该通道只读取目录项元数据（名称、规范化绝对路径、目录标记、扩展名），不得读取文件内容、跟随目录树递归扫描或执行任何写操作。
6. **路径边界**：空字符串、空白字符串和非字符串参数直接返回 `INVALID_PATH`；不对预览路径强制绑定全局 workspace（工具可能打开 workspace 外的合法文件），但必须规范化 `.` / `..`，禁止把 `.git` 目录作为展示内容；符号链接不得被当作目录递归跟随。
7. **返回顺序唯一**：Main 统一按“目录优先 + 名称不区分大小写升序”返回；Renderer 只做防御性过滤，不二次排序，避免同一目录在不同入口出现不同顺序。
8. **请求竞态隔离**：IPC `invoke` 无需在 Main 侧维护 UI 状态；Popover 在 Renderer 为每次打开/展开生成递增请求序号，响应序号不是最新时丢弃，禁止旧目录响应覆盖当前目录。
9. **生命周期与日志**：Popover 卸载、关闭或切换文件时不保留全局监听器；IPC 失败只在开发日志记录原始错误，用户界面展示稳定错误码对应的中文提示。

### 8.7 验收标准（已通过）

- [x] AC8：对路径 `A > B > C > D > E.txt`，点击 `A` 展示 `A` 的文件/文件夹，点击 `B` 展示 `B` 的文件/文件夹，点击 `C` 或 `D` 时行为同理；点击 `E.txt` 时展示其父目录 `D`。每次浮层根目录都必须等于被点击的目录段，而不是固定使用当前文件父目录。
- [x] AC9：浮层展示目录优先、名称排序的直接子项；`.git` 和隐藏目录不可见；展开目录才发起对应 IPC 请求。
- [x] AC10：当前文件路径在浮层内自动展开并高亮；在文件、图片或 Diff 预览中点击另一个文本/Markdown/HTML/图片文件后关闭浮层并打开或激活正确的 Inspector Tab；重复点击不产生重复 Tab。
- [x] AC11：加载中、空目录、IPC 失败、无 preload bridge 四种状态均有稳定 UI，旧请求返回不会覆盖新打开的目录。
- [x] AC12：点击外部、再次点击路径段和 Escape 均可关闭浮层；键盘 Enter/Space 可展开目录或打开文件，正文滚动和现有工具栏按钮不受影响。
- [x] AC13：IPC 单元测试覆盖路径规范化、目录/文件排序、`.git`/隐藏目录过滤、符号链接不递归、错误码转换和返回结构；Renderer 测试覆盖 breadcrumb、懒加载、自动展开、文件打开去重、请求竞态和关闭行为。
- [x] AC14：`pnpm test`、renderer/Electron `tsc --noEmit` 和 `pnpm build` 通过，且现有 A3/A4 文件树与 FileRenderer 回归测试不受影响。

## 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-25 | FileRenderer 的 Git 能力访问统一使用 `window.desktop?.git?.`，并增加 preload bridge 缺失回归测试 | 开发环境 HMR/Preload 短暂不同步时，`window.desktop` 可能为空，不能因读取 `git` 让 Inspector 崩溃 |
