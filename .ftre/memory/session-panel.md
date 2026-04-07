# Session 面板 (会话管理)

> 顶层面板，展示所有工作区的会话列表，按 Workspace → Source 两级分组。**设计原则：彩色卡片区分工作区 + 粘性定位提升长列表体验 + 信息熵控制 + 时间感知视觉**

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/features/session/SessionPanel.tsx` | 独立面板组件，两级分组展示 |
| `packages/renderer/src/stores/session.ts` | Session store，`loadAllSessions`/`switchSession`/`loadWorkspaceSessions` |
| `packages/renderer/src/stores/workspace.ts` | Workspace store，`recentFolders`/`rootPath` |
| `packages/renderer/src/stores/layout.ts` | PanelId 包含 `sessions`，`panelOrder` 控制布局 |
| `packages/renderer/src/stores/stream.ts` | Stream store，`isSessionStreaming()` 检测流式状态 |
| `packages/renderer/src/components/LayoutSwitcher.tsx` | 面板管理器：平铺式、可拖拽、点击显隐 |
| `packages/renderer/src/app/TitleBar.tsx` | 承载 LayoutSwitcher |

## 布局位置

Session 面板是最左侧的顶层面板，和 sidebar/editor/chat 同级：

```
┌──────────────┬─────────────┬───────────────────┬────────────┐
│ Sessions     │ Sidebar     │     Editor        │   Chat     │
│ (会话列表)   │ (文件树等)  │                   │            │
└──────────────┴─────────────┴───────────────────┴────────────┘
```

## 两级分组结构

```
┌────────────────────────────────────────┐
│ [🔍] [Open] [📍]                       │  ← 顶部按钮区（搜索框+打开+定位）
├────────────────────────────────────────┤
│ ╭────────────────────────────────────╮ │
│ │ ▼ ftre-desktop         🔄 [+] ⋯  │ │  ← Workspace 分组，展开时彩色边框
│ │ E:/projects/ftre-desktop          │ │     header 粘性定位，吸顶效果
│ ├────────────────────────────────────┤ │
│ │ ── User ───────────────────────   │ │  ← Source 分割线（小字居中）
│ │    会话1              ⚡️ ⋯ 2h    │ │     流式中显示 loading，时间颜色渐变
│ │    会话2                  1d      │ │
│ │ ── Email (3) ─────────────────    │ │  ← 折叠时显示数量 (3)
│ ╰────────────────────────────────────╯ │
└────────────────────────────────────────┘
```

### Workspace 分组样式

**展开状态**（彩色边框卡片 + 粘性定位）：
- 外层容器：`mx-2 mt-2` + `rounded-lg border`，**统一处理边框和圆角**
- Header：`sticky top-0 z-10 backdrop-blur-sm` + `rounded-t-lg`，吸顶跟随滚动
- Content：`rounded-b-lg overflow-hidden`，确保内容不溢出圆角
- 颜色分配：12 种颜色循环，根据路径 hash 固定分配

**折叠状态**（精简列表项）：
- 无边框透明背景
- 不设置 sticky，正常跟随滚动
- **字体缩小**：工作区名称字号减小
- **高度降低**：header 高度压缩（无路径行）
- **路径隐藏**：不展示完整路径
- **目的**：减少未展开工作区的信息熵，让列表更清爽

### Workspace 分组头

- **展开时第一行**: ▼/▶ + 工作区名称 + (数量)，hover 时显示 `🔄` `[+]` `⋯`
- **展开时第二行**: 完整路径，灰色小字
- **折叠时**: 单行显示，字号缩小，无路径
- **交互**: 点击整行折叠/展开，当前工作区背景高亮
- **粘性定位**: `position: sticky; top: 0`，滚动时吸顶
- **`🔄`**: 刷新该工作区的会话列表（hover 显示）
- **`[+]`**: 在该工作区新建会话（hover 显示）
- **`⋯`**: 删除工作区（hover 显示）

### Source 分组

- 嵌套在 Workspace 下的二级分组
- 支持 `user`, `email`, `system` 等自定义 source
- **分割线样式**：`── User ──` 小字居中，边框颜色淡
- **折叠显示数量**：`── Email (3) ──`，点击整行切换
- **粘性定位**: `sticky top-[52px] z-[5] bg-surface`，位于 Workspace Header 下方
- **Label 大驼峰**: `User` / `Email` / `System`（非 uppercase）
- **会话列表限制**: 默认只显示前 5 个
  - 超过 5 个时显示「Show all (N)」按钮
  - 点击展开显示全部，按钮变为「Show less」
  - 状态管理：`expandedFullSources` (Set<string>)
- **默认展开策略**: 展开工作区时默认只展开 `User` source，其他 source 保持折叠

### Session 列表项

```
会话标题                    [⋯] 2h
```

- **标题**: 单行截断，`text-[12px]`
- **流式状态**: 正在输出时左侧显示旋转 loading 图标 (`Loader2` + `animate-spin`)
- **时间**: 相对时间（now/2h/1d），颜色渐变：越新越亮 (opacity 1.0)，越旧越暗 (opacity 0.4)
- **操作菜单**: `⋯` hover 显示，支持重命名、归档、删除会话
- **当前高亮**: 激活 session 背景 `bg-neon/10`

### 顶部按钮区

- **搜索框**: 🔍 图标 + 输入框，实时过滤 session title
- **Open**: 打开工作区选择器（缩小版按钮 h-7）
- **`📍`**: 定位当前活跃 session（LocateFixed 图标）
- 定位逻辑：先展开 session 所在的工作区和 source，延迟滚动到对应 DOM 元素

## 颜色系统

### Workspace 颜色

```typescript
const WORKSPACE_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f59e0b", // amber
  "#10b981", // emerald
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#f97316", // orange
  "#14b8a6", // teal
  "#e11d48", // rose
  "#a855f7", // purple
  "#84cc16", // lime
];

