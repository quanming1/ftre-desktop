# Spacious UI 设计模式

> ftre 项目中大方留白风格的 UI 设计体系。核心理念：简洁不是简陋，主角突出 + 大量留白 + 完整交互。

## 位置

Skill 定义文件: `.ftre/skills/spacious-ui/SKILL.md`

## 核心原则

1. **主角突出** — 页面有明确的视觉焦点，标题大、输入框大、按钮醒目
2. **大量留白** — 元素之间有充足的呼吸空间，不拥挤
3. **完整交互** — hover、focus、disabled、loading 状态都要考虑
4. **简洁不简陋** — 减少视觉噪音，但功能完整

## 排版节奏

| 场景 | 间距类 | 用途 |
|------|--------|------|
| 区块间距 | `mb-12` / `mb-16` | 主要区块之间的分隔 |
| 表单字段间距 | `space-y-8` | 每个字段之间的大量呼吸空间 |
| 列表项间距 | `py-4` | 列表项的上下内边距 |
| 容器边距 | `px-8` / `py-12` | 页面内容的内边距 |

## 字号层级

| 元素 | 字号 | 字重 | 用途 |
|------|------|------|------|
| 页面标题 | `24px` | `font-light` | 页面主标题，优雅轻量 |
| 英雄输入框 | `18px` | 默认 | 表单的主要输入项 |
| 正文/标签 | `14px` | 默认 | 描述文字、字段标签 |
| 辅助文字 | `12px` | 默认 | 占位符、提示文字 |

## 组件模式

### 下划线输入框
```tsx
<Input
  className="text-lg bg-transparent border-0 border-b border-border rounded-none px-0 py-2
    focus:border-neon focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0
    placeholder:text-t-dim"
/>
```

### 列表项
- 底部边框分隔 (`border-b border-border`)
- Hover 时名称变绿 (`group-hover:text-neon`)
- 操作按钮只在 hover 时显示

### 主按钮
```tsx
<button className="px-8 py-3 text-sm font-medium text-base bg-neon hover:bg-neon-hover rounded">
```

### 空状态
- 简洁的引导文字
- 突出的 CTA 按钮
- 大量留白 (`py-20`)

### 图标按钮组（工具栏）
- 移除外层边框和背景
- 图标尺寸 `w-8 h-7` 或 `h-7 w-7`
- Tooltip 提供文字说明
- 激活态使用霓虹绿 (`text-neon`)
- 非激活态使用 `text-t-secondary` 或 `text-t-dim`

### 头部导航
- 整行可点击区域
- 左侧：彩色头像/图标（3-4 字符缩写）
- 中间：主标题，单行截断
- 右侧：状态指示器（小绿点、chevron 等）
- 移除非必要信息（如过长路径）

### 下拉菜单
- 添加分组小标题（如 "Workspaces"）
- 当前选中项用小圆点标识，而非大块背景
- 特殊操作移到底部，使用链接样式
- 列表项使用 `px-3 py-1.5` 紧凑间距

### 图标工具栏
- 图标按钮统一尺寸 `h-7 w-7`
- 透明背景，hover 时轻微高亮
- 状态 badge 改为小圆点（而非数字徽标）
- 减少文字按钮，优先使用图标 + Tooltip

### ResizeHandle（拖拽分割线）
**设计要点：**
- 默认始终可见 2px 灰色分割线
- Hover/Drag 时切换为半透明霓虹绿高亮
- 视觉宽度使用 `w-1` (4px) 居中，点击区域通过 `inset` 扩展

**实现模式：**
```tsx
<div className={cn(
  "shrink-0 relative group cursor-col-resize",
  isH ? "w-1 h-full" : "w-full h-1",
  "flex items-center justify-center",
)}>
  {/* 默认灰色分割线 */}
  <div className={cn(
    isH ? "w-[2px] h-full" : "w-full h-[2px]",
    "bg-[var(--ftre-border)] transition-colors duration-200",
    showHighlight && "bg-neon/60",
  )} />
  {/* 拖拽时高亮覆盖层 */}
  {showHighlight && (
    <div className={cn(
      isH ? "w-[3px] h-full" : "w-full h-[3px]",
      "absolute bg-neon/60 rounded-full",
    )} />
  )}
  {/* 扩展点击区域 */}
  <div className={cn(
    "absolute z-10",
    isH ? "inset-y-0 -left-1 -right-1" : "inset-x-0 -top-1 -bottom-1",
  )} />
</div>
```

### 工作区选择器（放大版）
**设计要点：**
- 头像尺寸：`48×48px` (w-12 h-12)，圆角 `rounded-xl`
- 整体 padding：`px-5 py-5`
- 标题字号：`15px`，带副标题显示数量
- 按钮高度：`h-11`，圆角 `rounded-lg`

**尺寸对比：**

| 元素 | 紧凑版 | Spacious 版 |
|------|--------|-------------|
| 头像 | 36×36 | 48×48 |
| 按钮高度 | h-9 (36px) | h-11 (44px) |
| 圆角 | rounded-md | rounded-lg |
| 图标大小 | 15-16px | 17px |
| 列表项 padding | py-3 | py-3.5 |

## 交互状态

| 状态 | 样式 |
|------|------|
| Hover | 文字变霓虹绿，显示操作按钮 |
| Focus | 边框变为霓虹绿，无 outline |
| Disabled | 降低透明度，cursor-not-allowed |
| Loading | 按钮显示 spinner，禁用交互 |
| Active | 霓虹绿高亮，无厚重背景 |

## 颜色使用原则

- **霓虹绿**：仅用于激活态、hover 高亮、状态指示点
- **灰色系**：`text-t-secondary` 用于次要文字，`text-t-dim` 用于占位符
- **透明背景**：优先使用透明背景，减少视觉噪音

## 使用场景

- 设计新的设置/配置页面
- 创建表单界面
- 设计列表/详情页面
- 优化工具栏和头部导航
- 需要"大气"、"留白"、"简洁但不简陋"的 UI 风格

## 参考实现

| 文件 | 用途 |
|------|------|
| `packages/renderer/src/features/settings/AgentDefSettings.tsx` | 表单页面完整示例 |
| `packages/renderer/src/components/LayoutSwitcher.tsx` | 图标按钮组工具栏 |
| `packages/renderer/src/features/session/SessionPanel.tsx` | 头部导航 + 下拉菜单 + 工作区选择器 |
| `packages/ui/src/components/ResizeHandle.tsx` | 拖拽分割线组件 |
