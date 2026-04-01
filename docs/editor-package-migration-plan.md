# 编辑器独立包拆分方案与迁移计划

## 文档目标

本文档用于规划将当前桌面客户端中的编辑器子系统从 `packages/renderer` 中拆分出来，形成一个独立的包：

- `packages/editor`
- 包名建议：`@ftre/editor`

拆分的目标不是“为了目录更好看”，而是为了把编辑器变成一个**可独立优化、可独立测试、可独立观测、可独立演进**的性能边界。

---

## 一句话结论

当前编辑器相关能力已经从“一个前端功能模块”演化成了“一个独立运行时子系统”。

继续把它塞在 `renderer` 里，会越来越难解决这些核心问题：

- Monaco 冷启动慢
- 点击文件到内容可见的链路不够快
- 文件 hydration / editor instance / cache 生命周期复杂
- 竞态问题难以定位和收敛
- 性能优化和 UI 业务逻辑耦合严重

因此，建议将编辑器拆成独立包，并采用**渐进迁移**而不是一次性大爆炸迁移。

---

# 1. 当前问题背景

## 1.1 当前编辑器相关能力已经过大

目前分散在 `packages/renderer` 中的编辑器逻辑，实际上已经包含：

- Monaco Editor 挂载与配置
- Monaco Diff Viewer
- `editorCore` 内容缓存与实例注册
- 编辑器标签与分组
- 文件懒加载 / hydration
- view state 保存与恢复
- diff tab 管理
- 语言模式切换
- 打开文件时序优化
- 外部文件变化同步
- 编辑器命令与保存逻辑
- 部分性能保护与竞态修复

这些能力组合起来，本质上已经构成了一个独立的编辑器子系统。

---

## 1.2 当前主要痛点

### 业务层与编辑器运行时耦合
当前 `renderer` 同时承担：

- 工作台布局
- 文件树与工作区切换
- 聊天与工具交互
- 编辑器模型生命周期
- Monaco 运行时逻辑

这使得“编辑器性能问题”和“业务 UI 问题”混在一起，难以切边界。

### 难以针对 Monaco 做系统级优化
例如这些工作后续都值得做，但当前边界不够清晰：

- Monaco 预热
- worker 预热
- model 复用
- 打开文件 pipeline
- 大文件降级
- 显式 loading model
- editor 生命周期收敛
- editor metrics 面板

### 竞态问题难定位
例如之前已经出现过的：

- 文件偶现空白
- mount / hydrate / unmount 之间缓存污染
- 已打开文件再次切换时偶现异常

这类问题说明当前编辑器内部状态机不够收口。

---

# 2. 拆分目标

## 2.1 功能目标

将编辑器相关能力沉淀为独立包，使其能够：

- 被 `renderer` 作为依赖消费
- 独立管理编辑器内核能力
- 统一文件打开 / hydration / 保存 / diff 流程
- 独立做性能优化和回归测试

---

## 2.2 工程目标

拆分后要满足：

- 包边界清晰
- React UI 与 editor runtime 解耦
- 非响应式核心尽量下沉
- 宿主（renderer）只通过明确接口接入
- 后续支持独立 profiling / metrics / prewarm / cache policy

---

## 2.3 性能目标

拆包本身不会自动提速，但它应该为后续性能优化提供稳定边界。

目标包括：

- 缩短“点击文件 → tab 激活 → 内容可见”的感知延迟
- 降低 Monaco 首次加载冷启动成本
- 降低 model / instance 生命周期混乱造成的竞态
- 引入更明确的打开文件状态机
- 为大文件策略和 worker 预热提供落点

---

# 3. 当前架构图

## 3.1 当前结构总览

```text
┌────────────────────────────────────────────────────────────────────┐
│                         @ftre/renderer                            │
│                                                                    │
│  Workbench / Explorer / Search / Chat / TitleBar / StatusBar       │
│                │                                                    │
│                ├─ useWorkspace                                      │
│                ├─ useLayout                                         │
│                ├─ useSearch                                         │
│                ├─ useChat                                           │
│                └─ useEditor                                         │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │               当前也在 renderer 内部的编辑器能力            │   │
│  │                                                              │   │
│  │  EditorArea / MonacoEditor / MonacoDiffViewer / TabBar       │   │
│  │  Breadcrumb / DiffBar / editor commands / editorCore         │   │
│  │  hydrate / cache / instance registry / file open pipeline    │   │
│  └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

---

## 3.2 当前打开文件链路（简化）

```text
用户点击文件
   │
   ▼
Explorer / Search / Palette / ToolAction
   │
   ▼
window.desktop.fs.readFile(...) 或 open placeholder tab
   │
   ▼
useEditor.openFile(...)
   │
   ▼