function getWorkspaceColor(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = path.charCodeAt(i) + ((hash << 5) - hash);
  }
  return WORKSPACE_COLORS[Math.abs(hash) % WORKSPACE_COLORS.length];
}
```

### 时间颜色渐变

```typescript
function timeAgo(ts: number): { text: string; opacity: number } {
  const diff = Date.now() / 1000 - ts;
  let text: string;
  if (diff < 60) text = "now";
  else if (diff < 3600) text = `${Math.floor(diff / 60)}m`;
  else if (diff < 86400) text = `${Math.floor(diff / 3600)}h`;
  else if (diff < 604800) text = `${Math.floor(diff / 86400)}d`;
  else text = `${Math.floor(diff / 604800)}w`;

  // 越新越亮 (1.0)，越旧越暗 (0.4)
  const opacity = Math.max(0.4, 1 - diff / (7 * 86400));
  return { text, opacity };
}
```

## 业务流程

### 点击会话
`SessionPanel:点击会话` → `sessionStore.switchSession(sessionId)` → `workspaceStore.switchTo(workspace)` → 切换到 Chat 面板

### 新建会话
点击工作区行的 `[+]` → `sessionStore.newSession(workspace)` → 切换到 Chat 面板

### 重命名会话
右键会话标题 `⋯` → 菜单「重命名」→ `setRenameDialog({ isOpen, sessionId, currentTitle })` → 输入新标题 → `updateSession(sessionId, { title })` → 成功后刷新会话列表

### 归档会话
右键会话标题 `⋯` → 菜单「归档会话」→ `triggerCompaction(sessionId)` → 异步归档任务触发

### 删除会话
右键会话标题 `⋯` → 菜单「删除」→ `sessionStore.deleteSession()`

### 添加工作区
点击底部 `[Open]` → `window.desktop.fs.selectFolder()` → 添加到工作区列表

### 定位当前 Session
点击 `[📍]` → `handleLocateCurrentSession` → 从 `allSessions` 找到当前 session → 展开对应工作区和 source → `setTimeout(..., 50)` → 滚动到 `currentSessionId` 对应的 DOM 元素

### 搜索过滤
输入搜索词 → `filteredWorkspaceGroups` computed → 按 session.title 过滤 → 实时更新列表

### 展开工作区
点击工作区行 → `toggleWorkspace(normalizedPath, displayPath)` → 
- 切换展开状态
- 展开时自动展开 `user` source
- **展开时强制异步刷新该工作区的会话列表** → `loadWorkspaceSessions(displayPath)`

### 刷新工作区会话列表
点击工作区行的 `🔄` → `handleRefreshWorkspace` → `loadWorkspaceSessions(displayPath)` → 异步请求该工作区的会话 → 合并到 `allSessions` 中

## Session 列表刷新机制

**全局刷新**（`loadAllSessions`）
- 触发条件：`recentFolders.length` 变化时（打开新工作区）
- 获取所有工作区的会话列表

**按需刷新**（`loadWorkspaceSessions`）
- 触发条件：展开工作区时自动触发，或手动点击刷新按钮
- 只请求指定工作区的会话列表
- 合并策略：从 `allSessions` 中移除该工作区的旧会话，添加新会话

```typescript
// SessionPanel.tsx
const recentFoldersCount = recentFolders.length;
useEffect(() => {
  loadAllSessions();
}, [loadAllSessions, recentFoldersCount]);

