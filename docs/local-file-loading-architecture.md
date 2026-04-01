# 本地代码文件加载架构与性能分析

## 文档目的

本文档说明当前桌面客户端如何加载本地代码文件、相关模块之间如何协作，以及为什么当前设计在大工作区或大仓库下会出现**慢、卡、顿**的问题。

本文档聚焦以下问题：

1. 本地文件是如何从磁盘进入编辑器的
2. 工作区打开时发生了什么
3. 文件树、文件面板、Git、文件监听之间如何联动
4. 当前性能瓶颈在哪里
5. 后续优化应该按什么顺序推进

---

## 总体结论

当前客户端的本地文件加载链路是：

**Renderer(UI) → Preload Bridge → Electron Main IPC → Node.js 文件系统 / Git → Renderer Store → Monaco Editor**

整体架构清晰，但在性能设计上有几个明显问题：

- Main 进程执行了大量**同步 I/O**
- 编辑器恢复打开文件时采用了**串行逐文件读取**
- 文件面板每次打开都会**递归扫描整个工作区**
- 文件变更监听会触发**文件树刷新风暴**
- Git 状态查询使用**同步命令执行**
- 文件树展开后是**递归渲染**，缺少虚拟化
- 多个链路使用的是**全量刷新**而不是增量更新

这几个点叠加后，会让用户感知为：

- 打开工作区慢
- 打开文件慢
- 切换/刷新时顿一下
- 外部文件变化时 UI 卡顿
- 大仓库下尤其明显

---

# 1. 当前架构图

## 1.1 本地文件加载总览

```text
┌────────────────────────────────────────────────────────────────────┐
│                          Renderer Process                         │
│                                                                    │
│  Workbench / Explorer / FilePalette / EditorArea / MonacoEditor    │
│                │                     │                              │
│                │ 调用 window.desktop.fs.*                           │
│                ▼                     │                              │
│         Workspace Store / Editor Store / Git Service               │
└───────────────────────┬────────────────────────────────────────────┘
                        │
                        │ contextBridge + ipcRenderer.invoke
                        ▼
┌────────────────────────────────────────────────────────────────────┐
│                           Preload Bridge                           │
│                    packages/electron/src/preload.ts                │
└───────────────────────┬────────────────────────────────────────────┘
                        │
                        │ IPC
                        ▼
┌────────────────────────────────────────────────────────────────────┐
│                          Electron Main                             │
│                                                                    │
│   fs IPC handlers      watcher IPC handlers      git IPC handlers  │
│   fs:readDir           fs:watch / fs:unwatch     git:info          │
│   fs:readFile          fs:fileChanged            git:status        │
│   fs:writeFile                                    ...              │
└───────────────────────┬────────────────────────────────────────────┘
                        │
                        │ Node.js APIs
                        ▼
┌────────────────────────────────────────────────────────────────────┐
│                      Local Disk / Git Repository                   │
│   fs.readdirSync / fs.readFileSync / fs.writeFileSync / execSync   │
└────────────────────────────────────────────────────────────────────┘
```

---

## 1.2 打开工作区时的流程

```text
用户打开客户端
    │
    ▼
Workbench 挂载
    │
    ├─ 恢复 Layout（localStorage）
    │
    ├─ 恢复 Workspace（上次打开的 rootPath）
    │
    ├─ 恢复 Editor
    │     ├─ 读取已保存的打开标签元数据
    │     └─ 逐个通过 IPC 从磁盘重新读取每个文件内容
    │
    ├─ Explorer 读取 rootPath 根目录
    │
    ├─ 如果根目录存在 README，则自动打开 README
    │
    ├─ 建立 rootPath watcher
    │
    └─ GitService 设置 rootPath 并刷新 Git info / status
```

---

## 1.3 打开一个文件时的流程

```text
用户在 Explorer / Breadcrumb / FilePalette 中点击文件
    │
    ▼
Renderer 调用 window.desktop.fs.readFile(filePath)
    │
    ▼
Preload 通过 IPC 转发到 Main
    │
    ▼
Main 执行 fs.readFileSync(filePath, 'utf-8')
    │
    ▼
返回 { content, language }
    │
    ▼
Renderer 调用 useEditor.openFile(...)
    │
    ▼
MonacoEditor 挂载并显示内容
```

---

## 1.4 外部文件变更时的流程