MonacoEditor mount
   │
   ├─ editorCore registerInstance
   ├─ hydrateFileContent / refreshFile
   ├─ sync content / disk content / dirty state
   └─ view state restore
   ▼
文件内容显示
```

---

## 3.3 当前问题本质

```text
宿主业务层
  + 编辑器 UI
  + 编辑器 runtime
  + editorCore
  + Monaco 生命周期
  + 打开文件状态机
  + 缓存 / hydration / unmount cleanup
全部混在 renderer 内部
```

这使得：

- 性能优化难单独推进
- 文件打开链路难单独建模
- Monaco 生命周期 bug 容易污染业务层状态
- 测试边界不清晰

---

# 4. 目标架构图

## 4.1 拆分后总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│                         @ftre/renderer                            │
│                                                                    │
│  Workbench / Explorer / Search / Chat / TitleBar / StatusBar       │
│                                                                    │
│   只负责：                                                          │
│   - 工作台布局                                                      │
│   - 工作区与文件树                                                  │
│   - 搜索 / 聊天 / 业务交互                                          │
│   - 宿主级状态协调                                                  │
│                                                                    │
│                       consumes @ftre/editor                        │
└───────────────────────────────┬────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                          @ftre/editor                              │
│                                                                    │
│  editor-ui                                                          │
│   - EditorArea                                                      │
│   - MonacoEditor                                                    │
│   - MonacoDiffViewer                                                │
│   - TabBar / Breadcrumb / DiffBar                                  │
│                                                                    │
│  editor-runtime                                                     │
│   - file open pipeline                                              │
│   - hydration / save / refresh                                      │
│   - prewarm / worker lifecycle                                      │
│   - perf metrics                                                    │
│   - host bridge adapter                                             │
│                                                                    │
│  editor-core                                                        │
│   - content cache                                                   │
│   - disk snapshot cache                                             │
│   - instance registry                                               │
│   - view state                                                      │
│   - dirty tracking                                                  │
│   - model lifecycle                                                 │
└───────────────────────────────┬────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                 Electron / Preload / Desktop APIs                  │
│                 fs / git / watcher / store / shell                 │
└────────────────────────────────────────────────────────────────────┘
```

---

## 4.2 目标分层原则

### `renderer`
负责“宿主工作台”

### `@ftre/editor/editor-ui`
负责“编辑器表现层”

### `@ftre/editor/editor-runtime`
负责“编辑器运行时协调”

### `@ftre/editor/editor-core`
负责“编辑器非响应式内核”

---

# 5. 新包建议结构

建议新增目录：

```text
packages/
  editor/
    package.json
    tsconfig.json
    src/
      index.ts

      core/
        editor-core.ts
        content-cache.ts
        instance-registry.ts
        view-state.ts
        hydration-state.ts
        large-file-policy.ts

      runtime/
        open-file.ts
        hydrate-file.ts
        refresh-file.ts
        save-file.ts
        prewarm.ts
        metrics.ts
        host-bridge.ts
        editor-session.ts

      ui/
        EditorArea.tsx
        MonacoEditor.tsx
        MonacoDiffViewer.tsx
        TabBar.tsx
        Breadcrumb.tsx
        DiffBar.tsx

      hooks/
        useEditorRuntime.ts
        useEditorCommands.ts
        useEditorMetrics.ts

      store/
        editor-store.ts
        editor-selectors.ts

      types/
        editor-types.ts
        host-types.ts
```

---

# 6. 包边界设计

## 6.1 `renderer` 应该保留的职责

以下能力建议继续留在 `@ftre/renderer`：

- `Workbench`
- `Explorer`
- `SearchPanel`
- `FilePalette`
- `ChatPanel`
- `TitleBar`
- `StatusBar`
- `Workspace store`
- `Layout store`
- 宿主级通知和工作区切换逻辑

### 原因
这些是工作台宿主层，不是编辑器内核。

---

## 6.2 `@ftre/editor` 应该承载的职责

### UI 层
- `EditorArea`
- `MonacoEditor`
- `MonacoDiffViewer`
- `TabBar`
- `Breadcrumb`
- `DiffBar`

### Runtime 层
- 打开文件 pipeline
- 占位打开与内容 hydration
- refresh / save / dirty tracking
- 预热逻辑
- 文件可见性状态
- 编辑器 metrics

### Core 层
- content cache
- disk snapshot
- view state
- instance registry
- model 生命周期
- dirty 检测

---

## 6.3 宿主与编辑器包之间的接口

建议 `renderer` 不直接操作 editor 内部实现，而是通过明确接口通信。

### 例如：

```text
renderer -> @ftre/editor
- openFile(path, meta)
- revealLine(path, line, col)
- applyDiff(...)
- setLanguage(...)
- getEditorMetrics()

@ftre/editor -> renderer host
- readFile(path)
- writeFile(path, content)
- watch(path)
- unwatch(path)
- emitNotification(...)
- getWorkspace()
```

