# Session 面板 (会话管理)

> 顶层面板，展示所有工作区的会话列表，按 Workspace → Source 两级分组。**设计原则：彩色卡片区分工作区 + 粘性定位提升长列表体验 + 信息熵控制 + 时间感知视觉**

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/features/session/SessionPanel.tsx` | 独立面板组件，两级分组展示 |
| `packages/renderer/src/stores/session.ts` | Session store，`loadAllSessions`/`switchSession` |
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
│ │ ▼ ftre-desktop              [+] ⋯ │ │  ← Workspace 分组，展开时彩色边框
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
- 外层容器：`mx-2 mt-2`，**无边框**（边框移到 header 和 content）
- Header：`sticky top-0 z-10 backdrop-blur-sm`，吸顶跟随滚动
- Content：左右下三边框，与 header 无缝拼接
- 颜色分配：12 种颜色循环，根据路径 hash 固定分配

**折叠状态**（精简列表项）：
- 无边框透明背景
- 不设置 sticky，正常跟随滚动
- **字体缩小**：工作区名称字号减小
- **高度降低**：header 高度压缩（无路径行）
- **路径隐藏**：不展示完整路径
- **目的**：减少未展开工作区的信息熵，让列表更清爽

### Workspace 分组头

- **展开时第一行**: ▼/▶ + 工作区名称 + (数量)，hover 时显示 `[+]` `⋯`
- **展开时第二行**: 完整路径，灰色小字
- **折叠时**: 单行显示，字号缩小，无路径
- **交互**: 点击整行折叠/展开，当前工作区背景高亮
- **粘性定位**: `position: sticky; top: 0`，滚动时吸顶
- **[+]**: 在该工作区新建会话（hover 显示）
- **⋯**: 删除工作区（hover 显示）

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
- **操作菜单**: `⋯` hover 显示，支持删除会话
- **当前高亮**: 激活 session 背景 `bg-neon/10`

### 顶部按钮区

- **搜索框**: 🔍 图标 + 输入框，实时过滤 session title
- **Open**: 打开工作区选择器（缩小版按钮 h-7）
- **📍**: 定位当前活跃 session（LocateFixed 图标）
- 定位逻辑：`sessionRefs.current.get(sessionId)?.scrollIntoView()`

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

### 删除会话
点击 `⋯` → 菜单「删除」→ `sessionStore.deleteSession()`

### 添加工作区
点击底部 `[Open]` → `window.desktop.fs.selectFolder()` → 添加到工作区列表

### 定位当前 Session
点击 `[📍]` → `handleLocateCurrentSession` → 滚动到 `currentSessionId` 对应的 DOM 元素

### 搜索过滤
输入搜索词 → `filteredWorkspaceGroups` computed → 按 session.title 过滤 → 实时更新列表

## 关键数据结构

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

### 边框设计
- **Header**: 始终有 `border: 1px solid`，展开时 `${color}50` + `borderBottom: none`，折叠时 `transparent`，`transition` 平滑过渡
- **Content**: 只保留左右下三边框 `borderRadius: '0 0 8px 8px'`，`boxShadow` 内阴影
- **外层容器**: 无边框，纯布局

### 功能架构
- **融合 Activity Bar**: 工作区切换整合到 SessionPanel，消除左侧多余栏位
- **两级分组**: Workspace 为一级，Source 为二级，清晰组织跨工作区会话
- **点击自动切换工作区**: 点击其他工作区的会话时，自动激活该工作区
- **分层操作**:
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

## 注意事项

- **overflow-hidden 与 sticky 冲突**: 父级设置 `overflow: hidden` 会导致 `position: sticky` 失效，解决方案是将边框移到 sticky header 和内容区，外层容器不设 `overflow-hidden`
- **边框闪烁问题**: 折叠时外层边框瞬间消失会产生视觉跳动，解决方案是边框统一放 header，用 `transition: border-color` 平滑过渡（展开 `${color}50`，折叠 `transparent`）
- **多级 sticky 堆叠**: Workspace Header 和 Source Header 都需要 sticky，通过 `top` 值区分层级（0 vs 52px）
- **Source 分组**: 如果只有 User 分类但后端返回了其他 source，需要动态处理所有 source 值
- **颜色分配**: 基于路径 hash 计算，确保同一路径始终分配相同颜色
- **吸顶视觉**: sticky header 加 `backdrop-blur-sm`，滚动时不完全遮挡下方内容
- **session 定位**: 使用 `Map<string, HTMLElement>` 存储 ref，而非数组索引，避免排序变化导致错位
- **搜索性能**: session 数量大时考虑防抖，当前实现直接过滤无性能问题
- **时间计算**: `timeAgo` 返回对象 `{text, opacity}`，渲染时内联 style 设置 opacity