```text
磁盘文件发生变化
    │
    ▼
Main 中 fs.watch 捕获变化
    │
    ▼
通过 fs:fileChanged 事件发回 Renderer
    │
    ├─ Workbench:
    │    ├─ 触发 parentDir tree-refresh
    │    └─ 触发 rootPath tree-refresh
    │
    ├─ ExplorerView:
    │    ├─ 重新 readDir(rootPath) 或 readDir(dirPath)
    │    └─ 更新 childrenMap / entries
    │
    ├─ GitService:
    │    └─ 监听 tree-refresh，防抖后刷新 git info / status
    │
    └─ EditorArea:
         ├─ 如果文件未修改，自动重新 readFile 并 refresh
         └─ 如果文件有未保存变更，弹通知询问是否重载
```

---

# 2. 关键模块职责

## 2.1 Renderer 层

### `Workbench`
负责应用级装配：

- 恢复 layout / workspace / editor
- 建立工作区 root watcher
- 接收文件变化事件
- 广播文件树刷新事件

### `ExplorerView`
负责文件树展示与目录读取：

- 读取根目录
- 读取展开目录的 children
- 管理展开状态
- 在新工作区首次加载时自动打开 README
- 响应 `ftre:tree-refresh`

### `FilePalette`
负责“快速打开文件”：

- 每次打开时递归扫描整个工作区
- 将所有文件收集到内存中
- 在前端进行模糊过滤
- 选中文件后再次读取内容并打开

### `EditorArea`
负责：

- 展示编辑器分组
- 监听外部文件变化
- 对打开文件建立额外 watcher
- 文件变化后自动刷新或通知用户

### `MonacoEditor`
负责：

- 真实编辑器实例挂载
- 内容修改时同步到 `editorCore`
- 仅在 dirty 状态变化时更新 store
- 保存和恢复 view state

### `Editor Store`
负责：

- 打开文件元数据
- 活跃标签/分组
- 最近文件
- 工作区切换时内存快照
- 重启后从 localStorage 恢复标签结构

---

## 2.2 Preload Bridge

Preload 通过 `contextBridge` 将一组安全 API 暴露给 Renderer，例如：

- `readDir`
- `readFile`
- `writeFile`
- `watch`
- `unwatch`
- `onFileChanged`
- `git.info`
- `git.status`

这一层本身很薄，主要作用是桥接，不是性能瓶颈核心，但会放大 IPC 次数带来的成本。

---

## 2.3 Main 进程

### 文件系统 IPC
当前承担：

- 读取目录
- 读取文件
- 写入文件
- 重命名 / 删除 / 创建
- 选择文件夹
- 显示保存对话框

### watcher IPC
当前承担：

- `fs.watch(path, { recursive: true })`
- 将变更路径聚合后回发给 Renderer

### git IPC
当前承担：

- 获取分支与变更数
- 获取 `git status`
- stage / unstage / commit
- 读取 git diff 内容

---

# 3. 当前设计为什么慢

## 3.1 Main 进程使用了同步 I/O

当前 Main 进程里大量调用同步 API，例如：

- `fs.readdirSync`
- `fs.readFileSync`
- `fs.writeFileSync`
- `fs.renameSync`
- `fs.rmSync`

以及 Git 侧的：

- `execSync("git ...")`

### 这会造成什么问题

Electron Main 进程本质上是一个事件循环中心。  
当它执行同步 I/O 时：

- 当前调用线程被阻塞
- 其他 IPC 需要排队
- 文件监听、菜单、窗口交互等都可能被拖慢

也就是说：

> 即使 Renderer 是异步调用，Main 仍然可能因为同步磁盘操作而整体卡住。

### 典型感知

- 点开目录时明显停顿
- 点开文件要等一会儿
- 多个读取同时发生时响应更差
- 大仓库下 UI 容易出现“顿一下”

---

## 3.2 编辑器恢复采用串行逐文件读取

当前编辑器恢复逻辑会读取 localStorage 中保存的标签结构，然后：

- 按 group 遍历
- 按 file 遍历
- 对每个文件执行一次 `await readFile(...)`

### 这是最慢的一种恢复方式

因为它具备三个特征：

1. 全量恢复内容
2. 每个文件单独发一次 IPC
3. 串行等待上一个完成再读下一个

### 结果

如果用户上次打开了很多文件：

- 启动时间会明显增长
- 每增加一个已打开文件，恢复都会更慢
- 在 Windows / 杀毒软件环境中更明显

### 正确方向

- 先恢复标签元数据，不急于恢复全部内容
- 只立刻加载 active file
- 其他文件按需懒加载
- 如果必须预加载，也应采用并发受限读取，而不是串行

---

## 3.3 FilePalette 每次打开都递归扫描整个工作区

当前 `FilePalette` 的实现方式是：

- 打开时从 `rootPath` 开始
- 递归调用 `readDir`
- 扫描全部子目录与文件
- 最后把所有文件放进 `allFiles`

### 这个设计的问题