---

# 7. 核心设计原则

## 7.1 先拆“运行时边界”，再拆“目录”
不要只做机械搬文件。

真正应该先做的是：

- editor runtime 收口
- editorCore 收口
- open/hydrate/save pipeline 收口
- 宿主接口显式化

然后再搬目录和组件。

---

## 7.2 让非 React 核心下沉
真正影响性能和稳定性的部分，不应该继续挂在 React 高频渲染路径上。

建议下沉的部分包括：

- content maps
- disk snapshot
- dirty state
- instance registry
- model lifecycle
- hydration state
- prewarm state
- large file policy

---

## 7.3 UI 只是外壳
`MonacoEditor.tsx`、`EditorArea.tsx` 这类组件应该越来越“薄”：

- 负责 mount / render / event binding
- 不承担复杂状态机

复杂逻辑应下沉到 runtime / core。

---

## 7.4 打开文件链路必须建模成状态机
建议在新包里显式定义文件打开状态：

- `idle`
- `opening`
- `placeholder`
- `hydrating`
- `ready`
- `error`

这样后续才能稳定支持：

- loading editor
- 骨架态
- retry
- metrics
- 竞态控制
- 防空白污染

---

# 8. 渐进迁移计划

## Phase 0：准备阶段
### 目标
建立新包与边界，不改变现有行为。

### 工作
- 创建 `packages/editor`
- 建立 `package.json`
- 接入 monorepo workspace
- 预留 `index.ts`
- 明确 `renderer -> editor` 的依赖方向
- 定义基础 types

### 产出
- 新包存在，但还未承载实际逻辑

---

## Phase 1：先迁 core
### 目标
把真正的非响应式内核先移过去。

### 优先迁移
- `editorCore`
- content cache
- instance registry
- view state
- dirty 相关逻辑

### 原则
- `renderer` 暂时继续使用旧 UI
- 底层 import 改为从 `@ftre/editor/core` 获取

### 收益
- 最关键的性能/稳定性内核开始收口
- 不会一次动太多 UI

---

## Phase 2：迁 runtime pipeline
### 目标
把最容易出竞态、最值得优化的链路独立出来。

### 优先迁移
- openFile pipeline
- hydrateFileContent
- refreshFile
- saveFile
- prewarm
- metrics
- loading state 管理

### 重点
这一阶段要开始明确：

- 点击文件 → 立即激活 tab
- Monaco mount / hydrate
- 缓存同步
- unmount 写回保护
- error fallback

### 收益
- 文件打开时序可以被单独治理
- Monaco 性能优化开始有明确落点

---

## Phase 3：迁 Monaco UI 组件
### 目标
让宿主不再直接持有 Monaco 相关实现。

### 迁移对象
- `MonacoEditor`
- `MonacoDiffViewer`
- `EditorArea`
- `DiffBar`

### 原则
- 宿主继续传入明确 props
- 编辑器包内部消化 Monaco 细节

### 收益
- Monaco 优化和业务页面彻底解耦

---

## Phase 4：迁标签与导航 UI
### 目标
收口 editor 的 UI 子系统。

### 迁移对象
- `TabBar`
- `Breadcrumb`

### 收益
- 编辑器 package 形成相对完整 UI 面
- 宿主只负责工作台级组合

---

## Phase 5：收口 editor store
### 目标
把编辑器状态彻底内聚。

### 迁移对象
- `stores/editor.ts`
- editor selectors
- commands

### 注意
这一阶段风险最高，要在前面阶段稳定后再做。

### 收益
- `renderer` 中不再混有编辑器内部状态
- 编辑器包真正成为独立运行单元

---

# 9. 推荐迁移顺序（现实执行版）

建议实际执行时按下面顺序走：

1. 创建 `packages/editor`
2. 迁 `editorCore`
3. 迁 hydration / open / save pipeline
4. 迁 Monaco 组件
5. 迁 EditorArea
6. 迁 TabBar / Breadcrumb
7. 最后迁 editor store

### 原因
这是风险最低、收益最高的顺序。

---

# 10. 风险分析

## 10.1 风险：只是挪目录，没有收边界
如果只是把文件搬过去，但逻辑还是互相穿透：

- 性能不会变好
- 维护复杂度会增加
- 依赖会更混乱

### 对策
先定义边界，再迁移。

---

## 10.2 风险：一次迁太多，导致编辑器回归
编辑器链路非常敏感，尤其文件打开、切换、保存、diff。

### 对策
- 分阶段迁
- 每阶段都可 build / 可验证
- 每阶段补回归测试

---

## 10.3 风险：Monaco 生命周期问题被放大
`@monaco-editor/react`、非受控 `defaultValue`、实例注册等都很敏感。