// 展开时触发刷新
const toggleWorkspace = useCallback((normalizedPath: string, displayPath: string) => {
  const wasExpanded = expandedWorkspaces.has(normalizedPath);
  setExpandedWorkspaces((prev) => {
    const next = new Set(prev);
    if (next.has(normalizedPath)) {
      next.delete(normalizedPath);
    } else {
      next.add(normalizedPath);
    }
    return next;
  });
  // 展开时：设置默认展开的 source，并刷新该工作区的会话列表
  if (!wasExpanded) {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      next.add(`${normalizedPath}:user`);
      return next;
    });
    loadWorkspaceSessions(displayPath);
  }
}, [expandedWorkspaces, loadWorkspaceSessions]);
```

**为什么要监听 length 而不是数组本身**？
- `loadAllSessions` 是 store 提供的函数，引用稳定
- `recentFolders` 是数组，每次渲染都是新引用
- 直接依赖 `recentFolders` 会导致无限循环刷新
- 依赖 `recentFolders.length` 只在数量变化（打开/关闭工作区）时触发

**核心数据结构**

```typescript
// SessionSummary
{
  session_id: string;
  title: string;
  workspace: string;    // 所属工作区路径
  source: string;       // user / email / system
  updated_at: number;
}

// PanelId
type PanelId = 'sessions' | 'sidebar' | 'editor' | 'chat'

