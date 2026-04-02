# Session 面板 (会话管理)

> 顶层面板，展示所有工作区的会话列表，按 Workspace → Source 两级分组。**设计原则：彩色卡片区分工作区 + 粘性定位提升长列表体验**

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/features/session/SessionPanel.tsx` | 独立面板组件，两级分组展示 |
| `packages/renderer/src/stores/session.ts` | Session store，`loadAllSessions`/`switchSession` |
| `packages/renderer/src/stores/workspace.ts` | Workspace store，`recentFolders`/`rootPath` |
| `packages/renderer/src/stores/layout.ts` | PanelId 包含 `sessions`，`panelOrder` 控制布局 |
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
│ ╭────────────────────────────────────╮ │
│ │ ▼ ftre-desktop              [+] ⋯ │ │  ← Workspace 分组，展开时彩色边框
│ │ E:/projects/ftre-desktop          │ │     header 粘性定位，吸顶效果
│ ├────────────────────────────────────┤ │
│ │ ├─ ▼ User (3)                     │ │
│ │ │   会话1                    ⋯    │ │  ← Source 分组（可折叠）
│ │ │   会话2                         │ │
│ │ └─ ▶ Email (2)                    │ │
│ ╰────────────────────────────────────╯ │
│                                        │
│ ╭────────────────────────────────────╮ │
│ │ ▼ my-project                [+] ⋯ │ │  ← 多个展开时，后面的 header
│ │ /path/to/project                  │ │     会把前面的顶掉
│ ├────────────────────────────────────┤ │
│ │ ...会话列表...                      │ │
│ ╰────────────────────────────────────╯ │
│                                        │
│ ▶ another-app                   (3)    │  ← 折叠状态：无边框、不吸顶
├────────────────────────────────────────┤
│ [+ Open Workspace]                     │  ← 底部固定
└────────────────────────────────────────┘
```

### Workspace 分组样式

**展开状态**（彩色边框卡片 + 粘性定位）：
- 外层容器：`mx-2 mt-2`，**无边框**（边框移到 header 和 content）
- Header：`sticky top-0 z-10 backdrop-blur-sm`，吸顶跟随滚动
- Content：左右下三边框，与 header 无缝拼接
- 颜色分配：12 种颜色循环，根据路径 hash 固定分配

**折叠状态**：
- 无边框透明背景
- 不设置 sticky，正常跟随滚动

### Workspace 分组头

- **第一行**: ▼/▶ + 工作区名称 + (数量)，hover 时显示 `[+]` `⋯`
- **第二行**: 完整路径，灰色小字
- **交互**: 点击整行折叠/展开，当前工作区背景高亮
- **粘性定位**: `position: sticky; top: 0`，滚动时吸顶
- **[+]**: 在该工作区新建会话（hover 显示）
- **⋯**: 删除工作区（hover 显示）

### Source 分组

- 嵌套在 Workspace 下的二级分组
- 支持 `user`, `email`, `system` 等自定义 source
- 可折叠，显示数量

## 颜色系统

```typescript
// 12 种固定颜色
const WORKSPACE_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f59e0b", // amber
  "#10b981", // emerald
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#f43f5e", // rose
  "#8b5a2b", // brown
  "#84cc16", // lime
  "#14b8a6", // teal
  "#a855f7", // purple
];

// 根据路径 hash 分配固定颜色
function getWorkspaceColor(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = path.charCodeAt(i) + ((hash << 5) - hash);
  }
  return WORKSPACE_COLORS[Math.abs(hash) % WORKSPACE_COLORS.length];
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
点击底部 `[+ Open Workspace]` → `window.desktop.fs.selectFolder()` → 添加到工作区列表

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
```

## 设计决策

### UI 风格：彩色卡片区分工作区
- **展开时**: 彩色边框卡片包裹（12色循环，基于路径固定分配）
- **折叠时**: 无边框，简洁列表项
- **颜色稳定性**: 同一路径始终显示相同颜色，便于用户识别

### 粘性定位（Sticky Header）
- **实现**: `sticky top-0 z-10 bg-surface backdrop-blur-sm`
- **行为**: 展开的 workspace header 吸顶，滚动时始终可见
- **堆叠规则**: 多个 workspace 展开时，后面的 header 把前面的顶掉（自然堆叠）
- **折叠状态**: 不设置 sticky，避免不必要的吸顶
- **结构权衡**: 为了支持 sticky，边框从外层容器移到 header 和内容区，外层不设 `overflow-hidden`

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
  - `[+ Open Workspace]` 在底部 → 添加新工作区

### LayoutSwitcher
- **位置**: 平铺在 TitleBar 顶部
- **样式**: 四个面板 item 水平排列，放在框内
- **显隐**: 点击切换，灰色=隐藏，亮色=显示
- **排序**: 可拖拽调整 panelOrder

## 注意事项

- **overflow-hidden 与 sticky 冲突**: 父级设置 `overflow: hidden` 会导致 `position: sticky` 失效，解决方案是将边框移到 sticky header 和内容区，外层容器不设 `overflow-hidden`
- **边框闪烁问题**: 折叠时外层边框瞬间消失会产生视觉跳动，解决方案是边框统一放 header，用 `transition: border-color` 平滑过渡（展开 `${color}50`，折叠 `transparent`）
- **Source 分组**: 如果只有 User 分类但后端返回了其他 source，需要动态处理所有 source 值
- **虚拟列表**: 使用 @tanstack/react-virtual，行高 28-48px
- **颜色分配**: 基于路径 hash 计算，确保同一路径始终分配相同颜色
- **吸顶视觉**: sticky header 加 `backdrop-blur-sm`，滚动时不完全遮挡下方内容
