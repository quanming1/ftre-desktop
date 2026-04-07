# 设计系统规范

> ftre 视觉设计规范，深色主题 + 霓虹绿点缀风格

## 核心文件

| 文件 | 职责 |
|------|------|
| `.ftre/skills/design-target/SKILL.md` | 完整设计规范文档（颜色、字体、间距、动效） |
| `packages/renderer/src/styles/tailwind.css` | Tailwind 主题变量定义 |
| `packages/ui/src/tailwind-preset.ts` | UI 包 Tailwind preset |

## 色彩系统

### 背景层级
```
--color-base: #1e1e1e      (主背景)
--color-surface: #252526   (侧边栏/面板)
--color-elevated: #2d2d2d  (悬浮/弹窗)
--color-panel: #333333     (输入框/卡片)
```

### 品牌色（霓虹绿）
```
--color-neon: #00ff88                    (主强调色)
--color-neon-dim: rgba(0,255,136,0.12)   (选中背景)
--color-neon-ghost: rgba(0,255,136,0.06) (hover背景)
```

### 文字层级
```
--color-t-primary: #e8e8e8   (标题)
--color-t-secondary: #cccccc (正文)
--color-t-muted: #aab0b8     (次要)
--color-t-ghost: #888e98     (placeholder)
```

## 字体系统

- **代码字体**: JetBrains Mono / Cascadia Code (等宽)
- **UI 字体**: Inter / system-ui (无衬线)
- **中文回退**: "PingFang SC", "Microsoft YaHei", sans-serif

## 间距系统

基础单位: **4px**

| Token | 值 | 用途 |
|-------|-----|------|
| `space-1` | 4px | 图标内边距 |
| `space-2` | 8px | 小间距 |
| `space-3` | 12px | 按钮内边距 |
| `space-4` | 16px | 标准间距 |
| `space-5` | 20px | 大间距 |

## 圆角

- 小: 4px (按钮、输入框)
- 中: 6px (卡片、弹窗)
- 大: 8px (模态框)

## 动效原则

- 快速反馈: 100ms (hover)
- 标准过渡: 200ms (状态变化)
- 复杂动画: 300ms (弹窗展开)
- 缓动函数: `cubic-bezier(0.4, 0, 0.2, 1)`

## 设计决策

- **深色而非纯黑**: `#1e1e1e` 减少视觉疲劳，提升代码可读性
- **霓虹绿作为品牌标识**: 仅在关键交互点使用，避免过度装饰
- **极简边框**: 使用半透明边框 (`rgba(255,255,255,0.06)`) 而非实色