// 组件内部状态
{
  expandedWorkspaces: Set<string>;    // 展开的工作区
  expandedSources: Set<string>;       // 展开的 source
  expandedFullSources: Set<string>;   // 展开全部 session 的 source
  searchQuery: string;                // 搜索关键词
  renameDialog: {                     // 重命名对话框状态
    isOpen: boolean;
    sessionId: string | null;
    currentTitle: string;
  };
}
```

## 设计决策

### UI 风格：彩色卡片区分工作区
- **展开时**: 彩色边框卡片包裹（12色循环，基于路径固定分配）
- **折叠时**: 无边框，简洁列表项
- **颜色稳定性**: 同一路径始终显示相同颜色，便于用户识别

### Source 分组：分割线 + 小字
- **去掉箭头**: 不再使用 ▼/▶ 树形结构，改为分割线样式
- **折叠显示数量**: `── Email (3) ──` 直观展示未读/总数
- **点击切换**: 点击整行展开/折叠，无需精确点击箭头
- **视觉降噪**: 小字 + 淡边框，降低信息熵

### 时间感知视觉
- **颜色渐变**: 基于时间差计算 opacity，新旧一目了然
- **相对时间**: now/2h/1d 比绝对时间更易读
- **不显示日期**: 简化认知负担

### 流式状态指示
- **检测方式**: `streamManager.isSessionStreaming(sessionId)`
- **视觉反馈**: 旋转 loading 图标，让用户知道 AI 正在输出
- **位置**: 紧邻 session 标题左侧

### 粘性定位（Sticky Header）
- **Workspace Header**: `sticky top-0 z-10`，吸顶在最上方
- **Source Header**: `sticky top-[52px] z-[5]`，吸顶在 Workspace Header 下方
- **实现**: `bg-surface backdrop-blur-sm`，滚动时半透明覆盖下方内容
- **行为**: 多个展开时自然堆叠，后面的 header 把前面的顶掉

### 边框设计：外层容器统一处理圆角
- **外层容器**: `rounded-lg border` 统一处理边框和圆角，避免内容遮挡
- **Header**: `rounded-t-lg`（折叠时加 `rounded-b-lg`）
- **Content**: `rounded-b-lg overflow-hidden` 确保内容不溢出圆角
- **颜色**: 边框使用 `${color}50`（50% 透明度），柔和不刺眼

### 功能架构
- **融合 Activity Bar**: 工作区切换整合到 SessionPanel，消除左侧多余栏位
- **两级分组**: Workspace 为一级，Source 为二级，清晰组织跨工作区会话
- **点击自动切换工作区**: 点击其他工作区的会话时，自动激活该工作区
- **分层操作**:
  - `🔄` 在工作区行 → 刷新该工作区的会话列表
  - `[+]` 在工作区行 → 新建该工作区的会话
  - `[Open]` 在顶部 → 添加新工作区
  - `[📍]` → 定位当前活跃 session

### Session 列表分页显示
- **默认显示 5 个**: 避免长列表 overwhelming
- **显式展开**: 用户主动点击「Show all」才显示全部
- **状态隔离**: `expandedFullSources` 按 source 路径存储，互不影响

### Source Label 大驼峰
- **去掉 uppercase**: `User` / `Email` / `System` 比 `USER` / `EMAIL` / `SYSTEM` 更现代
- **与数据一致**: Source 值本身就是小写，UI 层做首字母大写

### 搜索过滤
- **实时过滤**: 输入即过滤，无延迟
- **作用范围**: 只过滤 session title，不影响 workspace/source 结构
- **空状态**: 无匹配时显示 "No matching sessions"

### 信息熵控制原则
- **折叠状态精简**: 未展开的工作区缩小字号、降低高度、隐藏路径
- **默认只展 User**: 展开工作区时默认只展示 User source
- **时间颜色渐变**: 用视觉强度暗示新鲜度，无需阅读具体数字
- **分割线样式**: Source 分组不再占用过多视觉层级
- **渐进式披露**: 信息按需展示，而非一次性暴露所有内容

### 按需刷新策略
- **展开时刷新**: 展开工作区时自动异步请求该工作区的最新会话列表
- **避免全量刷新**: `loadWorkspaceSessions` 只请求单个工作区，而不是所有工作区
- **合并更新**: 将新数据合并到 `allSessions` 中，而不是完全替换

### 会话操作菜单设计
- **右键菜单选项**: 重命名（Pencil 图标）、归档会话（Archive 图标）、删除会话
- **重命名对话框**: 独立模态框，Enter 确认 / Escape 取消
- **API 调用**: `updateSession(sessionId, { title?, description? })` PUT 请求

## 注意事项

- **圆角边框遮挡问题**: 内层元素（如 Source 分组）会遮挡外层容器的圆角边框，解决方案是将边框统一移到外层容器 `rounded-lg border`，header 用 `rounded-t-lg`，content 用 `rounded-b-lg overflow-hidden` 确保内容不溢出圆角
- **overflow-hidden 与 sticky 冲突**: 父级设置 `overflow: hidden` 会导致 `position: sticky` 失效，边框移到外层容器后可避免此问题
- **多级 sticky 堆叠**: Workspace Header 和 Source Header 都需要 sticky，通过 `top` 值区分层级（0 vs 52px）
- **Source 分组**: 如果只有 User 分类但后端返回了其他 source，需要动态处理所有 source 值
- **颜色分配**: 基于路径 hash 计算，确保同一路径始终分配相同颜色
- **吸顶视觉**: sticky header 加 `backdrop-blur-sm`，滚动时不完全遮挡下方内容
- **session 定位**: 使用 `Map<string, HTMLElement>` 存储 ref，而非数组索引，避免排序变化导致错位；需要处理元素不存在的情况（延迟滚动）
- **搜索性能**: session 数量大时考虑防抖，当前实现直接过滤无性能问题
- **时间计算**: `timeAgo` 返回对象 `{text, opacity}`，渲染时内联 style 设置 opacity
- **刷新机制依赖陷阱**: `loadAllSessions` 是引用稳定的函数，`recentFolders` 是数组每次渲染都是新引用，必须用 `recentFolders.length` 作为 effect 依赖才能正确监听打开新工作区的事件
- **路径规范化不一致问题**: store 中的路径规范化**不要**将路径全部转小写，只对盘符开头的路径转小写；组件中 `normalizePath` 和 store 中的逻辑必须保持一致，否则导致路径比对失败
- **sessionRefs 内存泄漏**: ref 回调需要处理 `el === null` 的情况，及时调用 `delete` 清理已移除的 session 引用
- **setState 反模式**: 不要在 `setState((prev) => { ... })` 的回调内部调用另一个 `setState`，这样会导致不可预期的重渲染行为；应使用闭包变量记录状态变化，在 setState 外部处理副作用
- **定位功能实现**: `handleLocateCurrentSession` 需要先展开 session 所在的工作区和 source，等待 DOM 更新后再滚动；使用 `setTimeout(..., 50)` 确保展开状态已应用