### 对策
迁 runtime 时顺手把打开文件状态机显式化，不要继续依赖隐式竞态修补。

---

## 10.4 风险：包边界太理想化，宿主接不住
如果 editor 包强行吞下太多业务责任，反而会失衡。

### 对策
明确原则：

- workspace / explorer / chat / layout 仍归宿主
- editor package 只负责编辑器能力

---

# 11. 测试与验证策略

## 11.1 每阶段最低要求
每做完一个阶段，至少保证：

- 构建通过
- 打开文件正常
- 切换标签正常
- 保存正常
- diff 正常
- 外部文件变化刷新正常

---

## 11.2 必须补的关键回归测试

### 文件打开链路
- 第一次打开文件
- 已打开文件切换再回来
- 占位 tab hydrate
- 打开后立即切走
- 快速连续切换多个文件

### 缓存与生命周期
- mount 时内容同步
- unmount 不污染缓存
- view state 保持
- dirty 状态正确

### UI 层
- tab 切换
- split editor
- diff tab
- breadcrumb 导航

---

## 11.3 必须引入的性能观察项
新包拆出来之后，建议持续记录：

- 点击文件到 tab 激活时间
- 点击文件到内容可见时间
- Monaco mount 时间
- worker 首次激活时间
- hydrate 时间
- refresh 时间
- save 时间
- 大文件打开耗时

---

# 12. 拆包之后优先要做的优化

一旦编辑器包边界稳定，建议优先做这几项：

## 12.1 Monaco 预热
- 应用空闲时预热 Monaco
- 预热常用语言 worker

## 12.2 loading editor
- placeholder tab 进入 loading editor
- 不再给用户“点了没反应 / 偶现空白”的感知

## 12.3 大文件策略
- 超过阈值的文件采用降级模式
- 控制 tokenizer / decorations / diff 行为

## 12.4 model 生命周期收敛
- 更明确的 model cache
- 更明确的 attach / detach / reuse

## 12.5 metrics 面板
- 不只是 `window.__ftrePerf`
- 后续可以做一个开发态面板

---

# 13. 对现有仓库的影响

## 13.1 workspace 已支持
当前 `pnpm-workspace.yaml` 已包含：

- `packages/*`

所以新增 `packages/editor` 能直接纳入 workspace。

---

## 13.2 根构建脚本后续需要更新
当前根 `package.json` 只有：

- `@ftre/shared`
- `@ftre/electron`
- `@ftre/renderer`

后续需要把：

- `@ftre/editor`

纳入：

- `dev`
- `build`
- `clean`

等脚本链路。

---

## 13.3 renderer 将成为宿主
拆分完成后，`renderer` 应该更像：

- 工作台容器
- 宿主状态协调层
- `@ftre/editor` 的消费方

而不是继续承载编辑器底层细节。

---

# 14. 建议的阶段性里程碑

## Milestone 1
新包建立，editor core 已迁移，现有功能不回归。

## Milestone 2
打开文件 pipeline 已迁移，Monaco 相关竞态开始收口。

## Milestone 3
Monaco UI 组件从 renderer 中抽离，宿主只通过包消费。

## Milestone 4
editor store 收口完成，编辑器真正成为独立子系统。

---

# 15. 最终建议

## 建议采用：渐进迁移
不要做“一次性大搬家”。

## 不建议采用：直接整体复制 `features/editor` 到新包
这样风险高，而且不会自然带来性能收益。

## 最推荐的策略
先迁：

- core
- runtime
- 打开文件链路

再迁：

- Monaco UI
- 编辑器周边 UI
- store

---

# 16. 最终结论

将编辑器拆成 `packages/editor` 是正确方向，但它的真正价值不在“目录拆开”，而在于：

- 把编辑器做成明确的性能边界
- 把 Monaco 运行时从宿主工作台里剥离出来
- 把文件打开 / hydration / cache / lifecycle 建模清楚
- 为后续真正的性能优化创造条件

因此建议立即开始，但必须按阶段推进。

---

# 17. 下一步行动建议

建议下一步按下面顺序执行：

1. 创建 `packages/editor`
2. 定义 package 导出边界
3. 迁移 `editorCore`
4. 迁移 open/hydrate/save runtime
5. 让 `renderer` 接回新包
6. 再逐步迁移 Monaco UI 与 store

---

# 18. 补充说明

本计划文档聚焦的是**拆包与架构演进**。  
它不是一次性迁移清单，也不是具体代码实现文档。

后续建议再补两份文档：

1. `editor-package-phase-1-checklist.md`
   - 第一阶段的具体迁移清单

2. `editor-runtime-open-file-state-machine.md`
   - 文件打开、hydrate、mount、unmount 的显式状态机设计