1. 每次打开都重新扫描
2. 扫描是递归的
3. 递归过程是串行 `await`
4. 每一级目录读取都要跨一次 IPC
5. Main 端目录读取还是同步的

### 实际影响

在中大型项目中，打开文件面板时就会出现：

- 首次很慢
- 再次打开依然慢
- CPU / IPC / 磁盘都被浪费

### 更合理的方案

- 工作区建立文件索引
- 监听文件变化后增量更新索引
- 面板打开时直接读缓存
- 或者在后台异步预热索引

---

## 3.4 watcher 设计会引发刷新风暴

当前有两类 watcher：

1. `Workbench` 对整个 `rootPath` 建立 watcher
2. `EditorArea` 对每个已打开文件再建立 watcher

### 这会带来的问题

- 同一文件变更可能被 root watcher 和 file watcher 都感知
- 一次文件变更会触发多个回调
- 回调里又会发出多个 tree refresh 事件

尤其是当前 root watcher 处理逻辑里，发生任意文件变化时会：

- 刷新父目录
- 再刷新整个根目录

这相当于把细粒度事件放大成粗粒度刷新。

### 后果

- Explorer 更频繁地重新 `readDir(rootPath)`
- childrenMap 更频繁更新
- GitService 更频繁被唤醒
- UI 更容易抖动和卡顿

---

## 3.5 Git 状态查询使用同步执行，且刷新频率偏高

Git 相关逻辑当前通过同步命令执行：

- `git rev-parse`
- `git status --porcelain`
- 其他 diff / stage / reset

### 为什么这也会拖慢文件体验

因为 Git 刷新并不是孤立存在的，它和文件树刷新有联动：

- 工作区切换会触发 Git 刷新
- tree refresh 也会触发 GitService 防抖刷新

在大仓库里，`git status` 本身就不轻。  
如果再放到 Main 进程中同步执行，就会进一步加重卡顿。

### 用户感知

- 切工作区慢
- 改文件后侧边栏或状态栏更新时顿
- Git 仓库越大越明显

---

## 3.6 文件树没有虚拟化，展开多时渲染成本高

当前文件树是递归组件结构。  
虽然单个节点做了 `memo`，但本质上仍然是：

- 状态变化时整棵可见树都要参与比较
- 展开层级越深，可见节点越多
- active / focused / dragOver / gitStatus 等状态都可能触发更新

### 在以下场景会放大卡顿

- 展开很多目录
- 大量文件同时显示
- Git 状态着色打开
- 高频 tree refresh
- 拖拽交互

---

# 4. “慢”和“卡”的根因拆解

## 4.1 “慢”主要来自 I/O 与调度策略
“慢”更偏向等待时间，通常来自：

- 同步磁盘读取
- 串行恢复
- 全量扫描
- 同步 Git 调用
- IPC 次数太多

## 4.2 “卡”主要来自刷新风暴与渲染放大
“卡”更偏向交互不顺滑，通常来自：

- Main 进程被同步任务阻塞
- watcher 事件过多
- root 级刷新过于粗暴
- Explorer/Git/UI 连锁更新
- 树渲染节点过多

---

# 5. 当前设计的优点

虽然性能有问题，但当前设计也有一些不错的基础：

## 5.1 责任分层相对清晰
- Renderer 负责交互和状态
- Preload 负责桥接
- Main 负责系统能力
- `editorCore` 负责非响应式内容管理

## 5.2 编辑器内容没有完全塞进 React 高频更新链路
`MonacoEditor` 使用了 `editorCore` 来管理内容和 view state，避免了每次输入都把完整文本塞回 Zustand/React。

这说明：

> 当前输入卡顿不一定是 Monaco 本身导致，更多是外围文件系统、监听、Git、刷新链路导致。

## 5.3 工作区快照机制方向是对的
工作区切换时支持内存快照恢复，这个方向很好。  
如果后面把磁盘恢复策略进一步优化，会有很大收益。

---

# 6. 优化优先级建议

下面按“收益 / 风险 / 改动性价比”排序。

---

## P0：必须优先处理

### 6.1 把 Main 进程同步 fs 改为异步
将以下能力改为异步版本：

- `readDir`
- `readFile`
- `writeFile`
- `rename`
- `delete`

### 价值
- 直接降低 Main 线程阻塞
- 让 IPC 响应更平滑
- 对整个系统都有收益

---

### 6.2 把编辑器恢复改为“懒恢复”
建议改为：

- 先恢复标签结构
- 只立即加载 active file
- 其余标签在激活时再加载

如果业务要求预加载，也应：

- 使用并发受限方案
- 控制并发数而非串行

### 价值
- 启动速度显著提升
- 打开工作区体感改善最明显

---

### 6.3 重写 FilePalette 的文件收集策略
不要“每次打开都全盘递归扫描”。

建议改成：

- 工作区索引缓存
- watcher 增量更新
- 首次后台建立索引
- 打开面板时直接查询缓存

### 价值
- 快速打开文件体验明显提升
- 减少大量重复扫描和 IPC

---

## P1：高收益改进

### 6.4 简化 watcher 拓扑
建议：

- 优先只保留 root watcher
- 减少每个打开文件的独立 watcher
- 做事件归并
- 只刷新必要目录
- 不要任何变化都刷新 `rootPath`

### 价值
- 大幅减少 tree refresh 频率
- 降低 Explorer 与 Git 联动开销

---

### 6.5 Git 改为异步 + 降频
建议：

- 改为异步子进程
- 区分轻量信息和重量状态
- Git panel 不可见时减少刷新
- tree refresh 不应强绑定全量 Git refresh

### 价值
- 对大仓库效果显著
- 减少外部变化时的卡顿放大

---

## P2：体验增强

### 6.6 文件树虚拟化
对展开后的长列表做虚拟渲染。

### 价值
- 大文件树下滚动与刷新更顺滑
- 能承接前面 I/O 优化带来的收益

---

### 6.7 细化刷新粒度
当前很多地方是“整个 root 重新读一遍”。

后续应改成：

- 哪个目录变了就只刷新哪个目录
- 哪个文件变了就只更新哪个文件
- Git 状态更新也尽量只更新受影响节点

---

# 7. 推荐的目标架构

## 7.1 理想的数据流

```text
Renderer
  ├─ Explorer 使用目录缓存
  ├─ FilePalette 使用文件索引缓存
  ├─ Editor 按需加载文件内容
  └─ Git 使用异步缓存服务

Preload
  └─ 薄桥接，不做重逻辑

Main
  ├─ 全部文件系统操作改为异步
  ├─ watcher 统一管理并做事件归并
  ├─ Git 查询异步化
  └─ 提供批量/缓存友好的 IPC 接口

Disk / Git
  ├─ 目录读取异步
  ├─ 文件读取异步
  └─ Git 状态异步 + 防抖 + 缓存
```

---

## 7.2 推荐的目标行为

### 打开工作区
- 立即展示 UI 框架
- 快速显示根目录
- 标签先恢复结构
- 只读 active 文件内容
- 其余异步补齐或懒加载

### 打开文件
- 读取文件内容
- 进入 `editorCore`
- 只更新需要更新的编辑器实例

### 文件面板
- 直接查询索引
- 毫秒级返回前 50 条结果
- 不在打开时重新全盘扫描

### 文件变化
- watcher 合并事件
- 仅刷新受影响目录或文件
- Git 在需要时再刷新

---

# 8. 一句话总结

当前客户端“本地代码文件加载”之所以慢，不是因为单个模块特别差，而是因为它采用了：

**同步 I/O + 串行恢复 + 全量扫描 + 高频刷新 + 同步 Git**

这种组合在小项目里可以工作，但在中大型项目中会迅速放大为明显的卡顿体验。

---

# 9. 后续落地建议

建议分三批推进：

## 第一批
- Main 进程文件系统改异步
- 编辑器恢复改懒加载
- FilePalette 改索引缓存

## 第二批
- watcher 统一管理与事件归并
- Git 异步化与降频
- tree refresh 改增量

## 第三批
- Explorer 虚拟化
- 更细粒度缓存
- 更系统化性能监控与 profiling

---

# 10. 附录：当前关键链路简表

| 链路 | 当前行为 | 主要问题 |
|---|---|---|
| 打开工作区 | 恢复 workspace + 恢复 editor + 读 root + 读 README + 刷 Git | 启动链路太长 |
| 恢复已打开文件 | 串行逐文件 `readFile` | IPC 多、等待长 |
| 打开文件 | 单文件 `readFile` | 单次还好，但 Main 同步 I/O 会堵塞 |
| 文件面板 | 每次递归扫描全项目 | 重复工作、成本高 |
| 外部文件变化 | root watcher + file watcher + tree refresh + Git refresh | 刷新风暴 |
| Git 状态 | Main 同步执行命令 | 大仓库下明显卡顿 |
| 文件树渲染 | 递归渲染、无虚拟化 | 展开多时渲染成本高 |

---

# 11. 推荐下一步文档

在本文件基础上，建议继续补两份设计文档：

1. `local-file-loading-optimization-plan.md`
   - 明确重构顺序、风险、验收标准

2. `watcher-and-indexing-design.md`
   - 单独设计 watcher、文件索引、缓存、增量刷新机制

---
